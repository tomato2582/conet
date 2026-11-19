import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { failCode, isFreeModel, providerLabel, type FailCode } from "@/lib/studio/allow";
import {
  cancelJobOnServer,
  clientStream,
  finishJob,
  getJob,
  openJob,
  pushChunk,
} from "@/lib/studio/server-jobs";
import type { ProviderId } from "@/lib/studio/types";

const bodySchema = z.object({
  provider: z.enum(["orca", "openrouter", "nvidia", "cloudflare"]),
  model: z.string().min(3).max(180),
  apiKey: z.string().min(8).max(2000),
  accountId: z.string().max(64).optional(),
  temperature: z.number().min(0).max(1.5),
  messages: z
    .array(
      z.object({
        role: z.enum(["system", "user", "assistant"]),
        content: z.string().max(48000),
      }),
    )
    .min(1)
    .max(42),
});

function scrub(value: string): string {
  return value
    .replace(/sk-[A-Za-z0-9_-]{6,}/g, "sk-…")
    .replace(/nvapi-[A-Za-z0-9_-]{6,}/g, "nvapi-…")
    .slice(0, 420);
}

function statusMessage(status: number, detail: string): string {
  const lower = detail.toLowerCase();
  if (lower.includes("data policy") || lower.includes("guardrail")) {
    return "OpenRouter のプライバシー設定で、無料モデルが全部外れています。OpenRouter の Settings → Privacy で、学習や公開を許可する無料エンドポイントをオンにしてください。";
  }
  if (status === 410 || lower.includes("end of life")) {
    return "このモデルは終了しています。別のモデルを選んでください。";
  }
  if (status === 401 || status === 403) {
    return "キーが拒否されました。そのサービスのキーか、無料枠が有効かを確認してください。";
  }
  if (status === 402) return "無料枠がないか、クレジット不足です。";
  if (status === 429) return "無料枠の回数制限です。少し待ってからもう一度。";
  if (status === 404) return "この無料モデルは今見つかりません。一覧を更新してください。";
  const extra = detail.trim();
  return extra
    ? `応答できませんでした（${status}）。${extra}`
    : `応答できませんでした（${status}）。`;
}

function fail(error: string, status: number, code: FailCode = failCode(status)) {
  return Response.json({ error, code }, { status });
}

