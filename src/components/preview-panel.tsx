"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Box, Bug, Check, CircuitBoard, Download, History, List, Loader2, Circle, Network, ShieldCheck,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TscircuitPreview, type RunCompletedInfo, type TscircuitView } from "@/components/tscircuit-preview";
import {
  TOY_ENTRYPOINT, TOY_FSMAP_BROKEN, TOY_FSMAP_GOOD, TSCIRCUIT_VERSIONS,
} from "@/lib/toy-circuit";
import { runEvaluation, summarizeCircuitJson, type CircuitElement, type CircuitSummary } from "@/lib/tscircuit-eval";
import { BOM } from "@/data/mock";
import { cn } from "@/lib/utils";

const TABS = [
  { id: "pcb", label: "PCB", icon: CircuitBoard },
  { id: "schematic", label: "Schéma", icon: Network },
  { id: "3d", label: "3D", icon: Box },
  { id: "bom", label: "BOM", icon: List },
  { id: "validation", label: "Validation", icon: ShieldCheck },
] as const;

type TabId = (typeof TABS)[number]["id"];

const VIEW_FOR_TAB: Record<string, TscircuitView | null> = {
  pcb: "pcb",
  schematic: "schematic",
  "3d": "3d",
  bom: null,
  validation: null,
};

type CircuitSel = "good" | "broken";

const FSMAP_FOR_SEL: Record<CircuitSel, Record<string, string>> = {
  good: TOY_FSMAP_GOOD,
  broken: TOY_FSMAP_BROKEN,
};

