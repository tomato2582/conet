type HeldJob = {
  id: string;
  status: "running" | "done" | "error";
  content: string;
  reasoning: string;
  error: string | null;
  chunks: Uint8Array[];
  attached: boolean;
  closed: boolean;
  aborted: boolean;
  stopUpstream: (() => void) | null;
  buffer: string;
  decoder: TextDecoder;
  waiters: Array<() => void>;
  updatedAt: number;
};

const jobs = new Map<string, HeldJob>();
const TTL = 20 * 60 * 1000;

function sweep(now: number) {
  for (const [id, job] of jobs) {
    if (now - job.updatedAt > TTL) jobs.delete(id);
  }
}

function wake(job: HeldJob) {
  const waiters = job.waiters.splice(0);
  for (const waiter of waiters) waiter();
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

function absorb(job: HeldJob, chunk: string) {
  job.buffer += chunk;
  const lines = job.buffer.split("\n");
  job.buffer = lines.pop() ?? "";
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;
    const data = trimmed.slice(5).trim();
    if (!data || data === "[DONE]") continue;
    try {
      const json = JSON.parse(data) as {
        error?: { message?: string } | string;
        choices?: Array<{
          delta?: { content?: unknown; reasoning?: unknown; reasoning_content?: unknown };
          message?: { content?: unknown };
        }>;
      };
      if (json.error) {
        job.error = typeof json.error === "string" ? json.error : json.error.message || "ストリームが中断されました。";
        job.status = "error";
        continue;
      }
      const delta = json.choices?.[0]?.delta;
      job.content += asText(delta?.content) || asText(json.choices?.[0]?.message?.content);
      job.reasoning += asText(delta?.reasoning) || asText(delta?.reasoning_content);
    } catch {
      /* partial json */
    }
  }
}

export function openJob(): HeldJob {
  sweep(Date.now());
  const job: HeldJob = {
    id: crypto.randomUUID(),
    status: "running",
    content: "",
    reasoning: "",
    error: null,
    chunks: [],
    attached: true,
    closed: false,
    aborted: false,
    stopUpstream: null,
    buffer: "",
    decoder: new TextDecoder(),
    waiters: [],
    updatedAt: Date.now(),
  };
  jobs.set(job.id, job);
  return job;
}

export function getJob(id: string): HeldJob | null {
  return jobs.get(id) ?? null;
}

export function pushChunk(job: HeldJob, value: Uint8Array) {
  absorb(job, job.decoder.decode(value, { stream: true }));
  job.updatedAt = Date.now();
  if (job.attached) job.chunks.push(value);
  wake(job);
}

export function finishJob(job: HeldJob, error?: string) {
  absorb(job, job.decoder.decode());
  if (error && job.status !== "error") {
    job.status = "error";
    job.error = error;
  } else if (job.status === "running") {
    job.status = "done";
  }
  job.closed = true;
  job.updatedAt = Date.now();
  wake(job);
}

export function cancelJobOnServer(id: string) {
  const job = jobs.get(id);
  if (!job || job.closed) return;
  job.aborted = true;
  job.stopUpstream?.();
  finishJob(job, "中断しました。");
}

export function clientStream(job: HeldJob): ReadableStream<Uint8Array> {
  let sent = 0;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      for (;;) {
        while (sent < job.chunks.length) {
          try {
            controller.enqueue(job.chunks[sent]);
          } catch {
            return;
          }
          sent += 1;
        }
        if (job.closed) {
          try {
            controller.close();
          } catch {
            /* client already left */
          }
          return;
        }
        await new Promise<void>((resolve) => job.waiters.push(resolve));
      }
    },
    cancel() {
      job.attached = false;
      job.chunks = [];
    },
  });
}