function endpoint(provider: ProviderId, accountId: string): string | null {
  if (provider === "orca") return "https://api.orcarouter.ai/v1/chat/completions";
  if (provider === "openrouter") return "https://openrouter.ai/api/v1/chat/completions";
  if (provider === "nvidia") return "https://integrate.api.nvidia.com/v1/chat/completions";
  if (!/^[a-z0-9]{16,40}$/i.test(accountId)) return null;
  return `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/v1/chat/completions`;
}

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const id = new URL(request.url).searchParams.get("job")?.trim() ?? "";
        if (!id) return fail("執筆が見つかりません。", 404, "upstream");
        const job = getJob(id);
        if (!job) return fail("執筆はもう残っていません。", 404, "upstream");
        return Response.json({
          status: job.status,
          content: job.content,
          reasoning: job.reasoning,
          error: job.error,
        });
      },
      DELETE: async ({ request }) => {
        const id = new URL(request.url).searchParams.get("job")?.trim() ?? "";
        if (id) cancelJobOnServer(id);
        return Response.json({ ok: true });
      },
      POST: async ({ request }) => {
        let json: unknown;
        try {
          json = await request.json();
        } catch {
          return fail("リクエストを読めませんでした。", 400, "model");
        }
        const parsed = bodySchema.safeParse(json);
        if (!parsed.success) {
          return fail("送信内容が不正です。", 400, "model");
        }
        const { provider, model, apiKey, accountId, temperature, messages } = parsed.data;
        if (!isFreeModel(provider, model)) {
          return fail(
            `${providerLabel(provider)} では、一覧にあるモデルだけ使えます。`,
            400,
            "model",
          );
        }
        const url = endpoint(provider, (accountId ?? "").trim());
        if (!url) {
          return fail("Cloudflare のアカウントIDを接続に入れてください。", 400, "model");
        }

        const headers: Record<string, string> = {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        };
        if (provider === "openrouter") {
          headers["HTTP-Referer"] = "https://sumiki.local";
          headers["X-Title"] = "Conet";
        }

        const baseBody: Record<string, unknown> = {
          model,
          messages,
          temperature,
          stream: true,
        };
        if (provider === "nvidia" || provider === "openrouter") baseBody.max_tokens = 1200;
        const attempts: Record<string, unknown>[] = [];
        if (provider === "openrouter") {
          attempts.push({
            ...baseBody,
            reasoning: { effort: "none" },
            provider: { sort: "latency" },
          });
        } else if (provider === "nvidia") {
          attempts.push({ ...baseBody, reasoning_effort: "none" });
        }
        attempts.push(baseBody);

        const upstreamAbort = new AbortController();
        const timer = setTimeout(() => upstreamAbort.abort(), 90000);
        let held: ReturnType<typeof openJob> | null = null;
        const onClientGone = () => {
          if (!held) {
            upstreamAbort.abort();
            return;
          }
          held.attached = false;
          held.chunks = [];
        };
        request.signal.addEventListener("abort", onClientGone);

        let upstream: Response | null = null;
        let errorText = "";
        try {
          for (let index = 0; index < attempts.length; index += 1) {
            upstream = await fetch(url, {
              method: "POST",
              headers,
              body: JSON.stringify(attempts[index]),
              signal: upstreamAbort.signal,
            });
            const last = index === attempts.length - 1;
            if (upstream.ok && upstream.body) break;
            const text = scrub(await upstream.text().catch(() => ""));
            const retry =
              !last &&
              upstream.status === 400 &&
              /reasoning|unexpected|unknown|not supported|extra/i.test(text);
            if (retry) continue;
            errorText = text;
            break;
          }
        } catch (error) {
          const aborted = error instanceof Error && error.name === "AbortError";
          if (request.signal.aborted) {
            return fail("中断しました。", 499, "upstream");
          }
          return fail(
            aborted ? "上流が時間内に返りませんでした。" : "上流へ接続できませんでした。",
            504,
            "upstream",
          );
        } finally {
          clearTimeout(timer);
        }

        if (!upstream || !upstream.ok || !upstream.body) {
          const detail = errorText || scrub((await upstream?.text().catch(() => "")) || "");
          let message = detail;
          try {
            const errJson = JSON.parse(detail) as {
              error?: { message?: string } | string;
              detail?: string;
            };
            if (typeof errJson.error === "string") message = errJson.error;
            else if (errJson.error?.message) message = errJson.error.message;
            else if (typeof errJson.detail === "string") message = errJson.detail;
          } catch {
            /* plain text */
          }
          console.error("[chat]", provider, upstream?.status);
          const status = upstream?.status || 502;
          return fail(statusMessage(status, scrub(message)), status);
        }

        const heldJob = openJob();
        held = heldJob;
        heldJob.stopUpstream = () => upstreamAbort.abort();
        const reader = upstream.body.getReader();
        void (async () => {
          try {
            for (;;) {
              if (heldJob.aborted) {
                await reader.cancel();
                break;
              }
              const { done, value } = await reader.read();
              if (value) pushChunk(heldJob, value);
              if (done) {
                finishJob(heldJob);
                break;
              }
            }
          } catch {
            if (!heldJob.closed) finishJob(heldJob, "上流が切れました。");
          }
        })();

        return new Response(clientStream(heldJob), {
          status: 200,
          headers: {
            "Content-Type": "text/event-stream; charset=utf-8",
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
            "X-Job-Id": heldJob.id,
          },
        });
      },
    },
  },
});
