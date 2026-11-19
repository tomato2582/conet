import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import {
  FALLBACK_CLOUDFLARE,
  FALLBACK_NVIDIA,
  FALLBACK_OPENROUTER,
  FALLBACK_ORCA,
  onlyCurated,
} from "@/lib/studio/catalog";
import { BREAST_OUTLINE_INSTRUCTIONS, CUTE_FACE_INSTRUCTIONS, DANGO_DEFAULT_INSTRUCTIONS, DEFAULT_INSTRUCTIONS, DENSE_DEFAULT_INSTRUCTIONS, EMPTY_SHOT, FLEX_DEFAULT_INSTRUCTIONS, LEGACY_INSTRUCTIONS, MUST_CORE_INSTRUCTIONS, ONE_POINT_INSTRUCTIONS, OPEN_IDEA_INSTRUCTIONS, PREVIOUS_DEFAULT_INSTRUCTIONS, PUFFY_ALWAYS_INSTRUCTIONS, SCENE_IDEA_INSTRUCTIONS, RANDOM_MAX, WOMEN_MAX, WORD_MAX, sanitizeInstructionWeight, sanitizeShot } from "@/lib/studio/prompt";
import { mergeSeedReferences, sanitizeReferences, SEED_REFERENCES } from "@/lib/studio/reference-seed";
import { mergeSeedWords, seedBank } from "@/lib/studio/word-seed";
import type {
  ApiKeyEntry,
  BankTag,
  CatalogModel,
  CatalogState,
  ChatMessage,
  ChromePrefs,
  Conversation,
  ExposureMark,
  KeyRing,
  MemoryItem,
  NudeMark,
  ProviderId,
  ReferencePrompt,
  ShotPrefs,
} from "@/lib/studio/types";

const UNTITLED = "無題の机";

type StudioData = {
  conversations: Conversation[];
  activeId: string | null;
  provider: ProviderId;
  modelId: string;
  keys: KeyRing;
  cloudflareAccountId: string;
  chrome: ChromePrefs;
  temperature: number;
  instructionWeight: number;
  customInstructions: string;
  memories: MemoryItem[];
  references: ReferencePrompt[];
  words: BankTag[];
  randomCount: number;
  catalog: CatalogState;
  shot: ShotPrefs;
};

type StudioState = StudioData & {
  setProviderModel: (provider: ProviderId, modelId: string) => void;
  setProviderKeys: (provider: ProviderId, keys: ApiKeyEntry[]) => void;
  setCloudflareAccountId: (value: string) => void;
  setChrome: (patch: Partial<ChromePrefs>) => void;
  setTemperature: (value: number) => void;
  setInstructionWeight: (value: number) => void;
  setCustomInstructions: (value: string) => void;
  setCatalog: (catalog: CatalogState) => void;
  setShot: (patch: Partial<ShotPrefs>) => void;
  toggleExposure: (id: ExposureMark) => void;
  toggleNude: (id: NudeMark) => void;
  toggleFlag: (key: "existing" | "anthro") => void;
  stepWomen: (delta: number) => void;
  createConversation: () => string;
  selectConversation: (id: string) => void;
  deleteConversation: (id: string) => void;
  deleteConversations: (ids: string[]) => void;
  renameConversation: (id: string, title: string) => void;
  commitMessages: (id: string, messages: ChatMessage[], title?: string) => void;
  addMemory: (text: string) => void;
  updateMemory: (id: string, patch: Partial<Pick<MemoryItem, "text" | "enabled">>) => void;
  removeMemory: (id: string) => void;
  addReference: (input?: Partial<ReferencePrompt>) => void;
  updateReference: (id: string, patch: Partial<Omit<ReferencePrompt, "id">>) => void;
  removeReference: (id: string) => void;
  addWord: (tag: string, note: string) => void;
  updateWord: (id: string, patch: Partial<Pick<BankTag, "tag" | "note" | "enabled">>) => void;
  removeWord: (id: string) => void;
  setWords: (words: BankTag[]) => void;
  setRandomCount: (value: number) => void;
  importDesk: (payload: DeskExport) => void;
};

