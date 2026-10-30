"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  ArrowUp, Check, ChevronDown, Circle, CircleAlert, Download, Loader2, Pencil, Play, Square, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { AgentStep } from "@/data/mock";
import type { ApprovalRequest } from "@/lib/chat-stream";
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
    approval?: { id: string; approved: boolean; reason?: string };
  }>;
}

export interface EndState {
  /** steps = plafond 50 atteint ; ended = run terminé avant (arrêt modèle) ; budget = plafond coût. */
  kind: "steps" | "budget" | "ended";
  steps: number;
  max: number;
  versionLabel: string;
}

function StepIcon({ status }: { status: AgentStep["status"] }) {
  if (status === "done")
    return <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-500"><Check className="h-3 w-3" /></span>;
  if (status === "running")
    return <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/15 text-primary"><Loader2 className="h-3 w-3 animate-spin" /></span>;
  if (status === "awaiting")
    return <span className="flex h-5 w-5 items-center justify-center rounded-full bg-amber-500/15 text-amber-500"><CircleAlert className="h-3 w-3" /></span>;
  if (status === "denied" || status === "error")
    return <span className="flex h-5 w-5 items-center justify-center rounded-full bg-destructive/15 text-destructive"><X className="h-3 w-3" /></span>;
  return <span className="flex h-5 w-5 items-center justify-center rounded-full bg-muted text-muted-foreground"><Circle className="h-2.5 w-2.5" /></span>;
}

