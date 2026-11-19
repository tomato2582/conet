import { canRotateKey } from "@/lib/studio/allow";
import { apiPath } from "@/lib/studio/api-path";
import { ChatRequestError, streamCompletion, type StreamDelta } from "@/lib/studio/client";
import { buildSystemPrompt, polishPrompt, shotLock } from "@/lib/studio/prompt";
import { keysFor, useStudio } from "@/lib/studio/store";
import type { ApiKeyEntry, ChatMessage, ProviderId } from "@/lib/studio/types";

const HISTORY = 24;
const MAX_JOBS = 3;
const SNAPSHOT_MS = 1200;
const UI_MS = 80;
const PENDING_KEY = "sumiki-pending-v1";

export type LiveJob = {
  conversationId: string;
  messageId: string;
  serverId: string | null;
  content: string;
  reasoning: string;
  model: string;
  provider: ProviderId;
  status: "running" | "error";
  error: string | null;
  note: string | null;
};

type PendingJob = {
  conversationId: string;
  messageId: string;
  jobId: string;
  model: string;
};

const EMPTY: LiveJob[] = [];
let jobs: LiveJob[] = EMPTY;
const controllers = new Map<string, AbortController>();
const discarded = new Set<string>();
const stopped = new Set<string>();
const listeners = new Set<() => void>();
const cursors: Partial<Record<ProviderId, number>> = {};

function emit(next: LiveJob[]) {
  jobs = next;
  listeners.forEach((listener) => listener());
}

