"use client";

import { useTheme } from "next-themes";
import { CircuitBoard, Download, Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const MODELS = ["Meta · Spark 1.3", "Meta · Wonder 1.0", "OpenAI"];

export function TopBar({
  model,
  onModelChange,
}: {
  model: string;
  onModelChange: (model: string) => void;
}) {
  const { theme, setTheme } = useTheme();
  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-card/60 px-4">
      <div className="flex items-center gap-2.5">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <CircuitBoard className="h-4.5 w-4.5" />
        </span>
        <div className="leading-tight">
          <p className="font-display text-[15px] font-bold tracking-tight">NIATOLIP</p>
          <p className="text-[10px] text-muted-foreground">nom de travail</p>
        </div>
      </div>

      <div className="mx-2 h-6 w-px bg-border" />

      <div className="min-w-0 leading-tight">
        <p className="truncate text-sm font-medium">Sensor Node — ESP32-C3</p>
        <p className="text-[11px] text-muted-foreground">v12 · sauvegardé à l'instant</p>
      </div>

      <Badge variant="success" className="ml-1 hidden sm:inline-flex">Checks OK</Badge>

      <div className="ml-auto flex items-center gap-2">
        <label className="sr-only" htmlFor="model-select">Modèle</label>
        <select
          id="model-select"
          value={model}
          onChange={(e) => onModelChange(e.target.value)}
          className="h-9 rounded-md border border-input bg-background px-2.5 text-[13px] text-foreground outline-none focus:ring-2 focus:ring-ring"
        >
          {MODELS.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>

        <Button
          variant="ghost"
          size="icon"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          title={theme === "dark" ? "Passer en thème clair" : "Passer en thème sombre"}
          aria-label="Basculer le thème"
        >
          {theme === "dark" ? <Sun /> : <Moon />}
        </Button>

        <Button size="sm" className="hidden sm:inline-flex">
          <Download /> Exporter
        </Button>
      </div>
    </header>
  );
}