function Elapsed({ startedAt }: { startedAt: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return <span className="shrink-0 font-mono text-[10px] text-muted-foreground">… {Math.max(0, Math.round((now - startedAt) / 1000))} s</span>;
}

export function AgentPanel({
  steps, running, messages, onSend, onStop, onContinue,
  model, onModelChange, runCost, runSteps, pendingApproval, onApprove, onApproveWithReason, onDeny,
  endState, exportUrl, style, focusKey,
}: {
  steps: AgentStep[];
  running: boolean;
  messages: ChatMsg[];
  onSend: (text: string) => void;
  onStop: () => void;
  onContinue: () => void;
  model: string;
  onModelChange: (model: string) => void;
  runCost: { cost: number; max: number } | null;
  runSteps: { steps: number; max: number } | null;
  pendingApproval: ApprovalRequest | null;
  onApprove: () => void;
  onApproveWithReason: (reason: string) => void;
  onDeny: () => void;
  endState: EndState | null;
  exportUrl: string | null;
  style?: CSSProperties;
  focusKey: number;
}) {
  const [input, setInput] = useState("");
  const [openStep, setOpenStep] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const doneCount = steps.filter((s) => s.status === "done").length;
  const costRatio = runCost && runCost.max > 0 ? runCost.cost / runCost.max : 0;
  const costAlert = costRatio >= 0.8;
  const shownSteps = runSteps?.steps ?? doneCount;
  const shownMax = runSteps?.max ?? 50;

  useEffect(() => {
    if (focusKey > 0) inputRef.current?.focus();
  }, [focusKey]);

  const submit = () => {
    const text = input.trim();
    if (!text || running) return;
    setInput("");
    onSend(text);
  };

  const denyAndEdit = () => {
    setInput((v) => (v.trim() ? v : "Modifie : "));
    onDeny();
  };

  return (
    <section
      className="flex min-h-0 w-full flex-col border-r border-border bg-card/40 lg:w-[var(--agent-w,400px)] lg:shrink-0"
      style={style}
      aria-label="Agent IA"
    >
      <div className="flex items-center justify-between px-4 pt-4 pb-2">
        <h2 className="font-display text-sm font-semibold tracking-tight">Agent</h2>
        <Badge variant={running ? "default" : endState ? "secondary" : doneCount > 0 ? "success" : "secondary"}>
          {running ? "En cours" : endState?.kind === "steps" || endState?.kind === "ended" ? "Itération terminée" : doneCount > 0 ? "Terminé" : "En pause"}
        </Badge>
      </div>

      <div className="mx-4 mb-3" aria-label="Progression du run">
        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
          <span>Itération · {shownSteps}/{shownMax} étapes</span>
          <span className={cn(costAlert && "font-medium text-amber-500")}>
            {runCost ? `$${runCost.cost.toFixed(3)} / $${runCost.max.toFixed(0)}` : "coût : —"}
          </span>
        </div>
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className={cn("h-full rounded-full transition-all duration-500", costAlert ? "bg-amber-500" : "bg-primary")}
            style={{ width: `${Math.min(100, (shownSteps / Math.max(1, shownMax)) * 100)}%` }}
          />
        </div>
        {costAlert && running && (
          <p className="mt-1 text-[11px] text-amber-500">Budget à {Math.round(costRatio * 100)} % — le run s'arrêtera proprement à 100 %.</p>
        )}
      </div>

      <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-2">
        {steps.map((step) => (
          <div key={step.id} className={cn(step.tool === "reportOutOfScope" && "rounded-md border border-amber-500/40 bg-amber-500/5")}>
            <button
              type="button"
              onClick={() => setOpenStep(openStep === step.id ? null : step.id)}
              className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left hover:bg-accent/60"
              aria-expanded={openStep === step.id}
            >
              <StepIcon status={step.status} />
              <span className={cn("flex-1 truncate text-[13px]", step.status === "pending" && "text-muted-foreground")}>{step.label}</span>
              {step.status === "running" && step.startedAt && <Elapsed startedAt={step.startedAt} />}
              {step.status === "awaiting" && <Badge variant="warning">Approbation</Badge>}
              {step.raw && <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform", openStep === step.id && "rotate-180")} />}
            </button>
            {(openStep === step.id || step.status === "error") && (
              <div className="px-9 pb-1.5">
                <p className="text-xs leading-relaxed text-muted-foreground">{step.detail}</p>
                {step.raw && openStep === step.id && (
                  <details className="mt-1">
                    <summary className="cursor-pointer font-mono text-[10px] text-muted-foreground hover:text-foreground">détail technique</summary>
                    <pre className="mt-1 max-h-48 overflow-auto rounded bg-muted/60 p-1.5 font-mono text-[10px] leading-relaxed whitespace-pre-wrap text-muted-foreground">{step.raw}</pre>
                  </details>
                )}
              </div>
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

          {pendingApproval?.toolName === "requestPlanApproval" && (
            <PlanCard key={pendingApproval.approvalId} input={pendingApproval.input} onApprove={onApprove} onApproveWithReason={onApproveWithReason} onDeny={denyAndEdit} />
          )}
          {pendingApproval?.toolName === "requestFinalApproval" && (
            <FinalCard key={pendingApproval.approvalId} input={pendingApproval.input} onApprove={onApprove} onApproveWithReason={onApproveWithReason} onDeny={denyAndEdit} />
          )}
          {pendingApproval?.toolName === "exportPack" && (
            <div className="rounded-lg border border-primary/30 bg-primary/5 p-3">
              <p className="text-[13px] font-medium">Gate export — approbation requise</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                Télécharger l'archive des sources (NON VALIDÉE — sans Gerber ni DRC KiCad).
                Le pack fabrication validé passe par l'outil pack G4/G5.
              </p>
              <div className="mt-2.5 flex gap-2">
                <Button size="sm" onClick={onApprove}><Download /> Approuver l'export</Button>
                <Button size="sm" variant="outline" onClick={denyAndEdit}><Pencil /> Refuser</Button>
              </div>
            </div>
          )}
          {pendingApproval?.toolName === "exportManufacturingPack" && (
            <div className="rounded-lg border border-primary/30 bg-primary/5 p-3">
              <p className="text-[13px] font-medium">Pack fabrication validé — approbation requise</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                Télécharger le pack G4/G5 vert (gerber.zip, bom.csv, pnp.csv, project-kicad.zip, sources.zip, validation-report.md).
              </p>
              <div className="mt-2.5 flex gap-2">
                <Button size="sm" onClick={onApprove}><Download /> Approuver le pack</Button>
                <Button size="sm" variant="outline" onClick={denyAndEdit}><Pencil /> Refuser</Button>
              </div>
            </div>
          )}

          {(endState?.kind === "steps" || endState?.kind === "ended") && !pendingApproval && (
            <div className="rounded-lg border border-border bg-card p-3">
              <p className="flex items-center gap-1.5 text-[13px] font-medium"><CircleAlert className="h-4 w-4 text-primary" /> Itération terminée ({endState.steps} étapes)</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {endState.kind === "steps"
                  ? `Plafond de ${endState.max} étapes atteint. Le projet est sauvegardé (${endState.versionLabel}).`
                  : `Le run s'est arrêté — tâche possiblement inachevée. Le projet est sauvegardé (${endState.versionLabel}).`}
                {" "}L'itération suivante repart du même projet et du même modèle — jamais relancée automatiquement.
              </p>
              <Button size="sm" className="mt-2.5" onClick={onContinue}><Play /> Continuer l'itération</Button>
            </div>
          )}
          {endState?.kind === "budget" && !pendingApproval && (
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
              <p className="flex items-center gap-1.5 text-[13px] font-medium"><CircleAlert className="h-4 w-4 text-amber-500" /> Budget atteint</p>
              <p className="mt-1 text-xs text-muted-foreground">Run arrêté proprement — fichiers et dernière version valide conservés. Augmentez AGENT_RUN_BUDGET_USD ou simplifiez la demande.</p>
            </div>
          )}
          {exportUrl && (
            <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/5 p-3">
              <p className="flex items-center gap-1.5 text-[13px] font-medium"><Check className="h-4 w-4 text-emerald-500" /> Archive prête</p>
              <a href={exportUrl} download className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500">
                <Download className="h-3.5 w-3.5" /> Télécharger le projet (.zip)
              </a>
            </div>
          )}
        </div>
      </div>

      <div className="shrink-0 border-t border-border p-3">
        <div className="flex items-end gap-2 rounded-xl border border-input bg-background p-2 focus-within:ring-2 focus-within:ring-ring">
          <label className="sr-only" htmlFor="chat-input">Message à l'agent</label>
          <textarea
            id="chat-input"
            ref={inputRef}
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
          <span>L'agent vérifie chaque étape — aucun export sans votre approbation.</span>
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

interface PlanComponent { ref?: unknown; value?: unknown; lcsc?: unknown; mpn?: unknown; role?: unknown }
interface PlanInput {
  title?: unknown; objective?: unknown; components?: unknown;
  board?: unknown; costEstimateUsd?: unknown; notes?: unknown;
}

const inputCls = "w-full rounded-md border border-input bg-background px-2 py-1 text-xs text-foreground outline-none focus:ring-2 focus:ring-ring";

function PlanCard({ input, onApprove, onApproveWithReason, onDeny }: {
  input: unknown; onApprove: () => void; onApproveWithReason: (reason: string) => void; onDeny: () => void;
}) {
  const p = (input ?? {}) as PlanInput;
  const initComps = (Array.isArray(p.components) ? p.components as PlanComponent[] : []).slice(0, 30).map((c) => ({
    ref: String(c.ref ?? ""), value: String(c.value ?? ""),
    lcsc: String(c.lcsc ?? ""), role: String(c.role ?? ""),
  }));
  const board = (p.board ?? {}) as { widthMm?: unknown; depthMm?: unknown; layers?: unknown };
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(String(p.title ?? ""));
  const [objective, setObjective] = useState(String(p.objective ?? ""));
  const [width, setWidth] = useState(String(board.widthMm ?? ""));
  const [depth, setDepth] = useState(String(board.depthMm ?? ""));
  const [layers, setLayers] = useState(String(board.layers ?? "2"));
  const [cost, setCost] = useState(typeof p.costEstimateUsd === "number" ? String(p.costEstimateUsd) : "");
  const [notes, setNotes] = useState(String(p.notes ?? ""));
  const [comps, setComps] = useState(initComps.length > 0 ? initComps : [{ ref: "", value: "", lcsc: "", role: "" }]);
  const [consigne, setConsigne] = useState("");
  const compsShown = Array.isArray(p.components) ? (p.components as PlanComponent[]).slice(0, 30) : [];

  const setComp = (i: number, k: "ref" | "value" | "lcsc" | "role", v: string) =>
    setComps((prev) => prev.map((c, j) => (j === i ? { ...c, [k]: v } : c)));

  const applyWithChanges = () => {
    const num = (s: string) => { const n = Number(String(s).replace(",", ".")); return Number.isFinite(n) && n > 0 ? n : undefined; };
    const corrected = {
      title: title.trim() || String(p.title ?? "sans titre"),
      objective: objective.trim(),
      components: comps
        .filter((c) => c.ref.trim() || c.value.trim())
        .map((c) => ({ ref: c.ref.trim(), value: c.value.trim(), ...(c.lcsc.trim() ? { lcsc: c.lcsc.trim() } : {}), ...(c.role.trim() ? { role: c.role.trim() } : {}) })),
      board: { ...(num(width) ? { widthMm: num(width) } : {}), ...(num(depth) ? { depthMm: num(depth) } : {}), layers: Math.min(4, Math.max(1, Math.round(num(layers) ?? 2))) },
      ...(num(cost) ? { costEstimateUsd: num(cost) } : {}),
      ...(notes.trim() ? { notes: notes.trim() } : {}),
    };
    const reason = [
      consigne.trim() ? `Consigne de l'utilisateur : ${consigne.trim()}` : "Plan corrigé directement par l'utilisateur.",
      `Plan corrigé (remplace la proposition) : ${JSON.stringify(corrected)}`,
    ].join("\n");
    onApproveWithReason(reason);
  };

  if (editing) {
    return (
      <div className="rounded-lg border border-primary/30 bg-primary/5 p-3">
        <p className="text-[13px] font-medium">Gate H1 — modifier le plan</p>
        <p className="mt-1 text-[11px] text-muted-foreground">Corrige les champs ou décris la modification : reprise immédiate, sans redemander.</p>
        <div className="mt-2 space-y-1.5">
          <input aria-label="Titre du plan" value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls} />
          <textarea aria-label="Objectif" value={objective} onChange={(e) => setObjective(e.target.value)} rows={2} className={`${inputCls} resize-none`} />
          <div className="flex gap-1.5">
            <input aria-label="Largeur mm" value={width} onChange={(e) => setWidth(e.target.value)} inputMode="decimal" placeholder="L mm" className={inputCls} />
            <input aria-label="Profondeur mm" value={depth} onChange={(e) => setDepth(e.target.value)} inputMode="decimal" placeholder="l mm" className={inputCls} />
            <input aria-label="Couches" value={layers} onChange={(e) => setLayers(e.target.value)} inputMode="numeric" placeholder="couches" className={inputCls} />
            <input aria-label="Coût estimé USD" value={cost} onChange={(e) => setCost(e.target.value)} inputMode="decimal" placeholder="≈ $" className={inputCls} />
          </div>
          {comps.map((c, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <input aria-label={`Repère ${i + 1}`} value={c.ref} onChange={(e) => setComp(i, "ref", e.target.value)} placeholder="U1" className={`${inputCls} w-14 shrink-0 font-mono`} />
              <input aria-label={`Valeur ${i + 1}`} value={c.value} onChange={(e) => setComp(i, "value", e.target.value)} placeholder="valeur" className={inputCls} />
              <input aria-label={`LCSC ${i + 1}`} value={c.lcsc} onChange={(e) => setComp(i, "lcsc", e.target.value)} placeholder="LCSC" className={`${inputCls} w-20 shrink-0 font-mono`} />
              <button type="button" onClick={() => setComps((prev) => prev.filter((_, j) => j !== i))} title="Retirer ce composant" aria-label={`Retirer le composant ${i + 1}`} className="shrink-0 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
          <button type="button" onClick={() => setComps((prev) => [...prev.slice(0, 29), { ref: "", value: "", lcsc: "", role: "" }])} className="text-[11px] text-primary hover:underline">
            + Ajouter un composant
          </button>
          <input aria-label="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Points à valider…" className={inputCls} />
          <textarea aria-label="Consigne de modification" value={consigne} onChange={(e) => setConsigne(e.target.value)} rows={2} placeholder="Ou décris la modification en une phrase…" className={`${inputCls} resize-none`} />
        </div>
        <div className="mt-2.5 flex gap-2">
          <Button size="sm" onClick={applyWithChanges}><Check /> Appliquer et reprendre</Button>
          <Button size="sm" variant="outline" onClick={onDeny}><Pencil /> Écrire dans le chat</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-primary/30 bg-primary/5 p-3">
      <p className="text-[13px] font-medium">Gate H1 — plan proposé : {String(p.title ?? "sans titre")}</p>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{String(p.objective ?? "")}</p>
      {compsShown.length > 0 && (
        <ul className="mt-2 space-y-1">
          {compsShown.map((c, i) => (
            <li key={i} className="font-mono text-[11px] text-foreground/90">
              {String(c.ref ?? "?")} · {String(c.value ?? "?")}
              {typeof c.lcsc === "string" && c.lcsc && <span className="text-muted-foreground"> · {c.lcsc}</span>}
              {typeof c.role === "string" && c.role && <span className="text-muted-foreground"> — {c.role}</span>}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 font-mono text-[11px] text-muted-foreground">
        {[board.widthMm && board.depthMm ? `${String(board.widthMm)} × ${String(board.depthMm)} mm` : null,
          board.layers ? `${String(board.layers)} couches` : null,
          typeof p.costEstimateUsd === "number" ? `≈ $${p.costEstimateUsd}` : null].filter(Boolean).join(" · ")}
      </p>
      {typeof p.notes === "string" && p.notes && <p className="mt-1 text-xs text-muted-foreground">{p.notes}</p>}
      <div className="mt-2.5 flex gap-2">
        <Button size="sm" onClick={onApprove}><Check /> Approuver</Button>
        <Button size="sm" variant="outline" onClick={() => setEditing(true)}><Pencil /> Modifier</Button>
      </div>
    </div>
  );
}

interface BomRow { ref?: unknown; value?: unknown; pkg?: unknown; lcsc?: unknown; stock?: unknown; price?: unknown }
interface GateRowState { gate?: unknown; status?: unknown; note?: unknown }
interface FinalInput { summary?: unknown; bom?: unknown; gates?: unknown; limits?: unknown }

function FinalCard({ input, onApprove, onApproveWithReason, onDeny }: {
  input: unknown; onApprove: () => void; onApproveWithReason: (reason: string) => void; onDeny: () => void;
}) {
  const f = (input ?? {}) as FinalInput;
  const bom = Array.isArray(f.bom) ? (f.bom as BomRow[]).slice(0, 100) : [];
  const gates = Array.isArray(f.gates) ? (f.gates as GateRowState[]).slice(0, 8) : [];
  const initLimits = Array.isArray(f.limits) ? (f.limits as unknown[]).filter((l) => typeof l === "string").slice(0, 10) as string[] : [];
  const [editing, setEditing] = useState(false);
  const [summary, setSummary] = useState(String(f.summary ?? ""));
  const [limits, setLimits] = useState(initLimits.join("\n"));
  const [consigne, setConsigne] = useState("");

  const applyWithChanges = () => {
    const corrected = {
      summary: summary.trim(),
      limits: limits.split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 10),
    };
    const reason = [
      consigne.trim() ? `Consigne de l'utilisateur : ${consigne.trim()}` : "Revue corrigée directement par l'utilisateur.",
      `Revue corrigée (remplace la proposition) : ${JSON.stringify(corrected)}`,
    ].join("\n");
    onApproveWithReason(reason);
  };

  if (editing) {
    return (
      <div className="rounded-lg border border-primary/30 bg-primary/5 p-3">
        <p className="text-[13px] font-medium">Gate H2 — modifier la revue</p>
        <p className="mt-1 text-[11px] text-muted-foreground">La BOM vient des recherches réelles (non éditable ici) — corrige le résumé, les limites ou décris la modification.</p>
        <div className="mt-2 space-y-1.5">
          <textarea aria-label="Résumé corrigé" value={summary} onChange={(e) => setSummary(e.target.value)} rows={2} className={`${inputCls} resize-none`} />
          <textarea aria-label="Limites, une par ligne" value={limits} onChange={(e) => setLimits(e.target.value)} rows={3} placeholder="Limites, une par ligne…" className={`${inputCls} resize-none font-mono`} />
          <textarea aria-label="Consigne de modification" value={consigne} onChange={(e) => setConsigne(e.target.value)} rows={2} placeholder="Ex. remplace la LED par une verte, resserre la carte en 30×25…" className={`${inputCls} resize-none`} />
        </div>
        <div className="mt-2.5 flex gap-2">
          <Button size="sm" onClick={applyWithChanges}><Check /> Appliquer et reprendre</Button>
          <Button size="sm" variant="outline" onClick={onDeny}><Pencil /> Écrire dans le chat</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-primary/30 bg-primary/5 p-3">
      <p className="text-[13px] font-medium">Gate H2 — revue avant export</p>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{String(f.summary ?? "")}</p>
      {gates.length > 0 && (
        <p className="mt-2 flex flex-wrap gap-1">
          {gates.map((g, i) => (
            <Badge key={i} variant={String(g.status).toLowerCase().includes("pass") || String(g.status).toLowerCase().includes("vert") || String(g.status) === "ok" ? "success" : "secondary"}>
              {String(g.gate ?? "?")}:{String(g.status ?? "?")}
            </Badge>
          ))}
        </p>
      )}
      {bom.length > 0 && (
        <div className="mt-2 max-h-44 overflow-auto rounded border border-border">
          <table className="w-full text-left text-[11px]">
            <thead>
              <tr className="border-b border-border bg-muted/50 text-muted-foreground">
                <th className="px-2 py-1 font-medium">Réf.</th>
                <th className="px-2 py-1 font-medium">LCSC</th>
                <th className="px-2 py-1 text-right font-medium">Stock</th>
                <th className="px-2 py-1 text-right font-medium">Prix</th>
              </tr>
            </thead>
            <tbody>
              {bom.map((b, i) => (
                <tr key={i} className="border-b border-border/60 last:border-0">
                  <td className="px-2 py-1 font-mono">{String(b.ref ?? "?")} <span className="text-muted-foreground">{String(b.value ?? "")}</span></td>
                  <td className="px-2 py-1 font-mono">{String(b.lcsc ?? "?")}</td>
                  <td className="px-2 py-1 text-right">{b.stock == null ? "?" : String(b.stock)}</td>
                  <td className="px-2 py-1 text-right">{b.price == null ? "?" : `$${String(b.price)}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {initLimits.length > 0 && (
        <ul className="mt-2 list-disc space-y-0.5 pl-4 text-[11px] text-muted-foreground">
          {initLimits.map((l, i) => <li key={i}>{l}</li>)}
        </ul>
      )}
      <div className="mt-2.5 flex gap-2">
        <Button size="sm" onClick={onApprove}><Check /> Approuver et exporter</Button>
        <Button size="sm" variant="outline" onClick={() => setEditing(true)}><Pencil /> Modifier</Button>
      </div>
    </div>
  );
}
