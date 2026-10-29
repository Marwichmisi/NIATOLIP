"use client";

import { useState, type CSSProperties } from "react";
import {
  ArrowUp, Check, ChevronDown, Circle, CircleAlert, Loader2, Pencil, Play, Square, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SUGGESTIONS, type AgentStep } from "@/data/mock";
import { cn } from "@/lib/utils";

export const MODELS = ["Meta · Spark 1.3", "Meta · Wonder 1.0", "OpenAI"];

/** Issue #2 : labels UI → choix modèle serveur (un run = un modèle, doc 02 §4). */
export const MODEL_VALUE_FOR_LABEL: Record<string, string> = {
  "Meta · Spark 1.3": "meta-spark",
  "Meta · Wonder 1.0": "meta-wonder",
  OpenAI: "openai-main",
};

export interface ChatMsg {
  role: "user" | "agent";
  text: string;
  /** Parties d'outils du run (mémoire inter-runs) — non affichées, renvoyées au run suivant. */
  parts?: Array<{
    toolName: string;
    toolCallId: string;
    input: unknown;
    output?: unknown;
    error?: string;
  }>;
}

function StepIcon({ status }: { status: AgentStep["status"] }) {
  if (status === "done") return <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-500"><Check className="h-3 w-3" /></span>;
  if (status === "running") return <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/15 text-primary"><Loader2 className="h-3 w-3 animate-spin" /></span>;
  if (status === "error") return <span className="flex h-5 w-5 items-center justify-center rounded-full bg-destructive/15 text-destructive"><X className="h-3 w-3" /></span>;
  return <span className="flex h-5 w-5 items-center justify-center rounded-full bg-muted text-muted-foreground"><Circle className="h-2.5 w-2.5" /></span>;
}

