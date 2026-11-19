import { failCode, type FailCode } from "@/lib/studio/allow";
import { apiPath } from "@/lib/studio/api-path";
import {
  FALLBACK_CLOUDFLARE,
  FALLBACK_NVIDIA,
  FALLBACK_OPENROUTER,
  FALLBACK_ORCA,
  onlyCurated,
} from "@/lib/studio/catalog";
import { useStudio } from "@/lib/studio/store";
import type { CatalogModel, ProviderId } from "@/lib/studio/types";

export type StreamDelta = {
  content: string;
  reasoning: string;
};

type UpstreamMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export class ChatRequestError extends Error {
  code: FailCode;
  constructor(message: string, code: FailCode) {
    super(message);
    this.name = "ChatRequestError";
    this.code = code;
  }
}

export async function refreshCatalog(): Promise<void> {
  const response = await fetch(apiPath("/api/models"));
  const current = useStudio.getState().catalog;
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    useStudio.getState().setCatalog({
      orca: onlyCurated(current.orca, FALLBACK_ORCA),
      openrouter: onlyCurated(current.openrouter, FALLBACK_OPENROUTER),
      nvidia: onlyCurated(current.nvidia, FALLBACK_NVIDIA),
      cloudflare: onlyCurated(current.cloudflare, FALLBACK_CLOUDFLARE),
      fetchedAt: current.fetchedAt,
      warning: body?.error || "一覧を更新できませんでした。手元の候補を使います。",
    });
    return;
  }
  const json = (await response.json()) as {
    orca?: CatalogModel[];
    openrouter?: CatalogModel[];
    nvidia?: CatalogModel[];
    cloudflare?: CatalogModel[];
    warning?: string;
  };
  useStudio.getState().setCatalog({
    orca: onlyCurated(json.orca?.length ? json.orca : current.orca, FALLBACK_ORCA),
    openrouter: onlyCurated(
      json.openrouter?.length ? json.openrouter : current.openrouter,
      FALLBACK_OPENROUTER,
    ),
    nvidia: onlyCurated(json.nvidia?.length ? json.nvidia : current.nvidia, FALLBACK_NVIDIA),
    cloudflare: onlyCurated(
      json.cloudflare?.length ? json.cloudflare : current.cloudflare,
      FALLBACK_CLOUDFLARE,
    ),
    fetchedAt: Date.now(),
    warning: json.warning ?? "",
  });
}

function asText(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value
    .map((part) => {
      if (typeof part === "string") return part;
      if (part && typeof part === "object" && "text" in part) {
        const text = (part as { text?: unknown }).text;
        return typeof text === "string" ? text : "";
      }
      return "";
    })
    .join("");
}

export async function streamCompletion(
  input: {
    provider: ProviderId;
    model: string;
    apiKey: string;
    accountId?: string;
    temperature: number;
    messages: UpstreamMessage[];
  },
  onDelta: (delta: StreamDelta) => void,
  signal: AbortSignal,
  onJob?: (jobId: string) => void,
): Promise<void> {
  const response = await fetch(apiPath("/api/chat"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    signal,
  });
  const jobId = response.headers.get("x-job-id");
  if (jobId) onJob?.(jobId);

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string; code?: FailCode } | null;
    throw new ChatRequestError(body?.error || "送信に失敗しました。", body?.code ?? failCode(response.status));
  }

  const type = response.headers.get("content-type") ?? "";
  if (type.includes("application/json")) {
    const json = (await response.json()) as {
      choices?: Array<{ message?: { content?: unknown; reasoning?: unknown } }>;
    };
    const message = json.choices?.[0]?.message;
    onDelta({
      content: asText(message?.content),
      reasoning: asText(message?.reasoning),
    });
    return;
  }

  if (!response.body) throw new ChatRequestError("応答が空でした。", "upstream");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  let reasoning = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const data = trimmed.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      try {
        const json = JSON.parse(data) as {
          error?: { message?: string } | string;
          choices?: Array<{
            delta?: {
              content?: unknown;
              reasoning?: unknown;
              reasoning_content?: unknown;
            };
            message?: { content?: unknown };
          }>;
        };
        if (json.error) {
          const message = typeof json.error === "string" ? json.error : json.error.message;
          throw new ChatRequestError(message || "ストリームが中断されました。", "upstream");
        }
        const delta = json.choices?.[0]?.delta;
        const piece = asText(delta?.content) || asText(json.choices?.[0]?.message?.content);
        const thought = asText(delta?.reasoning) || asText(delta?.reasoning_content);
        if (!piece && !thought) continue;
        content += piece;
        reasoning += thought;
        onDelta({ content, reasoning });
      } catch (error) {
        if (error instanceof SyntaxError) continue;
        throw error;
      }
    }
  }
}
