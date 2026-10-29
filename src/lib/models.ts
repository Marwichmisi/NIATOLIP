// SEUL fichier autorisé à connaître les providers (doc 02 §3.1).
// Importer ce module côté navigateur lève une exception : les clés API
// (MODEL_API_KEY, OPENAI_API_KEY) ne vivent que côté serveur (doc 02 §6).
if (typeof window !== "undefined") {
  throw new Error("src/lib/models.ts est serveur uniquement (clés API).");
}

import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { openai } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";

export const META_BASE_URL = "https://api.meta.ai/v1";

/** Choix de modèle d'un run — fixé AVANT le run, jamais changé en cours (doc 02 §4). */
export type ModelChoice = "meta-spark" | "meta-wonder" | "openai-main";

export const MODEL_CHOICES: readonly ModelChoice[] = [
  "meta-spark",
  "meta-wonder",
  "openai-main",
] as const;

/** Libellés UI (agent-panel) → choix. La sélection se fait avant le run. */
export const MODEL_LABELS: Record<ModelChoice, string> = {
  "meta-spark": "Meta · Spark 1.3",
  "meta-wonder": "Meta · Wonder 1.0",
  "openai-main": "OpenAI",
};

/**
 * Contrainte Meta (doc 02 §3.3) : `tool_choice` vaut toujours "auto".
 * "none", "required" ou le forçage d'une fonction renvoient HTTP 400.
 * Le system prompt rend les appels d'outils obligatoires par instruction,
 * jamais par contrainte API.
 */
export const META_TOOL_CHOICE = "auto" as const;

interface ModelSpec {
  choice: ModelChoice;
  /** ID envoyé au fournisseur — par variable d'environnement, jamais en dur côté OpenAI. */
  modelId: string;
  contextTokens: number;
  /** Tarifs par 1M tokens, mode Standard (doc 02 §1). */
  priceInPerM: number;
  priceCachedInPerM: number;
  priceOutPerM: number;
}

function env(name: string, fallback: string): string {
  const v = process.env[name];
  return v && v.trim().length > 0 ? v.trim() : fallback;
}

export function getModelCatalog(): Record<ModelChoice, ModelSpec> {
  return {
    "meta-spark": {
      choice: "meta-spark",
      modelId: env("META_SPARK_MODEL", "muse-spark-1.3"),
      contextTokens: 1_048_576,
      priceInPerM: 1.25,
      priceCachedInPerM: 0.15,
      priceOutPerM: 4.25,
    },
    "meta-wonder": {
      choice: "meta-wonder",
      modelId: env("META_WONDER_MODEL", "muse-wonder-1.0"),
      contextTokens: 1_048_576,
      priceInPerM: 4.0,
      priceCachedInPerM: 0.2,
      priceOutPerM: 20.0,
    },
    "openai-main": {
      choice: "openai-main",
      // Figé après benchmark M0 — en attendant, surchargeable par env.
      modelId: env("OPENAI_MAIN_MODEL", "gpt-5-mini"),
      contextTokens: 0, // renseigné au benchmark (dépend du modèle retenu)
      priceInPerM: 0,
      priceCachedInPerM: 0,
      priceOutPerM: 0,
    },
  };
}

/**
 * Liste blanche d'IDs autorisés (doc 08 backlog P0, décision D9).
 * Les variantes Meta `-contributor` sont INTERDITES par défaut : Meta peut
 * utiliser les contenus envoyés pour entraîner ses modèles. Usage éventuel
 * réservé aux tests internes sur données synthétiques, avec opt-in explicite
 * (NIATOLIP_ALLOW_CONTRIBUTOR=1) — jamais pour des projets utilisateur.
 */
export function isAllowedModelId(modelId: string): boolean {
  if (/-contributor\b/.test(modelId)) {
    return process.env.NIATOLIP_ALLOW_CONTRIBUTOR === "1";
  }
  return true;
}

