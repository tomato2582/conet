import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { formatDistanceToNow } from "date-fns";
import { ja } from "date-fns/locale";
import {
  BookOpen,
  Brain,
  KeyRound,
  Check,
  Menu,
  PanelLeft,
  PanelLeftClose,
  PanelTop,
  PanelTopClose,
  Pencil,
  Plus,
  RefreshCw,
  Send,
  SlidersHorizontal,
  Square,
  Tags,
  Trash2,
  X,
} from "lucide-react";
import { BrandMark } from "@/components/studio/brand-mark";
import { MessageView } from "@/components/studio/message-view";
import { StudioPanel, type PanelId } from "@/components/studio/panels";
import { useChatSend } from "@/components/studio/use-chat";
import { isProviderId, providerGroup, providerLabel } from "@/lib/studio/allow";
import { refreshCatalog } from "@/lib/studio/client";
import { cancelJob, detachForBackground, getJobs, resumePending, subscribeJobs } from "@/lib/studio/jobs";
import { RANDOM_MAX, WOMEN_MAX } from "@/lib/studio/prompt";
import { useStudio } from "@/lib/studio/store";
import type { ExposureMark, NudeMark, ProviderId } from "@/lib/studio/types";
import { cn } from "@/lib/utils";

const STARTERS = [
  "制服風のシャツとゆるいリボン。夕暮れの教室。上半身。プロンプトを作って。",
  "夏祭りの浴衣。全身。光は屋台の暖色。",
  "柔らかい室内光。椅子に座る。上半身。",
];

const PROVIDERS: ProviderId[] = ["orca", "openrouter", "nvidia", "cloudflare"];