export type DeskExport = {
  version: 1;
  customInstructions: string;
  memories: MemoryItem[];
  references: ReferencePrompt[];
  words?: BankTag[];
};

function uid(): string {
  return crypto.randomUUID();
}

function emptyKeys(): KeyRing {
  return { orca: [], openrouter: [], nvidia: [], cloudflare: [] };
}

function sanitizeKeys(value: unknown): ApiKeyEntry[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 8).flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Partial<ApiKeyEntry>;
    const secret = typeof row.secret === "string" ? row.secret : "";
    return [
      {
        id: typeof row.id === "string" && row.id ? row.id : uid(),
        label: (typeof row.label === "string" && row.label.trim() ? row.label : "キー").slice(0, 40),
        secret,
      },
    ];
  });
}

export function sanitizeWords(value: unknown): BankTag[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, WORD_MAX).flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Partial<BankTag>;
    const tag = typeof row.tag === "string" ? row.tag.trim().slice(0, 80) : "";
    if (!tag) return [];
    return [
      {
        id: typeof row.id === "string" && row.id ? row.id : uid(),
        tag,
        note: typeof row.note === "string" ? row.note.trim().slice(0, 240) : "",
        enabled: row.enabled !== false,
      },
    ];
  });
}

export function sanitizeRandomCount(value: unknown): number {
  const count = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(count)) return 5;
  return Math.min(RANDOM_MAX, Math.max(1, count));
}

export function cleanInstructions(value: string): string {
  return value
    .replace(/キャラクターは必ず成人として書く。\n?/g, "")
    .replace(/ネガティブが必要なら分けて出す。\n?/g, "")
    .replace(/\n{3,}/g, "\n\n");
}

const initialCatalog = (): CatalogState => ({
  orca: FALLBACK_ORCA,
  openrouter: FALLBACK_OPENROUTER,
  nvidia: FALLBACK_NVIDIA,
  cloudflare: FALLBACK_CLOUDFLARE,
  fetchedAt: 0,
  warning: "",
});

const initial: StudioData = {
  conversations: [],
  activeId: null,
  provider: "orca",
  modelId: FALLBACK_ORCA[0].id,
  keys: emptyKeys(),
  cloudflareAccountId: "",
  chrome: { sidebar: true, header: true },
  temperature: 0.85,
  instructionWeight: 0.5,
  customInstructions: DEFAULT_INSTRUCTIONS,
  memories: [],
  references: SEED_REFERENCES,
  words: seedBank(),
  randomCount: 5,
  catalog: initialCatalog(),
  shot: EMPTY_SHOT,
};