export function PreviewPanel({
  fsMap,
  versionLabel,
  onBoardState,
}: {
  /** Copie de travail du projet (null pendant le chargement). */
  fsMap: Record<string, string> | null;
  /** Label affiché dans le pied de page, ex. "v3". */
  versionLabel: string;
  /** Remonte l'état évalué au run agent (outil snapshotBoard). */
  onBoardState?: (s: { components: number; traces: number; errors: string[]; evaluatedAt: string }) => void;
}) {
  // Deep-link : #pcb, #schematic, #3d, #bom, #validation (pratique pour
  // partager une vue et pour les captures de contrôle). Appliqué après
  // hydratation uniquement : le SSR pré-rend toujours "pcb", et une valeur
  // initiale différente côté client casserait l'hydratation (React #418).
  const [tab, setTab] = useState<TabId>("pcb");
  useEffect(() => {
    const fromHash = () => {
      const h = window.location.hash.replace(/^#/, "");
      if (TABS.some((t) => t.id === h)) setTab(h as TabId);
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, []);
  const [sel, setSel] = useState<CircuitSel>("good");
  // Démo M0-2 : forcer la variante fautive par-dessus les fichiers projet.
  // "good" = fichiers du projet (ou jouet en repli), "broken" = casse volontaire.
  const projectFsMap = fsMap && Object.keys(fsMap).length > 0 ? fsMap : TOY_FSMAP_GOOD;
  const activeFsMap = sel === "broken" ? TOY_FSMAP_BROKEN : projectFsMap;
  const entrypoint = TOY_ENTRYPOINT in activeFsMap ? TOY_ENTRYPOINT : Object.keys(activeFsMap).sort()[0];
  const [summary, setSummary] = useState<CircuitSummary | null>(null);
  const [circuitJson, setCircuitJson] = useState<CircuitElement[]>([]);
  const [runErrors, setRunErrors] = useState<string[]>([]);
  const [fatal, setFatal] = useState<string | null>(null);
  const [evaluating, setEvaluating] = useState(true);

  // Évaluation indépendante du viewer (WebWorker, pas de WebGPU requis) :
  // alimente la validation et le fallback statique même sans GPU.
  useEffect(() => {
    let cancelled = false;
    setEvaluating(true);
    runEvaluation(activeFsMap, entrypoint)
      .then(({ summary, circuitJson }) => {
        if (cancelled) return;
        setSummary(summary);
        setCircuitJson(circuitJson);
        setEvaluating(false);
      })
      .catch((e) => {
        if (cancelled) return;
        setFatal(e instanceof Error ? e.message : String(e));
        // Dernier rendu valide conservé (doc 06 §3.2) : on ne vide pas circuitJson.
        setEvaluating(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel, fsMap]);

  // Remontée au run agent : l'outil serveur `snapshotBoard` reprend ce dernier
  // état évalué par le navigateur (preview live).
  const errorMessages = [
    ...(fatal ? [fatal] : []),
    ...runErrors,
    ...(summary?.errors.map((e) => e.message) ?? []),
  ];
  useEffect(() => {
    if (evaluating || !summary) return;
    onBoardState?.({
      components: summary.components,
      traces: summary.traces,
      errors: errorMessages.slice(0, 20),
      evaluatedAt: new Date().toISOString(),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [evaluating, summary]);

  const handleCircuitJson = useCallback((json: unknown) => {
    setSummary(summarizeCircuitJson(json));
    setEvaluating(false);
  }, []);

  const handleRunCompleted = useCallback((info: RunCompletedInfo) => {
    const messages = (info.errors ?? []).map((e) =>
      typeof e === "string" ? e : e.message ?? e.type ?? "Erreur d'exécution"
    );
    setRunErrors(messages);
    setEvaluating(false);
  }, []);

  const handleError = useCallback((error: Error) => {
    setFatal(error.message);
    setEvaluating(false);
  }, []);

  const switchSel = (next: CircuitSel) => {
    setSel(next);
    setSummary(null);
    setRunErrors([]);
    setFatal(null);
    setEvaluating(true);
  };

  const structuredErrors = [
    ...(fatal ? [{ code: "exception", message: fatal }] : []),
    ...runErrors.map((message) => ({ code: "worker", message })),
    ...(summary?.errors ?? []),
  ].filter(
    (e, i, arr) => arr.findIndex((x) => x.code === e.code && x.message === e.message) === i
  );
  const evalOk = structuredErrors.length === 0 && summary !== null;
  const view = VIEW_FOR_TAB[tab];

  return (
    <section className="flex min-h-0 flex-1 flex-col bg-background" aria-label="Aperçu de la carte">
      <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-border px-3 pt-2" role="tablist" aria-label="Vues de la carte">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            onClick={() => {
              setTab(id);
              window.location.hash = id;
            }}
            className={cn(
              "flex items-center gap-1.5 border-b-2 px-3 pb-2 pt-1 text-[13px] font-medium transition-colors",
              tab === id ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            <Icon className="h-4 w-4" /> {label}
          </button>
        ))}
        <div className="ml-auto hidden items-center gap-1 pb-1 md:flex">
          <Button
            variant={sel === "broken" ? "default" : "ghost"}
            size="icon-sm"
            title="Provoquer une erreur (M0-2 : vérifie l'affichage structuré des erreurs)"
            aria-label="Provoquer une erreur d'évaluation"
            onClick={() => switchSel(sel === "broken" ? "good" : "broken")}
          >
            <Bug />
          </Button>
          <Button variant="ghost" size="icon-sm" title="Historique des versions" aria-label="Historique des versions"><History /></Button>
          <Button variant="ghost" size="icon-sm" title="Télécharger le projet KiCad" aria-label="Télécharger le projet KiCad"><Download /></Button>
        </div>
      </div>

      <div className={cn("relative min-h-0 flex-1", view ? "overflow-hidden" : "overflow-auto p-4")}>
        {view && (runErrors.length > 0 || fatal) && (
          <p className="shrink-0 border-b border-amber-500/40 bg-amber-500/10 px-4 py-1.5 text-[11px] text-amber-600 dark:text-amber-400">
            Modifications en erreur — dernier rendu valide affiché, voir l'étape en cours.
          </p>
        )}
        {view && (
          <div className="relative flex h-full w-full flex-col">
            <div className="preview-canvas min-h-0 w-full flex-1">
              <TscircuitPreview
                view={view}
                fsMap={activeFsMap}
                entrypoint={entrypoint}
                evalVersion={TSCIRCUIT_VERSIONS.eval}
                circuitJson={circuitJson}
                evaluating={evaluating}
                onCircuitJson={handleCircuitJson}
                onRunCompleted={handleRunCompleted}
                onError={handleError}
              />
            </div>
            <p className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full border border-border bg-background/85 px-3 py-1 text-center text-[11px] whitespace-nowrap text-muted-foreground backdrop-blur">
              {sel === "broken"
                ? "Circuit volontairement fautif — les erreurs doivent s'afficher dans Validation"
                : fsMap === null
                  ? "Chargement du projet…"
                  : evaluating
                    ? "Évaluation tscircuit en cours dans le WebWorker…"
                    : `${entrypoint} · ${summary?.components ?? 0} composants · ${summary?.traces ?? 0} traces`}
            </p>
          </div>
        )}

        {tab === "bom" && (
          <div className="mx-auto max-w-3xl overflow-hidden rounded-xl border border-border">
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="border-b border-border bg-muted/50 text-xs text-muted-foreground">
                  <th className="px-3 py-2.5 font-medium">Réf.</th>
                  <th className="px-3 py-2.5 font-medium">Composant</th>
                  <th className="hidden px-3 py-2.5 font-medium sm:table-cell">Boîtier</th>
                  <th className="px-3 py-2.5 font-medium">LCSC</th>
                  <th className="hidden px-3 py-2.5 font-medium md:table-cell">Stock</th>
                  <th className="px-3 py-2.5 text-right font-medium">Prix</th>
                </tr>
              </thead>
              <tbody>
                {BOM.map((row) => (
                  <tr key={row.lcsc + row.ref} className="border-b border-border/60 last:border-0 hover:bg-accent/40">
                    <td className="px-3 py-2 font-mono text-xs">{row.ref}</td>
                    <td className="px-3 py-2">
                      {row.value}{" "}
                      <Badge variant={row.kind === "Extended" ? "warning" : "secondary"} className="ml-1">{row.kind}</Badge>
                    </td>
                    <td className="hidden px-3 py-2 text-muted-foreground sm:table-cell">{row.pkg}</td>
                    <td className="px-3 py-2 font-mono text-xs">{row.lcsc}</td>
                    <td className="hidden px-3 py-2 text-muted-foreground md:table-cell">{row.stock}</td>
                    <td className="px-3 py-2 text-right">{row.price}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="border-t border-border bg-muted/30 px-3 py-2 text-right text-xs text-muted-foreground">
              BOM indicative du prototype — dérivée automatiquement à partir de M1 ·{" "}
              {summary ? `${summary.components} composants évalués` : "évaluation en cours…"}
            </p>
          </div>
        )}

        {tab === "validation" && (
          <div className="mx-auto max-w-2xl space-y-2">
            <GateRow
              id="G0"
              label="Évaluation"
              status={evaluating ? "running" : evalOk ? "ok" : "error"}
              note={
                evaluating
                  ? "Évaluation dans le WebWorker…"
                  : evalOk
                    ? `${summary?.elements} éléments · 0 erreur`
                    : `${structuredErrors.length} erreur(s) — voir détail ci-dessous`
              }
            />
            <GateRow
              id="G1"
              label="Netlist"
              status={!summary ? "pending" : summary.traces > 0 && evalOk ? "ok" : summary.traces > 0 ? "running" : "pending"}
              note={!summary ? "En attente de l'évaluation" : `${summary.traces} traces · ${summary.components} composants`}
            />
            <GateRow
              id="G2"
              label="Placement"
              status="pending"
              note="Check automatique au jalon M1 (issue #4)"
            />
            <GateRow
              id="G3"
              label="Routage"
              status="pending"
              note="Carte jouet non routée — hors périmètre M0"
            />
            <GateRow
              id="G4"
              label="DRC KiCad"
              status="pending"
              note="Worker Docker au jalon M2 (issue #7)"
            />
            <GateRow
              id="G5"
              label="Fabricabilité"
              status="pending"
              note="Stock revérifié à l'export (issue #7)"
            />

            {structuredErrors.length > 0 && (
              <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3.5">
                <p className="text-[13px] font-medium text-destructive">Erreurs structurées ({structuredErrors.length})</p>
                <ul className="mt-2 space-y-1.5">
                  {structuredErrors.map((e, i) => (
                    <li key={`${e.code}-${i}`} className="font-mono text-xs leading-relaxed text-muted-foreground">
                      <span className="mr-2 rounded bg-destructive/10 px-1.5 py-0.5 text-destructive">{e.code}</span>
                      {e.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <p className="px-1 pt-1 text-xs leading-relaxed text-muted-foreground">
              Un DRC propre prouve que les règles géométriques sont respectées, pas que la carte fonctionnera. La validation finale reste humaine.
            </p>
          </div>
        )}
      </div>

      <footer className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
        <span className="font-mono">{entrypoint}</span>
        <span className="font-mono">{versionLabel}</span>
        <span className="flex items-center gap-1">
          {evaluating ? <Loader2 className="h-3 w-3 animate-spin text-primary" /> : evalOk ? <Check className="h-3 w-3 text-emerald-500" /> : <span className="h-2 w-2 rounded-full bg-destructive" />}
          Évaluation {evaluating ? "…" : evalOk ? "OK" : "en erreur"}
        </span>
        <span className="font-mono">
          tscircuit {TSCIRCUIT_VERSIONS.tscircuit} · eval {TSCIRCUIT_VERSIONS.eval} · runframe {TSCIRCUIT_VERSIONS.runframe}
        </span>
        <span className="ml-auto">Preview réelle — fichiers du projet courant</span>
      </footer>
    </section>
  );
}

function GateRow({
  id, label, status, note,
}: {
  id: string;
  label: string;
  status: "ok" | "running" | "pending" | "error";
  note: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-card px-3.5 py-3">
      <span className={cn(
        "flex h-6 w-6 items-center justify-center rounded-full",
        status === "ok" && "bg-emerald-500/15 text-emerald-500",
        status === "running" && "bg-primary/15 text-primary",
        status === "pending" && "bg-muted text-muted-foreground",
        status === "error" && "bg-destructive/15 text-destructive"
      )}>
        {status === "ok" ? <Check className="h-3.5 w-3.5" /> : status === "running" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : status === "error" ? <Bug className="h-3.5 w-3.5" /> : <Circle className="h-3 w-3" />}
      </span>
      <div className="flex-1">
        <p className="text-[13px] font-medium"><span className="font-mono text-xs text-muted-foreground">{id}</span> · {label}</p>
        <p className="text-xs text-muted-foreground">{note}</p>
      </div>
      <Badge variant={status === "ok" ? "success" : status === "error" ? "destructive" : status === "running" ? "default" : "outline"}>
        {status === "ok" ? "Validé" : status === "error" ? "Erreur" : status === "running" ? "En cours" : "En attente"}
      </Badge>
    </div>
  );
}