export function StudioApp() {
  const [ready, setReady] = useState(false);
  const [panel, setPanel] = useState<PanelId>(null);
  const [navOpen, setNavOpen] = useState(false);
  const sidebar = useStudio((s) => s.chrome.sidebar);

  useEffect(() => {
    let alive = true;
    const finish = () => {
      if (alive) setReady(true);
    };
    const unsub = useStudio.persist.onFinishHydration(finish);
    void useStudio.persist.rehydrate();
    if (useStudio.persist.hasHydrated()) finish();
    return () => {
      alive = false;
      unsub();
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    resumePending();
    const fetchedAt = useStudio.getState().catalog.fetchedAt;
    if (Date.now() - fetchedAt >= 6 * 60 * 60 * 1000) {
      void refreshCatalog().catch(() => undefined);
    }
    const onShow = () => {
      if (document.visibilityState === "visible") resumePending();
    };
    const onHide = () => {
      if (document.visibilityState === "hidden") detachForBackground();
    };
    const onPageHide = () => detachForBackground();
    document.addEventListener("visibilitychange", onShow);
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pageshow", onShow);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      document.removeEventListener("visibilitychange", onShow);
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pageshow", onShow);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [ready]);

  if (!ready) return <Splash />;

  return (
    <div className="flex h-dvh overflow-hidden bg-paper text-fg">
      {sidebar ? (
        <Sidebar
          className="hidden md:flex"
          onNew={() => setNavOpen(false)}
          onPick={() => setNavOpen(false)}
        />
      ) : null}
      {navOpen ? (
        <div className="fixed inset-0 z-30 md:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-ink/50"
            aria-label="一覧を閉じる"
            onClick={() => setNavOpen(false)}
          />
          <Sidebar
            className="absolute inset-y-0 left-0 flex w-80 max-w-[85vw] shadow-xl"
            onNew={() => setNavOpen(false)}
            onPick={() => setNavOpen(false)}
            onClose={() => setNavOpen(false)}
          />
        </div>
      ) : null}
      <ChatColumn onOpenNav={() => setNavOpen(true)} onOpenPanel={setPanel} />
      <StudioPanel panel={panel} onClose={() => setPanel(null)} />
    </div>
  );
}

function Splash() {
  return (
    <main className="grid h-dvh place-items-center bg-paper text-fg">
      <div className="text-center">
        <BrandMark className="mx-auto size-14" />
        <h1 className="mt-4 font-display text-3xl">Conet</h1>
        <p className="mt-2 text-sm text-fg-soft">机を開いています</p>
      </div>
    </main>
  );
}

function Sidebar({
  className,
  onNew,
  onPick,
  onClose,
}: {
  className?: string;
  onNew: () => void;
  onPick: () => void;
  onClose?: () => void;
}) {
  const conversations = useStudio((s) => s.conversations);
  const activeId = useStudio((s) => s.activeId);
  const createConversation = useStudio((s) => s.createConversation);
  const selectConversation = useStudio((s) => s.selectConversation);
  const deleteConversation = useStudio((s) => s.deleteConversation);
  const deleteConversations = useStudio((s) => s.deleteConversations);
  const renameConversation = useStudio((s) => s.renameConversation);
  const keys = useStudio((s) => s.keys);
  const setChrome = useStudio((s) => s.setChrome);
  const jobs = useSyncExternalStore(subscribeJobs, getJobs, getJobs);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [titleDraft, setTitleDraft] = useState("");
  const [armed, setArmed] = useState<string | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [armedBulk, setArmedBulk] = useState(false);

  const visible = useMemo(() => {
    const needle = query.trim();
    if (!needle) return conversations;
    return conversations.filter((item) => item.title.includes(needle));
  }, [conversations, query]);

  const counts = PROVIDERS.map((provider) => {
    const count = (keys[provider] ?? []).filter((item) => item.secret.trim().length >= 8).length;
    return `${providerLabel(provider)} ${count}`;
  }).join(" · ");
  const pickedSet = useMemo(() => new Set(picked), [picked]);
  const emptyIds = conversations.filter((item) => item.messages.length === 0).map((item) => item.id);

  function leaveSelecting() {
    setSelecting(false);
    setPicked([]);
    setArmedBulk(false);
  }

  function togglePicked(id: string) {
    setArmedBulk(false);
    setPicked((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  }

  function selectVisible() {
    setArmedBulk(false);
    const ids = visible.map((item) => item.id);
    const allOn = ids.length > 0 && ids.every((id) => pickedSet.has(id));
    setPicked(allOn ? picked.filter((id) => !ids.includes(id)) : [...new Set([...picked, ...ids])]);
  }

  function selectEmpty() {
    setArmedBulk(false);
    setSelecting(true);
    setPicked(emptyIds);
  }

  function removePicked() {
    if (!picked.length) return;
    if (!armedBulk) {
      setArmedBulk(true);
      return;
    }
    for (const id of picked) cancelJob(id, { discard: true });
    deleteConversations(picked);
    leaveSelecting();
  }

  return (
    <aside className={cn("w-72 shrink-0 flex-col bg-sidebar text-on-dark", className)}>
      <div className="flex items-center gap-3 px-4 py-4">
        <BrandMark className="size-11" />
        <div className="min-w-0 flex-1">
          <p className="font-display text-xl leading-none">Conet</p>
          <p className="mt-1 text-xs text-on-dark-soft">いっしょに、プロンプト</p>
        </div>
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            className="grid size-11 place-items-center rounded-md hover:bg-sidebar-2"
            aria-label="閉じる"
          >
            <X className="size-5" />
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setChrome({ sidebar: false })}
            className="grid size-11 place-items-center rounded-md hover:bg-sidebar-2"
            aria-label="一覧をしまう"
          >
            <PanelLeftClose className="size-5" />
          </button>
        )}
      </div>
      <div className="px-3">
        <button
          type="button"
          onClick={() => {
            createConversation();
            onNew();
          }}
          className="flex h-11 w-full items-center justify-center gap-2 rounded-md bg-cinnabar text-sm text-on-dark hover:bg-cinnabar-deep"
        >
          <Plus className="size-4" />
          新しい机
        </button>
      </div>
      <div className="relative px-3 py-3">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="会話を探す"
          className="h-11 w-full rounded-md border border-line-dark bg-sidebar-2 px-3 pr-11 text-sm text-on-dark placeholder:text-on-dark-soft"
        />
        {query ? (
          <button
            type="button"
            onClick={() => setQuery("")}
            className="absolute top-3 right-3 grid size-11 place-items-center text-on-dark-soft"
            aria-label="検索を消す"
          >
            <X className="size-4" />
          </button>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-2 px-3 pb-2">
        {selecting ? (
          <>
            <button
              type="button"
              onClick={selectVisible}
              disabled={!visible.length}
              className="h-11 rounded-md px-2 text-sm text-on-dark-soft hover:text-on-dark disabled:opacity-40"
            >
              表示中をすべて
            </button>
            <button
              type="button"
              onClick={selectEmpty}
              disabled={!emptyIds.length}
              className="h-11 rounded-md px-2 text-sm text-on-dark-soft hover:text-on-dark disabled:opacity-40"
            >
              空の机
            </button>
            <button
              type="button"
              onClick={leaveSelecting}
              className="h-11 rounded-md px-2 text-sm text-on-dark-soft hover:text-on-dark"
            >
              完了
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => setSelecting(true)}
              disabled={!conversations.length}
              className="h-11 rounded-md px-2 text-sm text-on-dark-soft hover:text-on-dark disabled:opacity-40"
            >
              選択
            </button>
            {emptyIds.length ? (
              <button
                type="button"
                onClick={selectEmpty}
                className="h-11 rounded-md px-2 text-sm text-on-dark-soft hover:text-on-dark"
              >
                空の机を選ぶ
              </button>
            ) : null}
          </>
        )}
      </div>
      <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto px-3 pb-3">
        {visible.length === 0 ? (
          <li className="px-2 py-6 text-center text-sm text-on-dark-soft">会話はまだありません</li>
        ) : null}
        {visible.map((item) => {
          const active = item.id === activeId;
          const job = jobs.find((entry) => entry.conversationId === item.id);
          return (
            <li key={item.id}>
              {editing === item.id ? (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    renameConversation(item.id, titleDraft);
                    setEditing(null);
                  }}
                >
                  <input
                    autoFocus
                    value={titleDraft}
                    onChange={(event) => setTitleDraft(event.target.value)}
                    onBlur={() => {
                      renameConversation(item.id, titleDraft);
                      setEditing(null);
                    }}
                    className="h-11 w-full rounded-md border border-line-dark bg-ink px-3 text-sm text-on-dark"
                  />
                </form>
              ) : (
                <div
                  className={cn(
                    "group flex items-center gap-1 rounded-md pr-1",
                    active && !selecting ? "bg-sidebar-2" : "hover:bg-sidebar-2",
                    selecting && pickedSet.has(item.id) ? "bg-sidebar-2" : "",
                  )}
                >
                  {selecting ? (
                    <button
                      type="button"
                      aria-pressed={pickedSet.has(item.id)}
                      onClick={() => togglePicked(item.id)}
                      className="grid size-11 shrink-0 place-items-center"
                      aria-label={pickedSet.has(item.id) ? "選択を外す" : "選択する"}
                    >
                      <span
                        className={cn(
                          "grid size-5 place-items-center rounded border border-on-dark-soft",
                          pickedSet.has(item.id) && "border-cinnabar bg-cinnabar text-on-dark",
                        )}
                      >
                        {pickedSet.has(item.id) ? <Check className="size-3.5" /> : null}
                      </span>
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => {
                      if (selecting) {
                        togglePicked(item.id);
                        return;
                      }
                      selectConversation(item.id);
                      onPick();
                    }}
                    className="min-w-0 flex-1 px-3 py-2 text-left"
                  >
                    <span className="block truncate text-sm">{item.title}</span>
                    <span className="block text-xs text-on-dark-soft">
                      {job?.status === "running"
                        ? "執筆中"
                        : job?.status === "error"
                          ? "失敗"
                          : formatDistanceToNow(item.updatedAt, { addSuffix: true, locale: ja })}
                    </span>
                  </button>
                  {selecting ? null : (
                    <>
                  <button
                    type="button"
                    className="grid size-9 place-items-center rounded-md text-on-dark-soft hover:text-on-dark"
                    aria-label="名前を変える"
                    onClick={() => {
                      setEditing(item.id);
                      setTitleDraft(item.title);
                    }}
                  >
                    <Pencil className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    className="grid size-9 place-items-center rounded-md text-on-dark-soft hover:text-cinnabar-soft"
                    aria-label={armed === item.id ? "もう一度押すと削除" : "削除"}
                    onClick={() => {
                      if (armed !== item.id) {
                        setArmed(item.id);
                        return;
                      }
                      cancelJob(item.id, { discard: true });
                      deleteConversation(item.id);
                      setArmed(null);
                    }}
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                    </>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {selecting && picked.length ? (
        <div className="border-t border-line-dark px-3 py-3">
          <button
            type="button"
            onClick={removePicked}
            className="h-11 w-full rounded-md bg-cinnabar text-sm text-on-dark hover:bg-cinnabar-deep"
          >
            {armedBulk ? `${picked.length}件を削除する` : `${picked.length}件を削除`}
          </button>
        </div>
      ) : null}
      <div className="border-t border-line-dark px-4 py-3 text-xs text-on-dark-soft">{counts}</div>
    </aside>
  );
}

function ChatColumn({
  onOpenNav,
  onOpenPanel,
}: {
  onOpenNav: () => void;
  onOpenPanel: (panel: PanelId) => void;
}) {
  const conversations = useStudio((s) => s.conversations);
  const activeId = useStudio((s) => s.activeId);
  const provider = useStudio((s) => s.provider);
  const modelId = useStudio((s) => s.modelId);
  const catalog = useStudio((s) => s.catalog);
  const headerOpen = useStudio((s) => s.chrome.header);
  const sidebarOpen = useStudio((s) => s.chrome.sidebar);
  const setChrome = useStudio((s) => s.setChrome);
  const setProviderModel = useStudio((s) => s.setProviderModel);
  const addReference = useStudio((s) => s.addReference);
  const conversation = conversations.find((item) => item.id === activeId) ?? null;
  const scroller = useRef<HTMLDivElement>(null);
  const previousId = useRef<string | null>(null);
  const chat = useChatSend(() => onOpenPanel("keys"));
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    const node = scroller.current;
    if (!node) return;
    const switched = previousId.current !== (conversation?.id ?? null);
    previousId.current = conversation?.id ?? null;
    const nearBottom = node.scrollHeight - node.scrollTop - node.clientHeight < 48;
    if (switched || nearBottom) node.scrollTop = node.scrollHeight;
  }, [conversation?.id, conversation?.messages, chat.live?.content, chat.live?.reasoning]);

  const known = PROVIDERS.some(
    (item) => item === provider && catalog[item].some((model) => model.id === modelId),
  );
  const modelName =
    catalog[provider].find((model) => model.id === modelId)?.name ?? modelId;
  const hiddenId = chat.live?.messageId;
  const visibleMessages = (conversation?.messages ?? []).filter((message) => message.id !== hiddenId);

  async function refresh() {
    setRefreshing(true);
    try {
      await refreshCatalog();
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <section className="flex min-w-0 flex-1 flex-col">
      {headerOpen ? (
        <header className="border-b border-line bg-paper-3 px-3 py-3 md:px-6">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onOpenNav}
              className="grid size-11 place-items-center rounded-md border border-line md:hidden"
              aria-label="会話一覧"
            >
              <Menu className="size-5" />
            </button>
            {!sidebarOpen ? (
              <button
                type="button"
                onClick={() => setChrome({ sidebar: true })}
                className="hidden size-11 place-items-center rounded-md border border-line md:grid"
                aria-label="一覧を出す"
              >
                <PanelLeft className="size-5" />
              </button>
            ) : null}
            <div className="min-w-0 flex-1">
              <label className="sr-only" htmlFor="model-select">
                モデル
              </label>
              <select
                id="model-select"
                value={`${provider}::${modelId}`}
                onChange={(event) => {
                  const value = event.target.value;
                  const splitAt = value.indexOf("::");
                  const nextProvider = value.slice(0, splitAt);
                  if (!isProviderId(nextProvider)) return;
                  setProviderModel(nextProvider, value.slice(splitAt + 2));
                }}
                className="h-11 w-full max-w-xl rounded-md border border-line bg-paper px-3 text-sm"
              >
                {!known ? (
                  <option value={`${provider}::${modelId}`}>{modelId}（一覧外）</option>
                ) : null}
                {PROVIDERS.map((item) => (
                  <optgroup key={item} label={providerGroup(item)}>
                    {catalog[item].map((model) => (
                      <option key={`${item}-${model.id}`} value={`${item}::${model.id}`}>
                        {model.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
            <button
              type="button"
              onClick={() => void refresh()}
              className="grid size-11 place-items-center rounded-md border border-line"
              aria-label="無料モデル一覧を更新"
            >
              <RefreshCw className={cn("size-4", refreshing && "animate-spin")} />
            </button>
            <button
              type="button"
              onClick={() => setChrome({ header: false })}
              className="grid size-11 place-items-center rounded-md border border-line"
              aria-label="上の操作をしまう"
            >
              <PanelTopClose className="size-5" />
            </button>
          </div>
          <div className="mt-2 flex gap-2 overflow-x-auto">
            <ToolButton icon={KeyRound} label="接続" onClick={() => onOpenPanel("keys")} />
            <ToolButton icon={Pencil} label="指示" onClick={() => onOpenPanel("instructions")} />
            <ToolButton icon={Brain} label="メモリ" onClick={() => onOpenPanel("memory")} />
            <ToolButton icon={BookOpen} label="手本" onClick={() => onOpenPanel("references")} />
            <ToolButton icon={Tags} label="ワードバンク" onClick={() => onOpenPanel("words")} />
            <ToolButton icon={SlidersHorizontal} label="制作設定" onClick={() => onOpenPanel("production")} />
            <span className="ml-auto hidden items-center text-xs text-fg-soft sm:inline-flex">
              {providerLabel(provider)}
              {chat.background > 0 ? ` · ほか${chat.background}本 執筆中` : " · 無料のみ"}
            </span>
          </div>
          {catalog.warning ? (
            <p className="mt-2 text-xs text-cinnabar-deep">{catalog.warning}</p>
          ) : null}
        </header>
      ) : (
        <div className="flex h-12 items-center gap-1 border-b border-line bg-paper-3 px-2">
          <button
            type="button"
            onClick={onOpenNav}
            className="grid size-11 place-items-center rounded-md md:hidden"
            aria-label="会話一覧"
          >
            <Menu className="size-5" />
          </button>
          <button
            type="button"
            onClick={() => setChrome({ sidebar: true })}
            className="hidden size-11 place-items-center rounded-md md:grid"
            aria-label="一覧を出す"
          >
            <PanelLeft className="size-5" />
          </button>
          <button
            type="button"
            onClick={() => setChrome({ header: true })}
            className="grid size-11 place-items-center rounded-md"
            aria-label="上の操作を出す"
          >
            <PanelTop className="size-5" />
          </button>
          <p className="min-w-0 flex-1 truncate px-2 text-sm">{modelName}</p>
          {chat.background > 0 ? (
            <span className="shrink-0 text-xs text-fg-soft">ほか{chat.background}</span>
          ) : null}
          {chat.streaming ? <span className="shrink-0 text-xs text-cinnabar">執筆中</span> : null}
        </div>
      )}

      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6 md:px-6">
          {!conversation || (visibleMessages.length === 0 && !chat.live) ? (
            <EmptyDesk onPick={(prompt) => chat.send(prompt)} />
          ) : (
            visibleMessages.map((message, index) => (
              <MessageView
                key={message.id}
                message={message}
                onReference={
                  message.role === "assistant"
                    ? (body) => {
                        addReference({
                          title: `チャット ${new Date().toLocaleDateString("ja-JP")}`,
                          body,
                          enabled: true,
                        });
                        onOpenPanel("references");
                      }
                    : undefined
                }
                onRegenerate={
                  message.role === "assistant" &&
                  index === visibleMessages.length - 1 &&
                  !chat.streaming
                    ? () => chat.regenerate()
                    : undefined
                }
                onEdit={
                  message.role === "user" && !chat.streaming
                    ? (text) => chat.editRequest(message.id, text)
                    : undefined
                }
              />
            ))
          )}
          {chat.live ? (
            <MessageView
              pending
              message={{
                id: chat.live.messageId,
                role: "assistant",
                content: chat.live.content,
                reasoning: chat.live.reasoning || undefined,
                createdAt: Date.now(),
                model: chat.live.model,
                note: chat.live.note ?? undefined,
              }}
            />
          ) : null}
          {chat.error ? (
            <div className="flex items-start gap-2 rounded-md border border-cinnabar bg-cinnabar-soft px-4 py-3 text-sm text-cinnabar-deep">
              <p className="min-w-0 flex-1">{chat.error}</p>
              {activeId ? (
                <button
                  type="button"
                  onClick={() => chat.clearError()}
                  className="grid size-11 shrink-0 place-items-center rounded-md"
                  aria-label="エラーを閉じる"
                >
                  <X className="size-4" />
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      <form
        className="border-t border-line bg-paper-3 px-4 pt-3 pb-safe md:px-6"
        onSubmit={(event) => {
          event.preventDefault();
          chat.send();
        }}
      >
        <div className="mx-auto w-full max-w-3xl">
          <ShotBar />
          <RandomBar onRandom={() => chat.sendRandom(() => onOpenPanel("words"))} />
          <div className="flex items-end gap-2">
            <textarea
              value={chat.draft}
              onChange={(event) => chat.setDraft(event.target.value)}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                  event.preventDefault();
                  chat.send();
                }
              }}
              rows={2}
              placeholder="どんな絵にしたいか。空のまま送るとお任せ。⌘/Ctrl + Enter で送る"
              className="max-h-48 min-h-16 flex-1 resize-y rounded-md border border-line bg-paper px-3 py-3 text-base"
            />
            {chat.streaming ? (
              <button
                type="button"
                onClick={chat.stop}
                className="grid size-12 shrink-0 place-items-center rounded-md border border-line bg-paper text-fg"
                aria-label="この机を止める"
              >
                <Square className="size-4" />
              </button>
            ) : null}
            <button
              type="submit"
              className="grid size-12 shrink-0 place-items-center rounded-md bg-cinnabar text-on-dark hover:bg-cinnabar-deep"
              aria-label="送る"
            >
              <Send className="size-4" />
            </button>
          </div>
          <p className="mt-2 text-xs text-fg-soft">
            年齢の指定は入れません。loli も adult も書きません。ネガティブも書きません。執筆中でも送れます。画面を閉じても、執筆は続きます。
          </p>
        </div>
      </form>
    </section>
  );
}

function ShotBar() {
  const shot = useStudio((s) => s.shot);
  const toggleExposure = useStudio((s) => s.toggleExposure);
  const toggleNude = useStudio((s) => s.toggleNude);
  const toggleFlag = useStudio((s) => s.toggleFlag);
  const stepWomen = useStudio((s) => s.stepWomen);
  const exposure = shot?.exposure ?? null;
  const nude = shot?.nude ?? null;
  const existing = shot?.existing ?? false;
  const anthro = shot?.anthro ?? false;
  const women = shot?.women ?? null;
  const notes = [
    exposure === "o" ? "○ やや健全" : "",
    exposure === "oo" ? "◎ 挿入なし" : "",
    exposure === "star" ? "☆ 挿入" : "",
    exposure === "note" ? "♪ 露出を気にしない" : "",
    nude === "nude" ? "裸" : "",
    nude === "full" ? "全裸" : "",
    existing ? "既存キャラ" : "",
    anthro ? "擬人化" : "",
    women != null ? `女${women}人` : "",
  ].filter(Boolean);

  return (
    <div className="mb-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {EXPOSURE_BUTTONS.map((item) => (
          <MarkButton
            key={item.id}
            label={item.label}
            hint={item.hint}
            pressed={exposure === item.id}
            onClick={() => toggleExposure(item.id)}
          />
        ))}
        <span className="mx-0.5 hidden h-6 w-px bg-line sm:block" aria-hidden />
        {NUDE_BUTTONS.map((item) => (
          <MarkButton
            key={item.id}
            label={item.label}
            hint={item.hint}
            pressed={nude === item.id}
            onClick={() => toggleNude(item.id)}
          />
        ))}
        <MarkButton
          label="既存キャラ"
          hint="必ず既存のキャラクターにする"
          pressed={existing}
          onClick={() => toggleFlag("existing")}
        />
        <MarkButton
          label="擬人化"
          hint="必ず何かしらの擬人化にする"
          pressed={anthro}
          onClick={() => toggleFlag("anthro")}
        />
        <div
          className="inline-flex h-11 items-center rounded-md border border-line bg-paper"
          title="女の人数。男は数に含めない。無設定なら、その都度モデルが決める"
        >
          <span className="pl-3 text-xs text-fg-soft">人数</span>
          <button
            type="button"
            className="grid size-11 place-items-center text-lg disabled:opacity-40"
            aria-label="女の人数を減らす。1人のときは無設定に戻す"
            disabled={women == null}
            onClick={() => stepWomen(-1)}
          >
            −
          </button>
          <span className="min-w-14 text-center text-sm tabular-nums">
            {women == null ? "無設定" : `${women}人`}
          </span>
          <button
            type="button"
            className="grid size-11 place-items-center text-lg disabled:opacity-40"
            aria-label="女の人数を増やす。無設定のときは1人にする"
            disabled={women === WOMEN_MAX}
            onClick={() => stepWomen(1)}
          >
            +
          </button>
        </div>
      </div>
      {notes.length ? <p className="mt-1.5 text-xs text-fg-soft">{notes.join(" · ")}</p> : null}
    </div>
  );
}

const EXPOSURE_BUTTONS: { id: ExposureMark; label: string; hint: string }[] = [
  { id: "o", label: "○", hint: "乳首とまんこは出さない。着崩しや、ハイスリットなどの服の改造は可" },
  { id: "oo", label: "◎", hint: "乳首もまんこも可。挿入のない行為まで。挿入はしない" },
  { id: "star", label: "☆", hint: "挿入する" },
  { id: "note", label: "♪", hint: "乳首とまんこは必ず出す。本人は露出を気にしない" },
];

const NUDE_BUTTONS: { id: NudeMark; label: string; hint: string }[] = [
  { id: "nude", label: "裸", hint: "裸。乳首やまんこを隠さない袖、髪飾り、タイツは残す" },
  { id: "full", label: "全裸", hint: "完全に全裸" },
];

function RandomBar({ onRandom }: { onRandom: () => void }) {
  const count = useStudio((s) => s.randomCount);
  const setRandomCount = useStudio((s) => s.setRandomCount);
  const value = count || 5;

  return (
    <div className="mb-2 flex flex-wrap items-center gap-1.5">
      <button
        type="button"
        onClick={onRandom}
        className="inline-flex h-11 items-center rounded-md bg-ink px-3 text-sm text-on-dark"
        title="今のボタンに合うタグだけ引いて、必ず使って一つ書く"
      >
        完全ランダム
      </button>
      <div
        className="inline-flex h-11 items-center rounded-md border border-line bg-paper"
        title="完全ランダムで引くタグの数"
      >
        <span className="pl-3 text-xs text-fg-soft">要素</span>
        <button
          type="button"
          className="grid size-11 place-items-center text-lg disabled:opacity-40"
          aria-label="要素数を減らす"
          disabled={value <= 1}
          onClick={() => setRandomCount(value - 1)}
        >
          −
        </button>
        <span className="min-w-8 text-center text-sm tabular-nums">{value}</span>
        <button
          type="button"
          className="grid size-11 place-items-center text-lg disabled:opacity-40"
          aria-label="要素数を増やす"
          disabled={value >= RANDOM_MAX}
          onClick={() => setRandomCount(value + 1)}
        >
          +
        </button>
      </div>
    </div>
  );
}

function MarkButton({
  label,
  hint,
  pressed,
  onClick,
}: {
  label: string;
  hint: string;
  pressed: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      title={hint}
      onClick={onClick}
      className={cn(
        "inline-flex h-11 items-center justify-center rounded-md border px-3 text-sm",
        pressed
          ? "border-cinnabar bg-cinnabar text-on-dark"
          : "border-line bg-paper hover:border-cinnabar",
      )}
    >
      {label}
    </button>
  );
}

function EmptyDesk({ onPick }: { onPick: (prompt: string) => void }) {
  return (
    <div className="py-8 md:py-16">
      <p className="font-display text-4xl text-ink md:text-5xl">何を描く？</p>
      <p className="mt-3 max-w-xl text-sm text-pretty text-fg-soft">
        カスタム指示、メモリ、参考プロンプト、ワードバンクを見ながら、PixAIに貼るプロンプトを書きます。キーは接続から、APIごとに複数おけます。OrcaRouter、OpenRouter、NVIDIA、Cloudflare
        の無料モデルだけです。
      </p>
      <div className="mt-6 flex flex-col gap-2">
        {STARTERS.map((prompt) => (
          <button
            key={prompt}
            type="button"
            onClick={() => onPick(prompt)}
            className="rounded-md border border-line bg-paper-3 px-4 py-3 text-left text-sm hover:border-cinnabar"
          >
            {prompt}
          </button>
        ))}
      </div>
    </div>
  );
}

function ToolButton({
  icon: Icon,
  label,
  onClick,
}: {
  icon: typeof KeyRound;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-md border border-line bg-paper px-3 text-sm hover:border-cinnabar"
    >
      <Icon className="size-4" />
      {label}
    </button>
  );
}