export function subscribeJobs(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getJobs(): LiveJob[] {
  return jobs;
}

export function jobFor(id: string | null): LiveJob | null {
  if (!id) return null;
  return jobs.find((job) => job.conversationId === id) ?? null;
}

function leftEarly(error: unknown): boolean {
  if (error instanceof DOMException && error.name === "AbortError") return true;
  if (!(error instanceof Error)) return false;
  if (error.name === "AbortError") return true;
  return /load failed|failed to fetch|networkerror|network error|operation was aborted|aborted/i.test(error.message);
}

function visibleError(error: unknown): string {
  if (leftEarly(error)) return "接続が切れました。もう一度送ってください。";
  if (error instanceof Error && error.message.trim()) return error.message;
  return "送信に失敗しました。";
}

function patch(id: string, partial: Partial<LiveJob>) {
  emit(jobs.map((job) => (job.conversationId === id ? { ...job, ...partial } : job)));
}

function drop(id: string) {
  const next = jobs.filter((job) => job.conversationId !== id);
  emit(next.length ? next : EMPTY);
}

export function cancelJob(id: string, options?: { discard?: boolean }) {
  if (options?.discard) discarded.add(id);
  stopped.add(id);
  const serverId = jobFor(id)?.serverId;
  if (serverId) {
    forgetPending(id);
    void fetch(apiPath(`/api/chat?job=${encodeURIComponent(serverId)}`), { method: "DELETE" }).catch(
      () => undefined,
    );
  }
  controllers.get(id)?.abort();
  if (options?.discard) drop(id);
}

export function dismissJob(id: string) {
  const job = jobFor(id);
  if (job?.status === "running") return;
  drop(id);
}

function orderedKeys(provider: ProviderId): ApiKeyEntry[] {
  const keys = keysFor(provider);
  if (keys.length < 2) return keys;
  const start = (cursors[provider] ?? 0) % keys.length;
  return [...keys.slice(start), ...keys.slice(0, start)];
}

function rememberKey(provider: ProviderId, entry: ApiKeyEntry) {
  const keys = keysFor(provider);
  const index = keys.findIndex((item) => item.id === entry.id);
  if (index >= 0) cursors[provider] = index;
}

export function startJob(conversationId: string, history: ChatMessage[]): void {
  if (jobFor(conversationId)?.status === "running") return;
  const running = jobs.filter((job) => job.status === "running").length;
  if (running >= MAX_JOBS) {
    emit([
      ...jobs.filter((job) => job.conversationId !== conversationId),
      {
        conversationId,
        messageId: crypto.randomUUID(),
        content: "",
        reasoning: "",
        serverId: null,
        model: useStudio.getState().modelId,
        provider: useStudio.getState().provider,
        status: "error",
        error: "同時に書けるのは3本までです。どれかが終わるまで待ってください。",
        note: null,
      },
    ]);
    return;
  }

  const state = useStudio.getState();
  const messageId = crypto.randomUUID();
  const controller = new AbortController();
  controllers.set(conversationId, controller);
  const job: LiveJob = {
    conversationId,
    messageId,
    content: "",
    reasoning: "",
    serverId: null,
    model: state.modelId,
    provider: state.provider,
    status: "running",
    error: null,
    note: null,
  };
  emit([...jobs.filter((item) => item.conversationId !== conversationId), job]);
  void runJob(job, history, controller);
}

async function runJob(job: LiveJob, history: ChatMessage[], controller: AbortController) {
  const { conversationId, messageId } = job;
  let latest: StreamDelta = { content: "", reasoning: "" };
  let note: string | null = null;
  let emitted = false;
  let lastSnapshot = 0;
  const state = useStudio.getState();
  const provider = state.provider;
  const model = state.modelId;
  const keys = orderedKeys(provider);
  let keepJob = false;

  const publish = (force: boolean) => {
    const now = Date.now();
    if (!force && now - lastSnapshot < SNAPSHOT_MS) return;
    if (!latest.content && !latest.reasoning) return;
    lastSnapshot = now;
    writeMessage(conversationId, history, latest, model, messageId, note);
  };
  let lastUi = 0;

  try {
    if (!keys.length) {
      throw new ChatRequestError("APIキーがまだありません。接続から入れてください。", "key");
    }
    if (provider === "cloudflare" && !/^[a-z0-9]{16,40}$/i.test(state.cloudflareAccountId.trim())) {
      throw new ChatRequestError("Cloudflare のアカウントIDを接続に入れてください。", "model");
    }

    const failures: string[] = [];
    for (let index = 0; index < keys.length; index += 1) {
      const entry = keys[index];
      emitted = false;
      try {
        const turns = history.slice(-HISTORY).map((message) => ({
          role: message.role,
          content: message.content,
        }));
        const lock = shotLock(state.shot);
        const lastTurn = turns.at(-1);
        if (lock && lastTurn?.role === "user") {
          turns[turns.length - 1] = { role: "user", content: `${lastTurn.content}\n\n${lock}` };
        }
        await streamCompletion(
          {
            provider,
            model,
            apiKey: entry.secret.trim(),
            accountId: provider === "cloudflare" ? state.cloudflareAccountId.trim() : undefined,
            temperature: state.temperature,
            messages: [
              {
                role: "system",
                content: buildSystemPrompt({
                  customInstructions: state.customInstructions,
                  instructionWeight: state.instructionWeight,
                  memories: state.memories,
                  references: state.references,
                  shot: state.shot,
                  words: state.words,
                }),
              },
              ...turns,
            ],
          },
          (delta) => {
            emitted = true;
            const request = [...history].reverse().find((item) => item.role === "user")?.content ?? "";
            latest = {
              content: polishPrompt(delta.content, state.shot.women, request, state.shot),
              reasoning: delta.reasoning,
            };
            const now = Date.now();
            if (now - lastUi >= UI_MS) {
              lastUi = now;
              patch(conversationId, { content: latest.content, reasoning: latest.reasoning, note });
            }
            publish(false);
          },
          controller.signal,
          (jobId) => {
            patch(conversationId, { serverId: jobId });
            rememberPending({ conversationId, messageId, jobId, model });
          },
        );
        rememberKey(provider, entry);
        const finishedNote = note?.replace("書いています。", "書きました。") ?? null;
        forgetPending(conversationId);
        writeMessage(conversationId, history, latest, model, messageId, finishedNote);
        if (!discarded.has(conversationId)) drop(conversationId);
        return;
      } catch (error) {
        if (leftEarly(error)) throw error;
        const aborted =
          (error instanceof DOMException && error.name === "AbortError") ||
          (error instanceof Error && error.name === "AbortError");
        if (aborted) throw error;
        const rotatable =
          !emitted && error instanceof ChatRequestError && canRotateKey(error.code) && index < keys.length - 1;
        const message = error instanceof Error ? error.message : "送信に失敗しました。";
        failures.push(`${entry.label}: ${message}`);
        if (!rotatable) {
          throw new ChatRequestError(
            keys.length > 1 ? failures.join(" / ") : message,
            error instanceof ChatRequestError ? error.code : "upstream",
          );
        }
        const serverId = jobFor(conversationId)?.serverId;
        if (serverId) {
          forgetPending(conversationId);
          void fetch(apiPath(`/api/chat?job=${encodeURIComponent(serverId)}`), { method: "DELETE" }).catch(
            () => undefined,
          );
        }
        note = `${entry.label} が使えなかったので、次のキーで書いています。`;
        patch(conversationId, { note, content: "", reasoning: "", serverId: null });
        latest = { content: "", reasoning: "" };
      }
    }
  } catch (error) {
    if (discarded.has(conversationId)) {
      discarded.delete(conversationId);
      drop(conversationId);
      return;
    }
    if (stopped.has(conversationId)) {
      stopped.delete(conversationId);
      forgetPending(conversationId);
      drop(conversationId);
      return;
    }
    const early = leftEarly(error);
    const keep = early && !stopped.has(conversationId) && Boolean(jobFor(conversationId)?.serverId);
    if (!keep && (latest.content || latest.reasoning)) {
      writeMessage(conversationId, history, latest, model, messageId, note);
    }
    if (early && keep) {
      keepJob = true;
      drop(conversationId);
      return;
    }
    if (early && !jobFor(conversationId)?.serverId) {
      forgetPending(conversationId);
    }
    patch(conversationId, {
      status: "error",
      error: visibleError(error),
      content: latest.content,
      reasoning: latest.reasoning,
    });
  } finally {
    controllers.delete(conversationId);
    if (keepJob) resumePending();
  }
}

function writeMessage(
  conversationId: string,
  history: ChatMessage[],
  latest: StreamDelta,
  model: string,
  messageId: string,
  note: string | null,
) {
  const request = [...history].reverse().find((item) => item.role === "user")?.content ?? "";
  const content = latest.content.trim()
    ? polishPrompt(latest.content, useStudio.getState().shot.women, request, useStudio.getState().shot)
    : latest.reasoning
      ? "（本文がなく、思考だけ返りました。モデルを変えてやり直してください）"
      : "";
  if (!content && !latest.reasoning) return;
  const state = useStudio.getState();
  const conversation = state.conversations.find((item) => item.id === conversationId);
  if (!conversation) return;
  const assistant: ChatMessage = {
    id: messageId,
    role: "assistant",
    content,
    reasoning: latest.reasoning || undefined,
    createdAt: Date.now(),
    model,
    note: note ?? undefined,
  };
  const without = conversation.messages.filter((item) => item.id !== messageId);
  const base = without.length >= history.length ? without : history;
  const createdAt = conversation.messages.find((item) => item.id === messageId)?.createdAt;
  useStudio.getState().commitMessages(conversationId, [
    ...base.filter((item) => item.id !== messageId),
    { ...assistant, createdAt: createdAt ?? assistant.createdAt },
  ]);
}

function storage(): Storage | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage;
  } catch {
    return null;
  }
}