export function AgentPanel({
  steps, running, messages, planApproved, onApprovePlan, onSend, onStop, onContinue,
  model, onModelChange, runCost, style,
}: {
  steps: AgentStep[];
  running: boolean;
  messages: ChatMsg[];
  planApproved: boolean;
  onApprovePlan: () => void;
  onSend: (text: string) => void;
  onStop: () => void;
  onContinue: () => void;
  model: string;
  onModelChange: (model: string) => void;
  runCost: { cost: number; max: number } | null;
  style?: CSSProperties;
}) {
  const [input, setInput] = useState("");
  const [openStep, setOpenStep] = useState<string | null>(null);
  const doneCount = steps.filter((s) => s.status === "done").length;
  const finished = !running && doneCount === steps.length;

  const submit = () => {
    const text = input.trim();
    if (!text || running) return;
    setInput("");
    onSend(text);
  };

  return (
    <section
      className="flex min-h-0 w-full flex-col border-r border-border bg-card/40 lg:w-[var(--agent-w,400px)] lg:shrink-0"
      style={style}
      aria-label="Agent IA"
    >
      <div className="flex items-center justify-between px-4 pt-4 pb-2">
        <h2 className="font-display text-sm font-semibold tracking-tight">Agent</h2>
        <Badge variant={running ? "default" : finished ? "success" : "secondary"}>
          {running ? "En cours" : finished ? "Terminé" : "En pause"}
        </Badge>
      </div>

      <div className="mx-4 mb-3">
        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
          <span>Itération · {doneCount}/{steps.length} étapes</span>
          <span>50 max</span>
        </div>
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-primary transition-all duration-500" style={{ width: `${steps.length === 0 ? 0 : (doneCount / steps.length) * 100}%` }} />
        </div>
      </div>

      {!planApproved && (
        <div className="mx-4 mb-3 rounded-lg border border-primary/30 bg-primary/5 p-3">
          <p className="text-[13px] font-medium">Plan proposé — en attente d'approbation</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Carte capteur ESP32-C3 + BME280 (I2C), alimentation USB-C, LED d'état. 40 × 30 mm, 2 couches, composants JLCPCB.
          </p>
          <div className="mt-2.5 flex gap-2">
            <Button size="sm" onClick={onApprovePlan}><Check /> Approuver</Button>
            <Button size="sm" variant="outline" onClick={() => setInput("Modifie le plan : ")}><Pencil /> Modifier</Button>
          </div>
        </div>
      )}

      <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-2">
        {steps.map((step) => (
          <div key={step.id}>
            <button
              type="button"
              onClick={() => setOpenStep(openStep === step.id ? null : step.id)}
              className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left hover:bg-accent/60"
              aria-expanded={openStep === step.id}
            >
              <StepIcon status={step.status} />
              <span className={cn("flex-1 truncate text-[13px]", step.status === "pending" && "text-muted-foreground")}>{step.label}</span>
              <ChevronDown className={cn("h-3.5 w-3.5 text-muted-foreground transition-transform", openStep === step.id && "rotate-180")} />
            </button>
            {openStep === step.id && (
              <p className="px-9 pb-1.5 text-xs leading-relaxed text-muted-foreground">{step.detail}</p>
            )}
          </div>
        ))}

        <div className="space-y-3 px-2 pt-3">
          {messages.map((m, i) => (
            <div key={i} className={cn("flex", m.role === "user" && "justify-end")}>
              <div className={cn(
                "max-w-[92%] rounded-xl px-3 py-2 text-[13px] leading-relaxed",
                m.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted/70 text-foreground"
              )}>
                {m.text}
              </div>
            </div>
          ))}
          {finished && (
            <div className="rounded-lg border border-border bg-card p-3">
              <p className="flex items-center gap-1.5 text-[13px] font-medium"><CircleAlert className="h-4 w-4 text-primary" /> Itération terminée</p>
              <p className="mt-1 text-xs text-muted-foreground">Le projet est sauvegardé (v12). Vous pouvez continuer ou demander une modification.</p>
              <Button size="sm" className="mt-2.5" onClick={onContinue}><Play /> Continuer l'itération</Button>
            </div>
          )}
        </div>
      </div>

      <div className="shrink-0 border-t border-border p-3">
        <div className="mb-2 flex flex-wrap gap-1.5">
          {SUGGESTIONS.map((s) => (
            <button key={s} type="button" onClick={() => onSend(s)} disabled={running}
              className="rounded-full border border-border px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50">
              {s}
            </button>
          ))}
        </div>
        <div className="flex items-end gap-2 rounded-xl border border-input bg-background p-2 focus-within:ring-2 focus-within:ring-ring">
          <label className="sr-only" htmlFor="chat-input">Message à l'agent</label>
          <textarea
            id="chat-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
            rows={2}
            placeholder="Décrivez la modification…"
            className="max-h-28 flex-1 resize-none bg-transparent px-1.5 py-1 text-sm outline-none placeholder:text-muted-foreground"
          />
          {running ? (
            <Button size="icon" variant="destructive" onClick={onStop} title="Arrêter le run" aria-label="Arrêter le run" className="rounded-full">
              <Square className="fill-current" />
            </Button>
          ) : (
            <Button size="icon" onClick={submit} disabled={!input.trim()} title="Envoyer" aria-label="Envoyer" className="rounded-full">
              <ArrowUp />
            </Button>
          )}
        </div>
        <p className="mt-2 flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
          <span>
            L&apos;agent vérifie chaque étape — aucun export sans votre approbation.
            {runCost && (
              <> Coût dernier run : ${runCost.cost.toFixed(3)} / ${runCost.max.toFixed(0)}.</>
            )}
          </span>
          <span className="flex shrink-0 items-center gap-1.5">
            <label className="sr-only" htmlFor="model-select">Modèle</label>
            <select
              id="model-select"
              value={model}
              onChange={(e) => onModelChange(e.target.value)}
              title="Modèle pour le prochain run"
              className="h-7 rounded-md border border-input bg-background px-1.5 text-[11px] text-foreground outline-none focus:ring-2 focus:ring-ring"
            >
              {MODELS.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </span>
        </p>
      </div>
    </section>
  );
}
