import { createFileRoute } from "@tanstack/react-router";
import { isFreeModel } from "@/lib/studio/allow";
import {
  FALLBACK_CLOUDFLARE,
  FALLBACK_NVIDIA,
  FALLBACK_OPENROUTER,
  FALLBACK_ORCA,
  onlyCurated,
  prettyOrcaName,
} from "@/lib/studio/catalog";
import type { CatalogModel } from "@/lib/studio/types";

type Cache = {
  at: number;
  orca: CatalogModel[];
  openrouter: CatalogModel[];
  warning: string;
};

let cache: Cache | null = null;
const TTL = 10 * 60 * 1000;

async function loadOrca(): Promise<CatalogModel[]> {
  const response = await fetch("https://api.orcarouter.ai/api/free-package/public", {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) throw new Error(`OrcaRouter ${response.status}`);
  const json = (await response.json()) as {
    data?: { models?: Array<{ free_alias?: string }> };
  };
  const models = (json.data?.models ?? [])
    .map((item) => item.free_alias ?? "")
    .filter((id) => isFreeModel("orca", id))
    .map((id) => ({ id, name: prettyOrcaName(id), provider: "orca" as const }));
  if (!models.length) return FALLBACK_ORCA;
  return onlyCurated(models, FALLBACK_ORCA);
}

async function loadOpenRouter(): Promise<CatalogModel[]> {
  const response = await fetch("https://openrouter.ai/api/v1/models", {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`OpenRouter ${response.status}`);
  const json = (await response.json()) as {
    data?: Array<{
      id?: string;
      name?: string;
      architecture?: { output_modalities?: string[] };
    }>;
  };
  const models = (json.data ?? [])
    .filter((item) => {
      const id = item.id ?? "";
      if (!isFreeModel("openrouter", id)) return false;
      const outputs = item.architecture?.output_modalities;
      if (outputs && outputs.length && !outputs.includes("text")) return false;
      return true;
    })
    .map((item) => {
      const id = item.id ?? "";
      const cleaned = (item.name ?? id)
        .replace(/\s*\(free\)\s*/gi, "")
        .replace(/^[^:]{1,40}:\s*/, "")
        .trim();
      return {
        id,
        name: cleaned || id,
        provider: "openrouter" as const,
      };
    });
  if (!models.length) return FALLBACK_OPENROUTER;
  return onlyCurated(models, FALLBACK_OPENROUTER);
}

export const Route = createFileRoute("/api/models")({
  server: {
    handlers: {
      GET: async () => {
        if (cache && Date.now() - cache.at < TTL) {
          return Response.json({
            ...cache,
            nvidia: FALLBACK_NVIDIA,
            cloudflare: FALLBACK_CLOUDFLARE,
          });
        }
        const warnings: string[] = [];
        let orca: CatalogModel[] = [];
        let openrouter: CatalogModel[] = [];
        try {
          orca = await loadOrca();
        } catch (error) {
          warnings.push(error instanceof Error ? error.message : "OrcaRouter の一覧に失敗");
        }
        try {
          openrouter = await loadOpenRouter();
        } catch (error) {
          warnings.push(error instanceof Error ? error.message : "OpenRouter の一覧に失敗");
        }
        if (!orca.length && !openrouter.length) {
          return Response.json(
            { error: warnings.join(" / ") || "一覧を取得できませんでした" },
            { status: 502 },
          );
        }
        cache = {
          at: Date.now(),
          orca,
          openrouter,
          warning: warnings.join(" / "),
        };
        return Response.json({
          ...cache,
          nvidia: FALLBACK_NVIDIA,
          cloudflare: FALLBACK_CLOUDFLARE,
        });
      },
    },
  },
});