function readPending(): PendingJob[] {
  const raw = storage()?.getItem(PENDING_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as PendingJob[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item) => item?.jobId && item.conversationId && item.messageId);
  } catch {
    return [];
  }
}

function writePending(rows: PendingJob[]) {
  storage()?.setItem(PENDING_KEY, JSON.stringify(rows));
}

function rememberPending(row: PendingJob) {
  writePending([...readPending().filter((item) => item.conversationId !== row.conversationId), row]);
}

function forgetPending(conversationId: string) {
  writePending(readPending().filter((item) => item.conversationId !== conversationId));
}

export function detachForBackground() {
  for (const job of jobs) {
    if (job.status !== "running" || !job.serverId) continue;
    if (stopped.has(job.conversationId)) continue;
    controllers.get(job.conversationId)?.abort();
  }
}

export function resumePending() {
  for (const row of readPending()) {
    if (controllers.has(row.conversationId)) continue;
    void followPending(row);
  }
}

async function followPending(row: PendingJob) {
  const conversation = useStudio.getState().conversations.find((item) => item.id === row.conversationId);
  if (!conversation) {
    forgetPending(row.conversationId);
    return;
  }
  const controller = new AbortController();
  controllers.set(row.conversationId, controller);
  emit([
    ...jobs.filter((item) => item.conversationId !== row.conversationId),
    {
      conversationId: row.conversationId,
      messageId: row.messageId,
      serverId: row.jobId,
      content: "",
      reasoning: "",
      model: row.model,
      provider: useStudio.getState().provider,
      status: "running",
      error: null,
      note: "画面を閉じていたあいだも書いています。",
    },
  ]);
  try {
    for (;;) {
      if (controller.signal.aborted && stopped.has(row.conversationId)) break;
      let response: Response;
      try {
        response = await fetch(apiPath(`/api/chat?job=${encodeURIComponent(row.jobId)}`), {
          signal: controller.signal,
        });
      } catch (error) {
        if (stopped.has(row.conversationId)) break;
        if (leftEarly(error)) {
          await new Promise((resolve) => setTimeout(resolve, 1200));
          continue;
        }
        throw error;
      }
      if (response.status === 404) {
        forgetPending(row.conversationId);
        patch(row.conversationId, {
          status: "error",
          error: "画面を閉じているあいだに、執筆が切れました。もう一度送ってください。",
        });
        return;
      }
      const json = (await response.json()) as {
        status?: string;
        content?: string;
        reasoning?: string;
        error?: string | null;
      };
      const content = json.content ?? "";
      const reasoning = json.reasoning ?? "";
      patch(row.conversationId, { content, reasoning });
      if (json.status === "running") {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        continue;
      }
      if (json.status === "error" && !content) {
        forgetPending(row.conversationId);
        patch(row.conversationId, {
          status: "error",
          error: json.error || "執筆に失敗しました。",
          content,
          reasoning,
        });
        return;
      }
      const saved =
        useStudio
          .getState()
          .conversations.find((item) => item.id === row.conversationId)
          ?.messages.filter((item) => item.id !== row.messageId) ?? [];
      writeMessage(row.conversationId, saved, { content, reasoning }, row.model, row.messageId, null);
      forgetPending(row.conversationId);
      drop(row.conversationId);
      return;
    }
    if (stopped.has(row.conversationId)) {
      stopped.delete(row.conversationId);
      drop(row.conversationId);
    }
  } catch (error) {
    if (stopped.has(row.conversationId)) {
      stopped.delete(row.conversationId);
      forgetPending(row.conversationId);
      drop(row.conversationId);
      return;
    }
    if (leftEarly(error)) return;
    patch(row.conversationId, { status: "error", error: "執筆の続きを読めませんでした。" });
  } finally {
    controllers.delete(row.conversationId);
  }
}
