export type ProviderId = "orca" | "openrouter" | "nvidia" | "cloudflare";

export type CatalogModel = {
  id: string;
  name: string;
  provider: ProviderId;
};

export type ApiKeyEntry = {
  id: string;
  label: string;
  secret: string;
};

export type KeyRing = Record<ProviderId, ApiKeyEntry[]>;

export type ChromePrefs = {
  sidebar: boolean;
  header: boolean;
};

export type ChatRole = "user" | "assistant";

export type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  reasoning?: string;
  createdAt: number;
  model?: string;
  note?: string;
};

export type Conversation = {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
};

export type MemoryItem = {
  id: string;
  text: string;
  enabled: boolean;
};

export type ReferencePrompt = {
  id: string;
  title: string;
  body: string;
  note: string;
  enabled: boolean;
};

export type BankTag = {
  id: string;
  tag: string;
  note: string;
  enabled: boolean;
};

export type ExposureMark = "o" | "oo" | "star" | "note";

export type NudeMark = "nude" | "full";

export type ShotPrefs = {
  exposure: ExposureMark | null;
  nude: NudeMark | null;
  existing: boolean;
  anthro: boolean;
  women: number | null;
};

export type CatalogState = {
  orca: CatalogModel[];
  openrouter: CatalogModel[];
  nvidia: CatalogModel[];
  cloudflare: CatalogModel[];
  fetchedAt: number;
  warning: string;
};