export function assertAllowedModelId(modelId: string): void {
  if (!isAllowedModelId(modelId)) {
    throw new Error(
      `Modèle "${modelId}" interdit : les variantes -contributor sont exclues par défaut (décision D9).`
    );
  }
}

const metaProvider = () =>
  createOpenAICompatible({
    name: "meta",
    baseURL: META_BASE_URL,
    apiKey: process.env.MODEL_API_KEY,
    includeUsage: true,
  });

/** Retourne le LanguageModel AI SDK pour un choix validé. Lève si clé manquante. */
export function getModel(choice: ModelChoice): LanguageModel {
  if (!MODEL_CHOICES.includes(choice)) {
    throw new Error(`Choix de modèle inconnu : ${choice}`);
  }
  const spec = getModelCatalog()[choice];
  assertAllowedModelId(spec.modelId);
  if (choice === "openai-main") {
    if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY manquante (serveur).");
    return openai(spec.modelId);
  }
  if (!process.env.MODEL_API_KEY) throw new Error("MODEL_API_KEY manquante (serveur).");
  return metaProvider()(spec.modelId);
}

/** Choix par défaut — modifiable par configuration, jamais en cours de run. */
export function getDefaultChoice(): ModelChoice {
  const raw = (process.env.DEFAULT_MODEL ?? "meta-spark").trim();
  return (MODEL_CHOICES as readonly string[]).includes(raw)
    ? (raw as ModelChoice)
    : "meta-spark";
}

/** Coût estimé d'un run (USD) à partir de l'usage reporté par l'AI SDK. */
export function estimateCost(
  choice: ModelChoice,
  usage: { inputTokens?: number; outputTokens?: number; cachedInputTokens?: number }
): number {
  const spec = getModelCatalog()[choice];
  if (spec.priceInPerM <= 0) return NaN; // tarif OpenAI non renseigné (avant benchmark)
  const cached = usage.cachedInputTokens ?? 0;
  const fresh = Math.max(0, (usage.inputTokens ?? 0) - cached);
  return (
    (fresh * spec.priceInPerM + cached * spec.priceCachedInPerM) / 1_000_000 +
    ((usage.outputTokens ?? 0) * spec.priceOutPerM) / 1_000_000
  );
}

/** Disponibilité des clés (pour dégrader proprement sans clés, ex. CI sans secrets). */
export function getProviderStatus(): Record<ModelChoice, { configured: boolean; modelId: string }> {
  const catalog = getModelCatalog();
  return {
    "meta-spark": {
      configured: !!process.env.MODEL_API_KEY,
      modelId: catalog["meta-spark"].modelId,
    },
    "meta-wonder": {
      configured: !!process.env.MODEL_API_KEY,
      modelId: catalog["meta-wonder"].modelId,
    },
    "openai-main": {
      configured: !!process.env.OPENAI_API_KEY && !!process.env.OPENAI_MAIN_MODEL,
      modelId: catalog["openai-main"].modelId,
    },
  };
}

const TRANSIENT_429_DELAYS_MS = [1000, 2000, 4000];

/**
 * Backoff exponentiel + jitter sur HTTP 429 (doc 02 §1 : seule action requise
 * face aux rate limits Meta — 3 000 RPM / 4M TPM par compte/équipe).
 * Respecte l'en-tête Retry-After quand le fournisseur le renvoie.
 */
export async function withMeta429Retry<T>(fn: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= TRANSIENT_429_DELAYS_MS.length; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const status =
        typeof err === "object" && err !== null && "statusCode" in err
          ? (err as { statusCode?: number }).statusCode
          : undefined;
      if (status !== 429 || attempt === TRANSIENT_429_DELAYS_MS.length) throw err;
      const retryAfter =
        typeof err === "object" && err !== null && "responseHeaders" in err
          ? Number(
              (err as { responseHeaders?: Record<string, string> }).responseHeaders?.[
                "retry-after"
              ]
            )
          : NaN;
      const base = Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : TRANSIENT_429_DELAYS_MS[attempt];
      await new Promise((r) => setTimeout(r, base + Math.random() * 500));
    }
  }
  throw lastError;
}
