"use client";

import { useMemo } from "react";
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg";
import type { CircuitElement } from "@/lib/tscircuit-eval";

/** Aperçu PCB statique (SVG) — utilisé quand WebGPU est indisponible.
 *  Rendu synchrone, aucun viewer : fonctionne partout, sans pan/zoom
 *  (le zoom arrivera avec la vraie preview interactive). */
export function StaticPcbPreview({ circuitJson }: { circuitJson: CircuitElement[] }) {
  const svg = useMemo(() => {
    try {
      return convertCircuitJsonToPcbSvg(circuitJson as never);
    } catch {
      return null;
    }
  }, [circuitJson]);

  if (!svg) {
    return (
      <div className="flex h-full w-full items-center justify-center p-6 text-center">
        <p className="text-sm text-muted-foreground">Évaluation en cours…</p>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full">
      <div
        className="h-full w-full [&>svg]:h-full [&>svg]:w-full"
        role="img"
        aria-label="Aperçu PCB statique (sans WebGPU)"
        dangerouslySetInnerHTML={{ __html: svg }}
      />
      <p className="pointer-events-none absolute top-3 left-1/2 -translate-x-1/2 rounded-full border border-border bg-background/85 px-3 py-1 text-[11px] whitespace-nowrap text-muted-foreground backdrop-blur">
        Aperçu statique — WebGPU indisponible sur ce navigateur
      </p>
    </div>
  );
}