export const useStudio = create<StudioState>()(
  persist(
    (set) => ({
      ...initial,
      setProviderModel: (provider, modelId) => set({ provider, modelId }),
      setProviderKeys: (provider, keys) =>
        set((state) => ({
          keys: { ...state.keys, [provider]: sanitizeKeys(keys) },
        })),
      setCloudflareAccountId: (cloudflareAccountId) => set({ cloudflareAccountId }),
      setChrome: (patch) => set((state) => ({ chrome: { ...state.chrome, ...patch } })),
      setTemperature: (temperature) => set({ temperature }),
      setInstructionWeight: (instructionWeight) =>
        set({ instructionWeight: sanitizeInstructionWeight(instructionWeight) }),
      setCustomInstructions: (customInstructions) => set({ customInstructions }),
      setCatalog: (catalog) => set({ catalog }),
      setShot: (patch) =>
        set((state) => ({ shot: sanitizeShot({ ...(state.shot ?? EMPTY_SHOT), ...patch }) })),
      toggleExposure: (id) =>
        set((state) => {
          const shot = sanitizeShot(state.shot);
          return { shot: { ...shot, exposure: shot.exposure === id ? null : id } };
        }),
      toggleNude: (id) =>
        set((state) => {
          const shot = sanitizeShot(state.shot);
          return { shot: { ...shot, nude: shot.nude === id ? null : id } };
        }),
      toggleFlag: (key) =>
        set((state) => {
          const shot = sanitizeShot(state.shot);
          return { shot: { ...shot, [key]: !shot[key] } };
        }),
      stepWomen: (delta) =>
        set((state) => {
          const shot = sanitizeShot(state.shot);
          if (delta < 0) {
            const women = shot.women == null || shot.women <= 1 ? null : shot.women - 1;
            return { shot: { ...shot, women } };
          }
          const women = shot.women == null ? 1 : Math.min(WOMEN_MAX, shot.women + 1);
          return { shot: { ...shot, women } };
        }),
      createConversation: () => {
        const id = uid();
        const now = Date.now();
        const conversation: Conversation = {
          id,
          title: UNTITLED,
          messages: [],
          createdAt: now,
          updatedAt: now,
        };
        set((state) => ({
          conversations: [conversation, ...state.conversations],
          activeId: id,
        }));
        return id;
      },
      selectConversation: (activeId) => set({ activeId }),
      deleteConversation: (id) =>
        set((state) => {
          const conversations = state.conversations.filter((item) => item.id !== id);
          const activeId =
            state.activeId === id ? (conversations[0]?.id ?? null) : state.activeId;
          return { conversations, activeId };
        }),
      deleteConversations: (ids) =>
        set((state) => {
          const drop = new Set(ids);
          if (!drop.size) return state;
          const conversations = state.conversations.filter((item) => !drop.has(item.id));
          const activeId = drop.has(state.activeId ?? "")
            ? (conversations[0]?.id ?? null)
            : state.activeId;
          return { conversations, activeId };
        }),
      renameConversation: (id, title) =>
        set((state) => ({
          conversations: state.conversations.map((item) =>
            item.id === id ? { ...item, title: title.trim() || UNTITLED, updatedAt: Date.now() } : item,
          ),
        })),
      commitMessages: (id, messages, title) =>
        set((state) => ({
          conversations: state.conversations.map((item) => {
            if (item.id !== id) return item;
            const nextTitle =
              title && (item.title === UNTITLED || !item.title.trim()) ? title : item.title;
            return { ...item, messages, title: nextTitle, updatedAt: Date.now() };
          }),
        })),
      addMemory: (text) =>
        set((state) => ({
          memories: [{ id: uid(), text: text.trim(), enabled: true }, ...state.memories].slice(0, 80),
        })),
      updateMemory: (id, patch) =>
        set((state) => ({
          memories: state.memories.map((item) => (item.id === id ? { ...item, ...patch } : item)),
        })),
      removeMemory: (id) =>
        set((state) => ({ memories: state.memories.filter((item) => item.id !== id) })),
      addReference: (input) =>
        set((state) => ({
          references: [
            {
              id: uid(),
              title: input?.title?.trim() || "無題の手本",
              body: input?.body ?? "",
              note: input?.note ?? "",
              enabled: input?.enabled ?? true,
            },
            ...state.references,
          ].slice(0, 24),
        })),
      updateReference: (id, patch) =>
        set((state) => ({
          references: state.references.map((item) => (item.id === id ? { ...item, ...patch } : item)),
        })),
      removeReference: (id) =>
        set((state) => ({
          references: state.references.filter((item) => item.id !== id),
        })),
      addWord: (tag, note) =>
        set((state) => {
          const cleaned = tag.trim().slice(0, 80);
          if (!cleaned) return state;
          return {
            words: [
              { id: uid(), tag: cleaned, note: note.trim().slice(0, 240), enabled: true },
              ...state.words,
            ].slice(0, WORD_MAX),
          };
        }),
      updateWord: (id, patch) =>
        set((state) => ({
          words: state.words.map((item) =>
            item.id === id
              ? {
                  ...item,
                  ...patch,
                  tag: (patch.tag ?? item.tag).slice(0, 80),
                  note: (patch.note ?? item.note).slice(0, 240),
                }
              : item,
          ),
        })),
      removeWord: (id) => set((state) => ({ words: state.words.filter((item) => item.id !== id) })),
      setWords: (words) => set({ words: sanitizeWords(words) }),
      setRandomCount: (value) => set({ randomCount: sanitizeRandomCount(value) }),
      importDesk: (payload) =>
        set((state) => ({
          customInstructions: payload.customInstructions,
          memories: payload.memories.slice(0, 80),
          references: payload.references.slice(0, 24),
          ...(payload.words ? { words: sanitizeWords(payload.words) } : {}),
        })),
    }),
    {
      name: "sumiki-desk-v1",
      version: 23,
      skipHydration: true,
      storage: createJSONStorage(() => localStorage),
      migrate: (persisted, version) => {
        const state = (persisted ?? {}) as Record<string, unknown> & {
          orcaKey?: string;
          openrouterKey?: string;
          keys?: Partial<KeyRing>;
          catalog?: Partial<CatalogState>;
          chrome?: Partial<ChromePrefs>;
          customInstructions?: string;
          cloudflareAccountId?: string;
          shot?: unknown;
          words?: unknown;
          randomCount?: unknown;
          references?: unknown;
          instructionWeight?: unknown;
        };
        const keys = emptyKeys();
        keys.orca = sanitizeKeys(state.keys?.orca);
        keys.openrouter = sanitizeKeys(state.keys?.openrouter);
        keys.nvidia = sanitizeKeys(state.keys?.nvidia);
        keys.cloudflare = sanitizeKeys(state.keys?.cloudflare);
        if (version < 2) {
          if (typeof state.orcaKey === "string" && state.orcaKey.trim() && keys.orca.length === 0) {
            keys.orca = [{ id: "legacy-orca", label: "キー 1", secret: state.orcaKey.trim() }];
          }
          if (
            typeof state.openrouterKey === "string" &&
            state.openrouterKey.trim() &&
            keys.openrouter.length === 0
          ) {
            keys.openrouter = [
              { id: "legacy-openrouter", label: "キー 1", secret: state.openrouterKey.trim() },
            ];
          }
        }
        const catalog = state.catalog;
        const retired = new Set(["skyla_(pokemon)", "aether_foundation_employee", "courtney_(pokemon)"]);
        const storedWords = sanitizeWords(state.words).filter(
          (item) => version >= 4 || !retired.has(item.tag.trim().toLowerCase()),
        );
        const seeded = version < 12 ? mergeSeedWords(storedWords) : storedWords;
        const dropped = new Set(["tanga_ibuki", "lillie", "lana", "acerola", "hakase_fuyuki"]);
        const words =
          version < 6
            ? seeded.filter((item) => !dropped.has(item.tag.trim().toLowerCase()))
            : seeded;
        const storedRefs = sanitizeReferences(state.references);
        const references = version < 7 ? mergeSeedReferences(storedRefs) : storedRefs;
        return {
          ...state,
          keys,
          cloudflareAccountId: state.cloudflareAccountId ?? "",
          chrome: {
            sidebar: state.chrome?.sidebar !== false,
            header: state.chrome?.header !== false,
          },
          customInstructions: cleanInstructions(
            version < 23 &&
            typeof state.customInstructions === "string" &&
            (state.customInstructions.trim() === LEGACY_INSTRUCTIONS.trim() ||
              state.customInstructions.trim() === PREVIOUS_DEFAULT_INSTRUCTIONS.trim() ||
              state.customInstructions.trim() === DANGO_DEFAULT_INSTRUCTIONS.trim() ||
              state.customInstructions.trim() === DENSE_DEFAULT_INSTRUCTIONS.trim() ||
              state.customInstructions.trim() === FLEX_DEFAULT_INSTRUCTIONS.trim() ||
              state.customInstructions.trim() === PUFFY_ALWAYS_INSTRUCTIONS.trim() ||
              state.customInstructions.trim() === BREAST_OUTLINE_INSTRUCTIONS.trim() ||
              state.customInstructions.trim() === MUST_CORE_INSTRUCTIONS.trim() ||
              state.customInstructions.trim() === SCENE_IDEA_INSTRUCTIONS.trim() ||
              state.customInstructions.trim() === ONE_POINT_INSTRUCTIONS.trim() ||
              state.customInstructions.trim() === OPEN_IDEA_INSTRUCTIONS.trim() ||
              state.customInstructions.trim() === CUTE_FACE_INSTRUCTIONS.trim())
              ? DEFAULT_INSTRUCTIONS
              : typeof state.customInstructions === "string"
                ? state.customInstructions
                : DEFAULT_INSTRUCTIONS,
          ),
          catalog: {
            orca: onlyCurated(catalog?.orca, FALLBACK_ORCA),
            openrouter: onlyCurated(catalog?.openrouter, FALLBACK_OPENROUTER),
            nvidia: onlyCurated(catalog?.nvidia, FALLBACK_NVIDIA),
            cloudflare: onlyCurated(catalog?.cloudflare, FALLBACK_CLOUDFLARE),
            fetchedAt: catalog?.fetchedAt ?? 0,
            warning: catalog?.warning ?? "",
          },
          shot: sanitizeShot(state.shot),
          words: sanitizeWords(words),
          randomCount: sanitizeRandomCount(state.randomCount),
          references,
          instructionWeight:
            version < 11
              ? sanitizeInstructionWeight(
                  (typeof state.instructionWeight === "number" && Number.isFinite(state.instructionWeight)
                    ? Math.min(1, Math.max(0, state.instructionWeight))
                    : 1) * 0.5,
                )
              : sanitizeInstructionWeight(state.instructionWeight),
        } as StudioData;
      },
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        const next = cleanInstructions(state.customInstructions);
        if (next !== state.customInstructions) state.setCustomInstructions(next);
        const catalog = {
          ...state.catalog,
          orca: onlyCurated(state.catalog.orca, FALLBACK_ORCA),
          openrouter: onlyCurated(state.catalog.openrouter, FALLBACK_OPENROUTER),
          nvidia: onlyCurated(state.catalog.nvidia, FALLBACK_NVIDIA),
          cloudflare: onlyCurated(state.catalog.cloudflare, FALLBACK_CLOUDFLARE),
        };
        state.setCatalog(catalog);
        const models = catalog[state.provider] ?? [];
        if (models.length && !models.some((model) => model.id === state.modelId)) {
          state.setProviderModel(state.provider, models[0].id);
        }
        state.setShot(sanitizeShot(state.shot));
        state.setWords(state.words ?? []);
        state.setRandomCount(state.randomCount);
        state.setInstructionWeight(state.instructionWeight);
      },
      partialize: (state) => ({
        conversations: state.conversations.slice(0, 40).map((conversation) => ({
          ...conversation,
          messages: conversation.messages.slice(-80),
        })),
        activeId: state.activeId,
        provider: state.provider,
        modelId: state.modelId,
        keys: state.keys,
        cloudflareAccountId: state.cloudflareAccountId,
        chrome: state.chrome,
        temperature: state.temperature,
        instructionWeight: state.instructionWeight,
        customInstructions: state.customInstructions,
        memories: state.memories,
        references: state.references,
        words: state.words,
        randomCount: state.randomCount,
        catalog: state.catalog,
        shot: state.shot,
      }),
    },
  ),
);

export function activeConversation(): Conversation | null {
  const { conversations, activeId } = useStudio.getState();
  return conversations.find((item) => item.id === activeId) ?? null;
}

export function titleFromText(text: string): string {
  const line = text.replace(/\s+/g, " ").trim();
  if (!line) return UNTITLED;
  return line.length > 28 ? `${line.slice(0, 28)}…` : line;
}

export function keysFor(provider: ProviderId, state: StudioData = useStudio.getState()): ApiKeyEntry[] {
  return (state.keys?.[provider] ?? []).filter((item) => item.secret.trim().length >= 8);
}

export function providerReady(provider: ProviderId, state: StudioData = useStudio.getState()): boolean {
  if (provider === "cloudflare" && !/^[a-z0-9]{16,40}$/i.test(state.cloudflareAccountId.trim())) {
    return false;
  }
  return keysFor(provider, state).length > 0;
}

export function currentModels(state: StudioData = useStudio.getState()): CatalogModel[] {
  return state.catalog[state.provider] ?? [];
}
