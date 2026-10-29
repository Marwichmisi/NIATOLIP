"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { ErrorBoundary } from "react-error-boundary";
import { Cpu, Loader2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StaticPcbPreview } from "@/components/static-svg-preview";
import type { CircuitElement } from "@/lib/tscircuit-eval";

if (typeof window !== "undefined") {
  // Pas de télémétrie tscircuit vers l'extérieur.
  window.TSCIRCUIT_TELEMETRY_DISABLED = true;
}

const RunFrame = dynamic(
  () => import("@tscircuit/runframe/runner").then((m) => m.RunFrame),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full w-full items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Chargement du moteur tscircuit…
      </div>
    ),
  }
);

export type TscircuitView = "pcb" | "schematic" | "3d";

const TAB_FOR_VIEW = { pcb: "pcb", schematic: "schematic", "3d": "cad" } as const;

export interface RunCompletedInfo {
  errors?: Array<{ message?: string; type?: string } | string>;
  hasExecutionError: boolean;
}

interface TscircuitPreviewProps {
  view: TscircuitView;
  fsMap: Record<string, string>;
  entrypoint: string;
  /** Version d'eval épinglée (doc 01 §6 : jamais "latest" en production). */
  evalVersion?: string;
  /** Notre propre évaluation tourne encore (le fallback SVG arrive). */
  evaluating?: boolean;
  /** Circuit JSON de notre propre évaluation — fallback statique sans GPU. */
  circuitJson?: CircuitElement[];
  /** Circuit JSON émis par le WebWorker après chaque rendu — ne jamais l'afficher brut. */
  onCircuitJson?: (json: unknown) => void;
  onRunCompleted?: (info: RunCompletedInfo) => void;
  onError?: (error: Error) => void;
}

function PreviewFallback({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3 p-6 text-center">
      <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
        <TriangleAlert className="h-5 w-5" />
      </span>
      <div>
        <p className="font-display text-sm font-semibold">La preview n&apos;a pas démarré</p>
        <p className="mx-auto mt-1 max-w-sm font-mono text-xs leading-relaxed text-muted-foreground">
          {message}
        </p>
      </div>
      <Button variant="outline" size="sm" onClick={onRetry}>
        Réessayer
      </Button>
    </div>
  );
}

export function TscircuitPreview({
  view,
  fsMap,
  entrypoint,
  evalVersion,
  circuitJson,
  evaluating,
  onCircuitJson,
  onRunCompleted,
  onError,
}: TscircuitPreviewProps) {
  const tab = TAB_FOR_VIEW[view];
  const key = useMemo(() => JSON.stringify(fsMap), [fsMap]);
  const needsWebGpu = view === "pcb" || view === "3d";
  // "ready" = le run a abouti (succès ou échec) : tant qu'il est faux, un
  // voile de chargement masque l'état vide de RunFrame (les "tips").
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setReady(false);
  }, [view, fsMap]);
  const [webGpu, setWebGpu] = useState<"checking" | "ok" | "missing">(
    needsWebGpu ? "checking" : "ok"
  );

  useEffect(() => {
    if (!needsWebGpu) {
      setWebGpu("ok");
      return;
    }
    setWebGpu("checking");
    let cancelled = false;
    const done = (v: "ok" | "missing") => {
      if (!cancelled) setWebGpu(v);
    };
    (async () => {
      try {
        const gpu = (navigator as unknown as { gpu?: { requestAdapter: () => Promise<unknown> } }).gpu;
        if (!gpu) return done("missing");
        const adapter = await gpu.requestAdapter();
        done(adapter ? "ok" : "missing");
      } catch {
        done("missing");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [needsWebGpu, view]);

  if (needsWebGpu && webGpu !== "ok") {
    // PCB sans GPU : fallback statique dès que notre propre évaluation
    // (WebWorker, sans GPU) a produit le Circuit JSON. 3D : message seul.
    if (view === "pcb" && webGpu === "missing" && circuitJson && circuitJson.length > 0) {
      return (
        <div className="preview-canvas h-full w-full" key={`static-${key}`}>
          <StaticPcbPreview circuitJson={circuitJson} />
        </div>
      );
    }
    // Évaluation en cours (notre worker) : voile d'attente, pas le message
    // d'indisponibilité — le SVG statique arrive juste après.
    if (webGpu === "missing" && evaluating) {
      return (
        <div className="preview-canvas flex h-full w-full flex-col items-center justify-center gap-3 p-6 text-center">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
          <div>
            <p className="text-sm font-medium">Évaluation du circuit…</p>
            <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-muted-foreground">
              WebWorker tscircuit (premier chargement : moteur ~18 Mo, mis en
              cache ensuite).
            </p>
          </div>
        </div>
      );
    }
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-3 p-6 text-center">
        {webGpu === "checking" ? (
          <>
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Vérification WebGPU…</p>
          </>
        ) : (
          <>
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-muted text-muted-foreground">
              <Cpu className="h-5 w-5" />
            </span>
            <div>
              <p className="font-display text-sm font-semibold">
                Aperçu {view === "pcb" ? "PCB" : "3D"} indisponible
              </p>
              <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-muted-foreground">
                Ce navigateur ne fournit pas d&apos;adaptateur WebGPU (requis par
                le viewer tscircuit). Le schéma, la BOM et la validation restent
                disponibles — essayez Chrome ou Edge récent avec accélération
                matérielle.
              </p>
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="relative h-full w-full" key={`${view}-${key}`}>
      <ErrorBoundary
        fallbackRender={({ error, resetErrorBoundary }) => (
          <PreviewFallback
            message={error instanceof Error ? error.message : String(error)}
            onRetry={resetErrorBoundary}
          />
        )}
      >
        <RunFrame
          fsMap={fsMap}
          entrypoint={entrypoint}
          evalVersion={evalVersion}
          shouldLoadLatestEval={false}
          defaultTab={tab}
          availableTabs={[tab]}
          showRunButton={false}
          showFileMenu={false}
          showToggleFullScreen={false}
          onCircuitJsonChange={(circuitJson: unknown) => {
            setReady(true);
            onCircuitJson?.(circuitJson);
          }}
          onRunCompleted={(payload: RunCompletedInfo) => {
            setReady(true);
            onRunCompleted?.(payload);
          }}
          onError={(error: Error) => {
            setReady(true);
            onError?.(error);
          }}
        />
      </ErrorBoundary>
      {!ready && (
        <div className="preview-canvas absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
          <div>
            <p className="text-sm font-medium">Chargement de la preview…</p>
            <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-muted-foreground">
              Premier chargement : moteur tscircuit (~18 Mo, mis en cache
              ensuite), puis évaluation dans le WebWorker.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
