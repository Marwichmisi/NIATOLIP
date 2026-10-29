"use client";

import { useState } from "react";
import {
  Box, Check, CircuitBoard, Download, History, List, Loader2, Circle, Network, ShieldCheck,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PcbBoard, SchematicPreview } from "@/components/pcb-board";
import { BOM, GATES } from "@/data/mock";
import { cn } from "@/lib/utils";

const TABS = [
  { id: "pcb", label: "PCB", icon: CircuitBoard },
  { id: "schematic", label: "Schéma", icon: Network },
  { id: "3d", label: "3D", icon: Box },
  { id: "bom", label: "BOM", icon: List },
  { id: "validation", label: "Validation", icon: ShieldCheck },
] as const;

type TabId = (typeof TABS)[number]["id"];

export function PreviewPanel({ routed }: { routed: boolean }) {
  const [tab, setTab] = useState<TabId>("pcb");

  return (
    <section className="flex min-h-0 flex-1 flex-col bg-background" aria-label="Aperçu de la carte">
      <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-border px-3 pt-2" role="tablist" aria-label="Vues de la carte">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={cn(
              "flex items-center gap-1.5 border-b-2 px-3 pb-2 pt-1 text-[13px] font-medium transition-colors",
              tab === id ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            <Icon className="h-4 w-4" /> {label}
          </button>
        ))}
        <div className="ml-auto hidden items-center gap-1 pb-1 md:flex">
          <Button variant="ghost" size="icon-sm" title="Historique des versions" aria-label="Historique des versions"><History /></Button>
          <Button variant="ghost" size="icon-sm" title="Télécharger le projet KiCad" aria-label="Télécharger le projet KiCad"><Download /></Button>
        </div>
      </div>

      <div className={cn("relative min-h-0 flex-1", tab === "pcb" || tab === "schematic" ? "overflow-hidden" : "overflow-auto p-4")}>
        {tab === "pcb" && (
          <div className="relative flex h-full w-full flex-col">
            <div className="preview-canvas min-h-0 w-full flex-1">
              <PcbBoard routed={routed} />
            </div>
            <p className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full border border-border bg-background/85 px-3 py-1 text-center text-[11px] whitespace-nowrap text-muted-foreground backdrop-blur">
              {routed ? "Routage terminé — 0 net non connecté" : "Aperçu en cours de routage — les pistes en pointillés restent à router"}
            </p>
          </div>
        )}

        {tab === "schematic" && (
          <div className="preview-canvas h-full w-full">
            <SchematicPreview />
          </div>
        )}

        {tab === "3d" && (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary"><Box className="h-7 w-7" /></span>
            <div>
              <p className="font-display text-sm font-semibold">Vue 3D</p>
              <p className="mt-1 max-w-xs text-xs leading-relaxed text-muted-foreground">
                Rendu 3D généré par le viewer tscircuit dans le produit réel. Emplacement réservé dans ce prototype.
              </p>
            </div>
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
              Total composants estimé : <span className="font-semibold text-foreground">≈ 5,10 €</span> · stock vérifié à l'instant
            </p>
          </div>
        )}

        {tab === "validation" && (
          <div className="mx-auto max-w-2xl space-y-2">
            {GATES.map((gate) => (
              <div key={gate.id} className="flex items-center gap-3 rounded-lg border border-border bg-card px-3.5 py-3">
                <span className={cn(
                  "flex h-6 w-6 items-center justify-center rounded-full",
                  gate.status === "ok" && "bg-emerald-500/15 text-emerald-500",
                  gate.status === "running" && "bg-primary/15 text-primary",
                  gate.status === "pending" && "bg-muted text-muted-foreground"
                )}>
                  {gate.status === "ok" ? <Check className="h-3.5 w-3.5" /> : gate.status === "running" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Circle className="h-3 w-3" />}
                </span>
                <div className="flex-1">
                  <p className="text-[13px] font-medium"><span className="font-mono text-xs text-muted-foreground">{gate.id}</span> · {gate.label}</p>
                  <p className="text-xs text-muted-foreground">{gate.status === "running" && !routed ? gate.note : gate.status === "ok" ? gate.note : routed && gate.id === "G3" ? "0 net non routé" : gate.note}</p>
                </div>
                <Badge variant={gate.status === "ok" ? "success" : gate.status === "running" ? "default" : "outline"}>
                  {gate.status === "ok" ? "Validé" : gate.status === "running" ? "En cours" : "En attente"}
                </Badge>
              </div>
            ))}
            <p className="px-1 pt-1 text-xs leading-relaxed text-muted-foreground">
              Un DRC propre prouve que les règles géométriques sont respectées, pas que la carte fonctionnera. La validation finale reste humaine.
            </p>
          </div>
        )}
      </div>

      <footer className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
        <span className="font-mono">v12</span>
        <span className="flex items-center gap-1"><Check className="h-3 w-3 text-emerald-500" /> Évaluation OK</span>
        <span className="flex items-center gap-1"><Check className="h-3 w-3 text-emerald-500" /> Netlist OK</span>
        <span className="flex items-center gap-1"><Check className="h-3 w-3 text-emerald-500" /> Placement OK</span>
        <span className={cn("flex items-center gap-1", routed ? "text-foreground" : "")}>
          {routed ? <Check className="h-3 w-3 text-emerald-500" /> : <Loader2 className="h-3 w-3 animate-spin text-primary" />} Routage {routed ? "OK" : "…"}
        </span>
        <span className="ml-auto">Prototype UI — données simulées</span>
      </footer>
    </section>
  );
}
