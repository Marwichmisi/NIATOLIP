"use client";

import dynamic from "next/dynamic";
import { useMemo } from "react";
import { ErrorBoundary } from "react-error-boundary";
import { Loader2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

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
  onCircuitJson,
  onRunCompleted,
  onError,
}: TscircuitPreviewProps) {
  const tab = TAB_FOR_VIEW[view];
  const key = useMemo(() => JSON.stringify(fsMap), [fsMap]);

  return (
    <div className="h-full w-full" key={`${view}-${key}`}>
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
          defaultTab={tab}
          availableTabs={[tab]}
          showRunButton={false}
          showFileMenu={false}
          showToggleFullScreen={false}
          onCircuitJsonChange={(circuitJson: unknown) => onCircuitJson?.(circuitJson)}
          onRunCompleted={(payload: RunCompletedInfo) => onRunCompleted?.(payload)}
          onError={(error: Error) => onError?.(error)}
        />
      </ErrorBoundary>
    </div>
  );
}
