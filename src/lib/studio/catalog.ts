import type { CatalogModel } from "@/lib/studio/types";

export const FALLBACK_ORCA: CatalogModel[] = [
  {
    id: "deepseek/deepseek-v4.1-flash-free",
    name: "DeepSeek V4.1 Flash",
    provider: "orca",
  },
  {
    id: "deepseek/deepseek-v4-flash-free",
    name: "DeepSeek V4 Flash",
    provider: "orca",
  },
];

export const FALLBACK_OPENROUTER: CatalogModel[] = [
  { id: "inclusionai/ling-3.2-flash:free", name: "Ling 3.2 Flash", provider: "openrouter" },
  {
    id: "nvidia/nemotron-3-ultra-550b-a55b:free",
    name: "Nemotron 3 Ultra",
    provider: "openrouter",
  },
  { id: "google/gemma-4-31b-it:free", name: "Gemma 4 31B", provider: "openrouter" },
];

export const FALLBACK_NVIDIA: CatalogModel[] = [
  { id: "z-ai/glm-5.3-flash", name: "GLM 5.3 Flash", provider: "nvidia" },
  { id: "stepfun-ai/step-5-preview", name: "Step 5 Preview", provider: "nvidia" },
  { id: "google/gemma-4-31b-it", name: "Gemma 4 31B", provider: "nvidia" },
  { id: "minimaxai/minimax-m3.1-flash", name: "MiniMax M3.1 Flash", provider: "nvidia" },
  { id: "nvidia/nemotron-3-ultra-550b-a55b", name: "Nemotron 3 Ultra", provider: "nvidia" },
  { id: "mistralai/mistral-large-4-1t-a52b", name: "Mistral Large 4", provider: "nvidia" },
];

export const FALLBACK_CLOUDFLARE: CatalogModel[] = [
  { id: "@cf/openai/gpt-oss-120b", name: "gpt-oss 120B", provider: "cloudflare" },
  { id: "@cf/meta/llama-3.3-70b-instruct-fp8-fast", name: "Llama 3.3 70B", provider: "cloudflare" },
];

export function prettyOrcaName(id: string): string {
  const known = FALLBACK_ORCA.find((model) => model.id === id);
  if (known) return known.name;
  return id
    .replace(/^deepseek\//, "DeepSeek ")
    .replace(/-free$/, "")
    .replace(/-/g, " ");
}

export function onlyCurated(
  models: CatalogModel[] | undefined,
  allowed: CatalogModel[],
): CatalogModel[] {
  const rank = new Map(allowed.map((model, index) => [model.id, index]));
  const filtered = (models ?? []).filter((model) => rank.has(model.id));
  if (!filtered.length) return allowed;
  return [...filtered].sort((a, b) => (rank.get(a.id) ?? 99) - (rank.get(b.id) ?? 99));
}
