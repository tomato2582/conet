import { useState, type ReactNode } from "react";
import { BookPlus, Check, Copy, Pencil, RefreshCw } from "lucide-react";
import { BrandMark } from "@/components/studio/brand-mark";
import { copyablePrompt, splitBlocks } from "@/lib/studio/prompt";
import { cn } from "@/lib/utils";
import type { ChatMessage } from "@/lib/studio/types";

async function writeClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    document.body.appendChild(area);
    area.select();
    document.execCommand("copy");
    area.remove();
  }
}

export function MessageView({
  message,
  onReference,
  onRegenerate,
  onEdit,
  pending,
}: {
  message: ChatMessage;
  onReference?: (body: string) => void;
  onRegenerate?: () => void;
  onEdit?: (text: string) => void;
  pending?: boolean;
}) {
  if (message.role === "user") {
    return <UserMessage message={message} onEdit={onEdit} />;
  }

  return (
    <article className="min-w-0">
      <div className="mb-2 flex items-center gap-2 text-xs text-fg-soft">
        <BrandMark className="size-6" />
        <span className="truncate">{message.model || "Conet"}</span>
        {pending ? <span className="text-cinnabar">執筆中</span> : null}
      </div>
      {message.note ? <p className="mb-2 text-xs text-fg-soft">{message.note}</p> : null}
      {message.reasoning ? (
        <details className="mb-3 rounded-md border border-line bg-paper-2 px-3 py-2 text-sm text-fg-soft">
          <summary className="cursor-pointer">思考</summary>
          <p className="mt-2 whitespace-pre-wrap">{message.reasoning}</p>
        </details>
      ) : null}
      <div className="space-y-3 text-base leading-relaxed">
        {message.content
          ? splitBlocks(message.content).map((block, index, all) => {
              const last = index === all.length - 1;
              return block.type === "text" ? (
                <p key={index} className="whitespace-pre-wrap text-pretty">
                  {block.text}
                  {pending && last ? <Caret /> : null}
                </p>
              ) : (
                <CodeBlock key={index} lang={block.lang} text={block.text} pending={pending && last} />
              );
            })
          : pending && (
              <p className="text-fg-soft">
                書き出しています
                <Caret />
              </p>
            )}
      </div>
      {!pending && message.content ? (
        <MessageActions
          content={message.content}
          onReference={onReference}
          onRegenerate={onRegenerate}
        />
      ) : null}
    </article>
  );
}

function UserMessage({ message, onEdit }: { message: ChatMessage; onEdit?: (text: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(message.content);

  function cancel() {
    setValue(message.content);
    setEditing(false);
  }

  function save() {
    const next = value.trim();
    if (!next || !onEdit) return;
    onEdit(next);
    setEditing(false);
  }

  if (editing) {
    return (
      <form
        className="flex justify-end"
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        <div className="w-full max-w-[85%]">
          <textarea
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                event.preventDefault();
                save();
              }
            }}
            rows={4}
            className="max-h-64 min-h-24 w-full resize-y rounded-lg border border-line bg-paper px-4 py-3 text-sm"
            aria-label="送った依頼を編集"
          />
          <div className="mt-2 flex justify-end gap-2">
            <button type="button" onClick={cancel} className="h-11 rounded-md px-3 text-sm text-fg-soft">
              キャンセル
            </button>
            <button
              type="submit"
              disabled={!value.trim()}
              className="h-11 rounded-md bg-cinnabar px-4 text-sm text-on-dark disabled:opacity-40"
            >
              送り直す
            </button>
          </div>
        </div>
      </form>
    );
  }

  return (
    <div className="flex justify-end">
      <div className="max-w-[85%]">
        <p className="rounded-lg bg-ink px-4 py-3 text-sm whitespace-pre-wrap text-on-dark">{message.content}</p>
        {onEdit ? (
          <div className="mt-1 flex justify-end">
            <button
              type="button"
              onClick={() => {
                setValue(message.content);
                setEditing(true);
              }}
              className="inline-flex h-11 items-center gap-1.5 rounded-md px-2 text-xs text-fg-soft"
            >
              <Pencil className="size-3.5" />
              編集
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Caret() {
  return <span className="ml-0.5 inline-block h-4 w-1.5 translate-y-0.5 bg-cinnabar align-middle" />;
}

function CodeBlock({ lang, text, pending }: { lang: string; text: string; pending?: boolean }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    if (!text) return;
    await writeClipboard(text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  }

  return (
    <div className="relative rounded-md bg-ink">
      <button
        type="button"
        onClick={() => void copy()}
        disabled={!text}
        className="absolute top-2 right-2 inline-flex h-11 items-center gap-1.5 rounded-md bg-sidebar-2 px-3 text-sm text-on-dark hover:bg-ink-soft disabled:opacity-40"
      >
        {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
        {copied ? "コピーした" : "コピー"}
      </button>
      <pre className="overflow-x-auto px-4 pt-14 pb-3 font-mono text-sm leading-relaxed text-on-dark">
        {lang ? (
          <span className="mb-2 block text-xs tracking-wide text-on-dark-soft uppercase">{lang}</span>
        ) : null}
        <code>
          {text || (pending ? "…" : "")}
          {pending && text ? <Caret /> : null}
        </code>
      </pre>
    </div>
  );
}

function MessageActions({
  content,
  onReference,
  onRegenerate,
}: {
  content: string;
  onReference?: (body: string) => void;
  onRegenerate?: () => void;
}) {
  const [copied, setCopied] = useState<"prompt" | "all" | null>(null);

  async function copy(kind: "prompt" | "all") {
    const text = kind === "prompt" ? copyablePrompt(content) : content;
    await writeClipboard(text);
    setCopied(kind);
    window.setTimeout(() => setCopied(null), 1400);
  }

  return (
    <div className="mt-3 flex flex-wrap gap-2">
      <Action onClick={() => void copy("prompt")}>
        {copied === "prompt" ? <Check className="size-4" /> : <Copy className="size-4" />}
        プロンプトをコピー
      </Action>
      <Action onClick={() => void copy("all")}>
        {copied === "all" ? <Check className="size-4" /> : <Copy className="size-4" />}
        全文
      </Action>
      {onReference ? (
        <Action onClick={() => onReference(copyablePrompt(content))}>
          <BookPlus className="size-4" />
          手本にする
        </Action>
      ) : null}
      {onRegenerate ? (
        <Action onClick={onRegenerate}>
          <RefreshCw className="size-4" />
          やり直す
        </Action>
      ) : null}
    </div>
  );
}

function Action({
  children,
  onClick,
}: {
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex h-10 items-center gap-1.5 rounded-md border border-line bg-paper-3 px-3 text-sm text-fg",
        "hover:border-cinnabar hover:text-cinnabar-deep",
      )}
    >
      {children}
    </button>
  );
}
