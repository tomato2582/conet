import { FALLBACK_CLOUDFLARE, FALLBACK_NVIDIA, FALLBACK_OPENROUTER, FALLBACK_ORCA } from "@/lib/studio/catalog";
import type { ProviderId } from "@/lib/studio/types";

const ORCA_FREE = new Set(FALLBACK_ORCA.map((model) => model.id));
const OPENROUTER_FREE = new Set(FALLBACK_OPENROUTER.map((model) => model.id));
const NVIDIA_FREE = new Set(FALLBACK_NVIDIA.map((model) => model.id));
const CLOUDFLARE_FREE = new Set(FALLBACK_CLOUDFLARE.map((model) => model.id));

export type FailCode = "key" | "quota" | "rate" | "model" | "upstream";

export function isFreeModel(provider: ProviderId, model: string): boolean {
  if (provider === "orca") return ORCA_FREE.has(model);
  if (provider === "openrouter") return OPENROUTER_FREE.has(model);
  if (provider === "nvidia") return NVIDIA_FREE.has(model);
  return CLOUDFLARE_FREE.has(model);
}

export function providerLabel(provider: ProviderId): string {
  if (provider === "orca") return "OrcaRouter";
  if (provider === "openrouter") return "OpenRouter";
  if (provider === "nvidia") return "NVIDIA";
  return "Cloudflare";
}

export function providerGroup(provider: ProviderId): string {
  if (provider === "orca") return "OrcaRouter · DeepSeek 無料";
  if (provider === "openrouter") return "OpenRouter · 無料";
  if (provider === "nvidia") return "NVIDIA · 無料エンドポイント";
  return "Cloudflare · 1日分の無料枠";
}

export function isProviderId(value: string): value is ProviderId {
  return value === "orca" || value === "openrouter" || value === "nvidia" || value === "cloudflare";
}

export function failCode(status: number): FailCode {
  if (status === 401 || status === 403) return "key";
  if (status === 402) return "quota";
  if (status === 429) return "rate";
  if (status === 400 || status === 404 || status === 422) return "model";
  return "upstream";
}

export function canRotateKey(code: FailCode): boolean {
  return code === "key" || code === "quota" || code === "rate";
}
