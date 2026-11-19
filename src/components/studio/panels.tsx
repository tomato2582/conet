import { useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import * as Switch from "@radix-ui/react-switch";
import { Eye, EyeOff, Plus, Trash2, X } from "lucide-react";
import { isProviderId } from "@/lib/studio/allow";
import { DEFAULT_INSTRUCTIONS } from "@/lib/studio/prompt";
import { useStudio, sanitizeWords, type DeskExport } from "@/lib/studio/store";
import { SEED_CATEGORIES, wordCategory } from "@/lib/studio/word-seed";
import type { ApiKeyEntry, ProviderId } from "@/lib/studio/types";
import { cn } from "@/lib/utils";

export type PanelId = "keys" | "instructions" | "memory" | "references" | "words" | "production" | null;

const TITLES: Record<Exclude<PanelId, null>, string> = {
  keys: "接続",
  instructions: "カスタム指示",
  memory: "メモリ",
  references: "参考プロンプト",
  words: "ワードバンク",
  production: "制作設定",
};

const PROVIDER_ORDER: ProviderId[] = ["orca", "openrouter", "nvidia", "cloudflare"];

const PROVIDER_META: Record<
  ProviderId,
  { label: string; hint: string; href: string; linkLabel: string; placeholder: string }
> = {
  orca: {
    label: "OrcaRouter",
    hint: "DeepSeek の -free だけ。未課金は1日の枠が小さめです。",
    href: "https://orcarouter.ai",
    linkLabel: "OrcaRouter のキーを作る",
    placeholder: "sk-…",
  },
  openrouter: {
    label: "OpenRouter",
    hint: "一覧のモデルだけ。未課金は1日50回です。",
    href: "https://openrouter.ai/keys",
    linkLabel: "OpenRouter のキーを作る",
    placeholder: "sk-or-…",
  },
  nvidia: {
    label: "NVIDIA",
    hint: "build.nvidia.com の無料キーだけ。試作エンドポイントで、有料キーは入れないでください。",
    href: "https://build.nvidia.com",
    linkLabel: "NVIDIA のキーを作る",
    placeholder: "nvapi-…",
  },
  cloudflare: {
    label: "Cloudflare",
    hint: "Workers AI のトークンとアカウントID。1日1万Neuronsまで無料で、有料プランは超過分が課金されます。有料専用モデルは通しません。",
    href: "https://dash.cloudflare.com/profile/api-tokens",
    linkLabel: "Cloudflare のトークンを作る",
    placeholder: "APIトークン",
  },
};

export function StudioPanel({
  panel,
  onClose,
}: {
  panel: Exclude<PanelId, null> | null;
  onClose: () => void;
}) {
  return (
    <Dialog.Root open={panel !== null} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-ink/50" />
        <Dialog.Content className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col bg-paper-3 outline-none">
          <header className="flex items-center justify-between border-b border-line px-5 py-4">
            <Dialog.Title className="font-display text-2xl">
              {panel ? TITLES[panel] : ""}
            </Dialog.Title>
            <Dialog.Close className="grid size-11 place-items-center rounded-md text-fg hover:bg-paper-2">
              <X className="size-5" />
              <span className="sr-only">閉じる</span>
            </Dialog.Close>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 pb-safe">
            {panel === "keys" ? <KeysPanel /> : null}
            {panel === "instructions" ? <InstructionsPanel /> : null}
            {panel === "memory" ? <MemoryPanel /> : null}
            {panel === "references" ? <ReferencesPanel /> : null}
            {panel === "words" ? <WordsPanel /> : null}
            {panel === "production" ? <ProductionPanel /> : null}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function ProductionPanel() {
  const temperature = useStudio((s) => s.temperature);
  const setTemperature = useStudio((s) => s.setTemperature);
  return (
    <div className="space-y-3">
      <p className="text-sm text-fg-soft">
        出力のばらつきです。低いほど条件に忠実で、高いほど毎回ずれます。
      </p>
      <label className="block">
        <span className="mb-2 flex items-center justify-between text-sm">
          揺らぎ
          <span className="tabular-nums text-fg-soft">{temperature.toFixed(2)}</span>
        </span>
        <input
          type="range"
          min={0.2}
          max={1.2}
          step={0.05}
          value={temperature}
          onChange={(event) => setTemperature(Number(event.target.value))}
          className="w-full"
        />
        <span className="mt-1 flex justify-between text-xs text-fg-soft">
          <span>正確</span>
          <span>自由</span>
        </span>
      </label>
    </div>
  );
}

function KeysPanel() {
  const activeProvider = useStudio((s) => s.provider);
  const keys = useStudio((s) => s.keys);
  const cloudflareAccountId = useStudio((s) => s.cloudflareAccountId);
  const setProviderKeys = useStudio((s) => s.setProviderKeys);
  const setCloudflareAccountId = useStudio((s) => s.setCloudflareAccountId);
  const [editing, setEditing] = useState<ProviderId>(activeProvider);
  const meta = PROVIDER_META[editing];
  const rows = keys[editing] ?? [];

  function updateRow(id: string, patch: Partial<Pick<ApiKeyEntry, "label" | "secret">>) {
    setProviderKeys(
      editing,
      rows.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    );
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-fg-soft">
        キーはこのブラウザだけに残ります。送信のときだけ通し、サーバーには保存しません。無料モデル以外は通しません。同じAPIのキーは上から順に使い、拒否・残高なし・回数制限なら次のキーでやり直します。
      </p>
      <label className="block">
        <span className="mb-2 block text-sm font-medium">API</span>
        <select
          value={editing}
          onChange={(event) => {
            if (isProviderId(event.target.value)) setEditing(event.target.value);
          }}
          className="h-11 w-full rounded-md border border-line bg-paper px-3 text-sm"
        >
          {PROVIDER_ORDER.map((id) => (
            <option key={id} value={id}>
              {PROVIDER_META[id].label}
            </option>
          ))}
        </select>
        <span className="mt-2 block text-xs text-fg-soft">{meta.hint}</span>
      </label>
      <a
        href={meta.href}
        target="_blank"
        rel="noreferrer"
        className="inline-block text-sm text-cinnabar-deep underline decoration-cinnabar-soft underline-offset-2"
      >
        {meta.linkLabel}
      </a>
      {editing === "cloudflare" ? (
        <label className="block">
          <span className="mb-2 block text-sm font-medium">アカウントID</span>
          <input
            value={cloudflareAccountId}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setCloudflareAccountId(event.target.value.trim())}
            placeholder="32桁のアカウントID"
            className="h-11 w-full rounded-md border border-line bg-paper px-3 text-sm"
          />
        </label>
      ) : null}
      <ul className="space-y-4">
        {rows.length === 0 ? (
          <li className="rounded-md border border-dashed border-line px-3 py-6 text-center text-sm text-fg-soft">
            キーはまだありません。
          </li>
        ) : null}
        {rows.map((item, index) => (
          <li key={item.id}>
            <KeyRow
              index={index}
              label={item.label}
              secret={item.secret}
              placeholder={meta.placeholder}
              onLabel={(label) => updateRow(item.id, { label })}
              onSecret={(secret) => updateRow(item.id, { secret })}
              onRemove={() => setProviderKeys(editing, rows.filter((row) => row.id !== item.id))}
            />
          </li>
        ))}
      </ul>
      <button
        type="button"
        disabled={rows.length >= 8}
        onClick={() =>
          setProviderKeys(editing, [
            ...rows,
            { id: crypto.randomUUID(), label: `キー ${rows.length + 1}`, secret: "" },
          ])
        }
        className="inline-flex h-11 items-center gap-2 rounded-md bg-cinnabar px-4 text-sm text-on-dark hover:bg-cinnabar-deep disabled:opacity-40"
      >
        <Plus className="size-4" />
        キーを追加
      </button>
    </div>
  );
}

function KeyRow({
  index,
  label,
  secret,
  placeholder,
  onLabel,
  onSecret,
  onRemove,
}: {
  index: number;
  label: string;
  secret: string;
  placeholder: string;
  onLabel: (value: string) => void;
  onSecret: (value: string) => void;
  onRemove: () => void;
}) {
  const [shown, setShown] = useState(false);
  return (
    <div className="space-y-2">
      <span className="block text-sm font-medium">キー {index + 1}</span>
      <input
        value={label}
        onChange={(event) => onLabel(event.target.value)}
        aria-label={`キー ${index + 1} の名前`}
        className="h-11 w-full rounded-md border border-line bg-paper px-3 text-sm"
      />
      <span className="flex gap-2">
        <input
          type={shown ? "text" : "password"}
          value={secret}
          autoComplete="off"
          spellCheck={false}
          placeholder={placeholder}
          onChange={(event) => onSecret(event.target.value)}
          className="h-11 min-w-0 flex-1 rounded-md border border-line bg-paper px-3 text-sm"
        />
        <button
          type="button"
          onClick={() => setShown((open) => !open)}
          className="grid size-11 place-items-center rounded-md border border-line bg-paper"
          aria-label={shown ? "隠す" : "表示"}
        >
          {shown ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
        <button
          type="button"
          onClick={onRemove}
          className="grid size-11 place-items-center rounded-md border border-line bg-paper text-fg-soft hover:text-cinnabar"
          aria-label="このキーを削除"
        >
          <Trash2 className="size-4" />
        </button>
      </span>
    </div>
  );
}

function InstructionsPanel() {
  const customInstructions = useStudio((s) => s.customInstructions);
  const instructionWeight = useStudio((s) => s.instructionWeight);
  const setCustomInstructions = useStudio((s) => s.setCustomInstructions);
  const setInstructionWeight = useStudio((s) => s.setInstructionWeight);
  const fileRef = useRef<HTMLInputElement>(null);
  const [note, setNote] = useState("");

  function exportDesk() {
    const state = useStudio.getState();
    const payload: DeskExport = {
      version: 1,
      customInstructions: state.customInstructions,
      memories: state.memories,
      references: state.references,
      words: state.words,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "conet-desk.json";
    link.click();
    URL.revokeObjectURL(url);
  }

  async function importDesk(file: File) {
    try {
      const json = JSON.parse(await file.text()) as Partial<DeskExport>;
      if (!json || json.version !== 1 || typeof json.customInstructions !== "string") {
        setNote("このファイルは Conet の机の設定ではありません。");
        return;
      }
      useStudio.getState().importDesk({
        version: 1,
        customInstructions: json.customInstructions,
        memories: Array.isArray(json.memories) ? json.memories.filter(validMemory) : [],
        references: Array.isArray(json.references) ? json.references.filter(validReference) : [],
        ...(Array.isArray(json.words) ? { words: sanitizeWords(json.words) } : {}),
      });
      setNote(
        Array.isArray(json.words)
          ? "指示・メモリ・手本・ワードバンクを読み込みました。キーは含まれていません。"
          : "指示・メモリ・手本を読み込みました。このファイルにワードバンクはなかったので、今のタグはそのままです。",
      );
    } catch {
      setNote("ファイルを読めませんでした。");
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-fg-soft">
        毎回のシステム文に入ります。年齢タグは入れません。loli も adult も落とします。ネガティブプロンプトは出しません。大人指定への書き換えもしません。50 が今までの強さです。100 はそれより指示を優先します。
      </p>
      <label className="block">
        <span className="mb-2 flex items-center justify-between text-sm">
          影響力
          <span className="tabular-nums text-fg-soft">{Math.round(instructionWeight * 100)}</span>
        </span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={instructionWeight}
          onChange={(event) => setInstructionWeight(Number(event.target.value))}
          className="w-full"
        />
        <span className="mt-1 flex justify-between text-xs text-fg-soft">
          <span>使わない</span>
          <span>基準</span>
          <span>より強く</span>
        </span>
      </label>
      <textarea
        value={customInstructions}
        onChange={(event) => setCustomInstructions(event.target.value)}
        className="min-h-80 w-full resize-y rounded-md border border-line bg-paper px-3 py-3 text-sm leading-relaxed"
      />
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setCustomInstructions(DEFAULT_INSTRUCTIONS)}
          className="h-11 rounded-md border border-line px-3 text-sm"
        >
          初期の指示に戻す
        </button>
        <button type="button" onClick={exportDesk} className="h-11 rounded-md border border-line px-3 text-sm">
          机を書き出す
        </button>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="h-11 rounded-md border border-line px-3 text-sm"
        >
          机を読み込む
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void importDesk(file);
            event.target.value = "";
          }}
        />
      </div>
      {note ? <p className="text-sm text-fg-soft">{note}</p> : null}
    </div>
  );
}

function WordsPanel() {
  const words = useStudio((s) => s.words);
  const addWord = useStudio((s) => s.addWord);
  const updateWord = useStudio((s) => s.updateWord);
  const removeWord = useStudio((s) => s.removeWord);
  const [tag, setTag] = useState("");
  const [note, setNote] = useState("");
  const [kind, setKind] = useState("すべて");
  const extras = words
    .map((item) => wordCategory(item.note))
    .filter((item) => item && !(SEED_CATEGORIES as readonly string[]).includes(item));
  const kinds = ["すべて", ...SEED_CATEGORIES, ...Array.from(new Set(extras))];
  const shown = kind === "すべて" ? words : words.filter((item) => wordCategory(item.note) === kind);
  const enabled = words.filter((item) => item.enabled && item.tag.trim()).length;

  return (
    <div className="space-y-4">
      <p className="text-sm text-fg-soft">
        タグと説明を登録します。オンのタグは辞書として渡します。全部は使いません。完全ランダムは、オンのうち今のボタンに合うものだけ引き、そこに状況の発想を一つ足します。タグの羅列では終わらせません。髪色・髪型・目・服装は一人につき一つです。体位は☆のときだけ。既存キャラと擬人化は、そのボタンがオンのときだけ引き、必ず1つ入ります。不要なものはオフにしてください。
      </p>
      <p className="text-xs text-fg-soft">
        {words.length}件、オン {enabled}件
      </p>
      <form
        className="space-y-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (!tag.trim()) return;
          addWord(tag, note);
          setTag("");
          setNote("");
        }}
      >
        <input
          value={tag}
          onChange={(event) => setTag(event.target.value)}
          placeholder="タグ 例: blunt bangs"
          className="h-11 w-full rounded-md border border-line bg-paper px-3 text-sm"
        />
        <div className="flex gap-2">
          <input
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="説明（任意） 例: 髪型。ぱっつん"
            className="h-11 min-w-0 flex-1 rounded-md border border-line bg-paper px-3 text-sm"
          />
          <button
            type="submit"
            className="grid size-11 place-items-center rounded-md bg-cinnabar text-on-dark hover:bg-cinnabar-deep"
            aria-label="タグを追加"
          >
            <Plus className="size-5" />
          </button>
        </div>
      </form>
      <div className="sticky top-0 z-10 bg-paper-3 py-2">
        <div className="flex flex-wrap gap-1.5">
          {kinds.map((item) => (
            <button
              key={item}
              type="button"
              aria-pressed={kind === item}
              onClick={() => setKind(item)}
              className={cn(
                "h-8 rounded-full border px-3 text-xs",
                kind === item ? "border-ink bg-ink text-on-dark" : "border-line bg-paper text-fg",
              )}
            >
              {item}
            </button>
          ))}
        </div>
      </div>
      <ul className="space-y-2">
        {shown.length === 0 ? (
          <li className="rounded-md border border-dashed border-line px-3 py-6 text-center text-sm text-fg-soft">
            {words.length === 0 ? "まだタグはありません。" : "この分類にはタグがありません。"}
          </li>
        ) : null}
        {shown.map((item) => (
          <li key={item.id} className="space-y-2 rounded-md border border-line bg-paper px-3 py-3">
            <div className="flex items-center gap-2">
              <Toggle
                checked={item.enabled}
                label="このタグを参照"
                onChange={(enabled) => updateWord(item.id, { enabled })}
              />
              <input
                value={item.tag}
                onChange={(event) => updateWord(item.id, { tag: event.target.value })}
                aria-label="タグ"
                className="h-11 min-w-0 flex-1 rounded-md border border-line bg-paper-3 px-3 text-sm"
              />
              <button
                type="button"
                onClick={() => removeWord(item.id)}
                className="grid size-11 shrink-0 place-items-center rounded-md text-fg-soft hover:text-cinnabar"
                aria-label="削除"
              >
                <Trash2 className="size-4" />
              </button>
            </div>
            <input
              value={item.note}
              onChange={(event) => updateWord(item.id, { note: event.target.value })}
              placeholder="説明"
              aria-label="タグの説明"
              className="h-11 w-full rounded-md border border-line bg-paper-3 px-3 text-sm"
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

function validMemory(value: unknown): value is DeskExport["memories"][number] {
  if (!value || typeof value !== "object") return false;
  const item = value as { id?: unknown; text?: unknown; enabled?: unknown };
  return typeof item.id === "string" && typeof item.text === "string" && typeof item.enabled === "boolean";
}

function validReference(value: unknown): value is DeskExport["references"][number] {
  if (!value || typeof value !== "object") return false;
  const item = value as { id?: unknown; title?: unknown; body?: unknown; note?: unknown; enabled?: unknown };
  return (
    typeof item.id === "string" &&
    typeof item.title === "string" &&
    typeof item.body === "string" &&
    typeof item.note === "string" &&
    typeof item.enabled === "boolean"
  );
}

function MemoryPanel() {
  const memories = useStudio((s) => s.memories);
  const addMemory = useStudio((s) => s.addMemory);
  const updateMemory = useStudio((s) => s.updateMemory);
  const removeMemory = useStudio((s) => s.removeMemory);
  const [text, setText] = useState("");

  return (
    <div className="space-y-4">
      <p className="text-sm text-fg-soft">
        画風の好み、触らない部位、よく使う衣装。プロンプトを書くたびに、オンのものだけ渡します。
      </p>
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (!text.trim()) return;
          addMemory(text);
          setText("");
        }}
      >
        <input
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="例: 前髪はいじらない"
          className="h-11 min-w-0 flex-1 rounded-md border border-line bg-paper px-3 text-sm"
        />
        <button
          type="submit"
          className="grid size-11 place-items-center rounded-md bg-cinnabar text-on-dark hover:bg-cinnabar-deep"
          aria-label="メモリを追加"
        >
          <Plus className="size-5" />
        </button>
      </form>
      <ul className="space-y-2">
        {memories.length === 0 ? (
          <li className="rounded-md border border-dashed border-line px-3 py-6 text-center text-sm text-fg-soft">
            まだメモリはありません。
          </li>
        ) : null}
        {memories.map((item) => (
          <li key={item.id} className="flex items-start gap-3 rounded-md border border-line bg-paper px-3 py-3">
            <Toggle
              checked={item.enabled}
              label="このメモリを参照"
              onChange={(enabled) => updateMemory(item.id, { enabled })}
            />
            <p className={cn("min-w-0 flex-1 text-sm", !item.enabled && "text-fg-soft line-through")}>
              {item.text}
            </p>
            <button
              type="button"
              onClick={() => removeMemory(item.id)}
              className="grid size-11 shrink-0 place-items-center rounded-md text-fg-soft hover:text-cinnabar"
              aria-label="削除"
            >
              <Trash2 className="size-4" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ReferencesPanel() {
  const references = useStudio((s) => s.references);
  const addReference = useStudio((s) => s.addReference);
  const updateReference = useStudio((s) => s.updateReference);
  const removeReference = useStudio((s) => s.removeReference);

  return (
    <div className="space-y-4">
      <p className="text-sm text-fg-soft">
        うまくいったプロンプトを置いておくと、語彙と密度を真似ます。丸写しはしません。01から15は入れてあります。不要なものはオフにしてください。
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => addReference({ title: "新しい手本", body: "", enabled: true })}
          className="inline-flex h-11 items-center gap-2 rounded-md bg-cinnabar px-4 text-sm text-on-dark hover:bg-cinnabar-deep"
        >
          <Plus className="size-4" />
          手本を追加
        </button>
        <button
          type="button"
          onClick={() =>
            addReference({
              title: "密度の見本",
              enabled: false,
              note: "カンマ区切り。塊ごとに改行。",
              body: "masterpiece, best quality, ultra-detailed,\n1girl, blunt bangs, calm eyes,\nwhite shirt, loose ribbon, soft window light,\nupper body, looking at viewer",
            })
          }
          className="h-11 rounded-md border border-line px-4 text-sm"
        >
          短い見本を入れる
        </button>
      </div>
      <ul className="space-y-4">
        {references.length === 0 ? (
          <li className="rounded-md border border-dashed border-line px-3 py-6 text-center text-sm text-fg-soft">
            手本はまだありません。チャットの「手本にする」からも追加できます。
          </li>
        ) : null}
        {references.map((item) => (
          <li key={item.id} className="space-y-2 rounded-md border border-line bg-paper p-3">
            <div className="flex items-center gap-2">
              <Toggle
                checked={item.enabled}
                label="この手本を参照"
                onChange={(enabled) => updateReference(item.id, { enabled })}
              />
              <input
                value={item.title}
                onChange={(event) => updateReference(item.id, { title: event.target.value })}
                className="h-11 min-w-0 flex-1 rounded-md border border-line bg-paper-3 px-3 text-sm"
                aria-label="手本の名前"
              />
              <button
                type="button"
                onClick={() => removeReference(item.id)}
                className="grid size-11 place-items-center rounded-md text-fg-soft hover:text-cinnabar"
                aria-label="削除"
              >
                <Trash2 className="size-4" />
              </button>
            </div>
            <textarea
              value={item.body}
              onChange={(event) => updateReference(item.id, { body: event.target.value })}
              placeholder="プロンプト本文"
              className="min-h-36 w-full resize-y rounded-md border border-line bg-paper-3 px-3 py-2 font-mono text-sm"
            />
            <input
              value={item.note}
              onChange={(event) => updateReference(item.id, { note: event.target.value })}
              placeholder="メモ（任意）: 何を真似するか"
              className="h-11 w-full rounded-md border border-line bg-paper-3 px-3 text-sm"
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
}) {
  return (
    <Switch.Root
      checked={checked}
      onCheckedChange={onChange}
      aria-label={label}
      className="mt-2.5 h-6 w-11 shrink-0 rounded-full bg-line data-[state=checked]:bg-cinnabar"
    >
      <Switch.Thumb className="block size-5 translate-x-0.5 rounded-full bg-paper-3 transition-transform data-[state=checked]:translate-x-5" />
    </Switch.Root>
  );
}
