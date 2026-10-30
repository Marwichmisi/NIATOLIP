"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as RPointerEvent } from "react";
import { TopBar } from "@/components/top-bar";
import { AgentPanel, MODEL_VALUE_FOR_LABEL, type ChatMsg, type EndState } from "@/components/agent-panel";
import { PreviewPanel } from "@/components/preview-panel";
import type { AgentStep } from "@/data/mock";
import { streamChat, type ApprovalRequest, type ToolPartIn } from "@/lib/chat-stream";
import type { ProjectSummary, VersionSummary } from "@/lib/projects-client";

const TOOL_STEP_LABELS: Record<string, string> = {
  searchComponents: "Recherche composants JLCPCB",
  getComponentDetails: "Fiche composant",
  writeFile: "Écriture du circuit",
  patchFile: "Correction du circuit",
  readFile: "Lecture projet",
  listFiles: "Lecture projet",
  evaluateCircuit: "Évaluation G0 + gates",
  checkNetlist: "Gate G1 netlist",
  checkPlacement: "Gate G2 placement",
  checkRouting: "Gate G3 routage",
  getCircuitSummary: "Revue netlist",
  snapshotBoard: "État carte",
  reportOutOfScope: "Périmètre",
  requestPlanApproval: "Gate H1 plan",
  requestFinalApproval: "Gate H2 revue",
  exportPack: "Export archive",
};

const GATE_TOOLS = new Set(["requestPlanApproval", "requestFinalApproval", "exportPack"]);

const IDLE_STEPS: AgentStep[] = [
  { id: "attente", label: "En attente du premier run", status: "pending", detail: "Décrivez la carte — l'agent proposera un plan (gate H1)." },
];

const LAST_PROJECT_KEY = "niatolip:lastProjectId";
const DEFAULT_PROJECT_NAME = "Sensor Node — ESP32-C3";
const GREETING: ChatMsg = { role: "agent", text: "Bonjour — décrivez la carte à créer. Je proposerai un plan à approuver (H1), puis je génère, vérifie (G0–G3) et reviens pour la revue (H2)." };

function summarizeInput(name: string, input: unknown): string {
  if (!input || typeof input !== "object") return "";
  const o = input as Record<string, unknown>;
  if (typeof o.path === "string") return o.path;
  if (typeof o.title === "string") return o.title.slice(0, 80);
  if (typeof o.summary === "string") return o.summary.slice(0, 80);
  if (typeof o.category === "string") return o.category;
  if (typeof o.lcscId === "string") return o.lcscId;
  if (typeof o.reason === "string") return o.reason.slice(0, 80);
  void name;
  return "";
}

type StoredPart = NonNullable<ChatMsg["parts"]>[number];

function restoredDetail(p: StoredPart): string {
  if (typeof p.error === "string" && p.error) return p.error.slice(0, 160);
  if (p.approval) return p.approval.approved ? "Approuvé par l'utilisateur" : "Refusé par l'utilisateur";
  const o = p.output as Record<string, unknown> | null;
  if (o && typeof o === "object") {
    if (Array.isArray(o.gates)) {
      return (o.gates as Array<{ gate: string; status: string }>).map((g) => `${g.gate}:${g.status}`).join(" ");
    }
    if (Array.isArray(o.candidates)) return `${o.candidates.length} candidat(s)`;
    if (typeof o.hint === "string") return o.hint.slice(0, 160);
    if (typeof o.message === "string") return o.message.slice(0, 160);
  }
  return summarizeInput(p.toolName, p.input) || "Terminé";
}

/** Reconstruit le fil d'exécution depuis les parts persistées (réouverture, FR-12). */
function stepsFromParts(parts: StoredPart[] | undefined): AgentStep[] | null {
  if (!parts || parts.length === 0) return null;
  return parts.slice(0, 100).map((p, i) => ({
    id: `h-${p.toolCallId || i}`,
    label: TOOL_STEP_LABELS[p.toolName] ?? p.toolName,
    detail: restoredDetail(p),
    status: (typeof p.error === "string" && p.error
      ? "error"
      : p.approval && !p.approval.approved
        ? "denied"
        : "done") as AgentStep["status"],
    tool: p.toolName,
  }));
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  const data = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } };
  if (!res.ok) throw new Error(data.error?.message ?? `Requête ${path} : HTTP ${res.status}`);
  return data;
}

export default function Home() {
  const [model, setModel] = useState("Meta · Spark 1.3");
  const [steps, setSteps] = useState<AgentStep[]>(IDLE_STEPS);
  const [messages, setMessages] = useState<ChatMsg[]>([GREETING]);
  const [running, setRunning] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const boardRef = useRef<Record<string, unknown> | null>(null);
  const [runCost, setRunCost] = useState<{ cost: number; max: number } | null>(null);
  const [runSteps, setRunSteps] = useState<{ steps: number; max: number } | null>(null);
  const [pendingApproval, setPendingApproval] = useState<ApprovalRequest | null>(null);
  const [endState, setEndState] = useState<EndState | null>(null);
  const [exportUrl, setExportUrl] = useState<string | null>(null);
  const [focusKey, setFocusKey] = useState(0);
  const pendingRef = useRef<ApprovalRequest | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  /** Reprise d'un tour suspendu sur gate : survit aux re-renders (contrairement à un champ sur closure). */
  const resumeRef = useRef<{
    serverMessages: ChatMsg[]; baseText: string; baseParts: ToolPartIn[];
    assistantIdx: number; choice: string; pid: string;
  } | null>(null);
  const [leftW, setLeftW] = useState(400);
  const dragStart = useRef<{ x: number; w: number } | null>(null);

  // --- Projets / versions / fichiers (issue #3) ---
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [versions, setVersions] = useState<VersionSummary[]>([]);
  const [fsMap, setFsMap] = useState<Record<string, string> | null>(null);
  const [projectLoading, setProjectLoading] = useState(true);
  const persistedCount = useRef(0);
  const persisting = useRef(false);
  // Index du dernier message FINALISÉ (persistable). Le message agent en
  // cours de stream ne l'est jamais : son texte est partiel et sans parts.
  const finalizedRef = useRef(-1);

  const currentVersionNo =
    projects.find((p) => p.id === projectId)?.current_version_no ?? null;

  const refreshProjects = useCallback(async () => {
    const data = await api<{ projects: ProjectSummary[] }>("/api/projects");
    setProjects(data.projects);
    return data.projects;
  }, []);

  const openProject = useCallback(async (id: string) => {
    setProjectLoading(true);
    abortRef.current?.abort();
    abortRef.current = null;
    setRunning(false);
    setPendingApproval(null);
    pendingRef.current = null;
    resumeRef.current = null;
    setEndState(null);
    setExportUrl(null);
    try {
      const [filesData, versionsData, messagesData] = await Promise.all([
        api<{ files: Record<string, string> }>(`/api/projects/${id}/files`),
        api<{ versions: VersionSummary[] }>(`/api/projects/${id}/versions`),
        api<{ messages: ChatMsg[] }>(`/api/projects/${id}/messages`),
      ]);
      setFsMap(filesData.files);
      setVersions(versionsData.versions);
      const history = messagesData.messages.filter((m) => m.role === "user" || m.role === "agent");
      setMessages(history.length > 0 ? history : [GREETING]);
      // Fil d'exécution restauré depuis le dernier run persisté (FR-12).
      const lastWithParts = [...history].reverse().find((m) => m.role === "agent" && (m.parts?.length ?? 0) > 0);
      setSteps(stepsFromParts(lastWithParts?.parts) ?? IDLE_STEPS);
      persistedCount.current = history.length > 0 ? history.length : 0;
      finalizedRef.current = history.length > 0 ? history.length - 1 : -1;
      setProjectId(id);
      try {
        localStorage.setItem(LAST_PROJECT_KEY, id);
      } catch {
        // Stockage local indisponible : l'ouverture reste fonctionnelle.
      }
      await refreshProjects();
    } finally {
      setProjectLoading(false);
    }
  }, [refreshProjects]);

  // Premier chargement : liste → dernier projet rouvert, sinon premier, sinon création.
  useEffect(() => {
    (async () => {
      try {
        const list = await refreshProjects();
        let last: string | null = null;
        try {
          last = localStorage.getItem(LAST_PROJECT_KEY);
        } catch {
          last = null;
        }
        if (last && list.some((p) => p.id === last)) {
          await openProject(last);
        } else if (list.length > 0) {
          await openProject(list[0].id);
        } else {
          const created = await api<{ project: ProjectSummary }>("/api/projects", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: DEFAULT_PROJECT_NAME }),
          });
          await openProject(created.project.id);
        }
      } catch {
        setProjectLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persistance incrémentale de l'historique (ne bloque jamais l'UI).
  // Seuls les messages FINALISÉS sont persistés (finalizedRef) : le message
  // agent en cours de stream (ou en attente d'approbation) ne l'est jamais —
  // sinon la mémoire inter-runs serait un texte vide sans appels d'outils.
  useEffect(() => {
    if (projectLoading || !projectId || persisting.current) return;
    const finalized = Math.min(finalizedRef.current + 1, messages.length);
    if (finalized <= persistedCount.current) {
      persistedCount.current = Math.min(persistedCount.current, finalized);
      return;
    }
    const pending = messages.slice(persistedCount.current, finalized);
    persistedCount.current = finalized;
    persisting.current = true;
    fetch(`/api/projects/${projectId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: pending }),
    })
      .catch(() => {
        // Échec réseau : on retentera à la prochaine vague (compteur reculé).
        persistedCount.current = Math.max(0, persistedCount.current - pending.length);
      })
      .finally(() => {
        persisting.current = false;
      });
  }, [messages, projectId, projectLoading]);

  const handleCreateProject = useCallback(async (name: string) => {
    const created = await api<{ project: ProjectSummary }>("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    setMessages([GREETING]);
    persistedCount.current = 0;
    finalizedRef.current = -1;
    await openProject(created.project.id);
  }, [openProject]);

  const handleSnapshot = useCallback(async () => {
    if (!projectId) return;
    const data = await api<{ version: VersionSummary }>(`/api/projects/${projectId}/versions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const list = await api<{ versions: VersionSummary[] }>(`/api/projects/${projectId}/versions`);
    setVersions(list.versions);
    await refreshProjects();
    setMessages((m) => [...m, { role: "agent", text: `Point de restauration v${data.version.version_no} créé — la copie de travail est figée.` }]);
    finalizedRef.current = messagesRef.current.length;
  }, [projectId, refreshProjects]);

  const handleRestoreVersion = useCallback(async (versionId: string) => {
    if (!projectId) return;
    const data = await api<{ version: VersionSummary }>(
      `/api/projects/${projectId}/versions/${versionId}/restore`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) }
    );
    const [filesData, list] = await Promise.all([
      api<{ files: Record<string, string> }>(`/api/projects/${projectId}/files`),
      api<{ versions: VersionSummary[] }>(`/api/projects/${projectId}/versions`),
    ]);
    setFsMap(filesData.files);
    setVersions(list.versions);
    await refreshProjects();
    setMessages((m) => [...m, { role: "agent", text: `Version restaurée en v${data.version.version_no} (copie, historique préservé).` }]);
    finalizedRef.current = messagesRef.current.length;
  }, [projectId, refreshProjects]);

  const onDividerPointerDown = (e: RPointerEvent<HTMLDivElement>) => {
    dragStart.current = { x: e.clientX, w: leftW };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onDividerPointerMove = (e: RPointerEvent<HTMLDivElement>) => {
    const start = dragStart.current;
    if (!start) return;
    const next = Math.min(640, Math.max(280, start.w + e.clientX - start.x));
    setLeftW(next);
  };

  const onDividerPointerUp = () => {
    dragStart.current = null;
  };

  const messagesRef = useRef(messages);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // --- Run agent réel (issue #4) + gates H1/H2 (issue #5) ---
  const refreshProjectState = useCallback(async () => {
    if (!projectId) return;
    try {
      const [filesData, list] = await Promise.all([
        api<{ files: Record<string, string> }>(`/api/projects/${projectId}/files`),
        api<{ versions: VersionSummary[] }>(`/api/projects/${projectId}/versions`),
      ]);
      setFsMap(filesData.files);
      setVersions(list.versions);
      await refreshProjects();
    } catch {
      // Repli : la preview garde le dernier état connu.
    }
  }, [projectId, refreshProjects]);

  const stopPoll = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const startPoll = useCallback((runId: string) => {
    stopPoll();
    const tick = async () => {
      try {
        const st = await api<{ run: { steps: number; maxSteps: number; costUsd: number; maxCostUsd: number } }>(
          `/api/chat/${runId}`
        );
        setRunSteps({ steps: st.run.steps, max: st.run.maxSteps });
        setRunCost({ cost: st.run.costUsd, max: st.run.maxCostUsd });
        lastStepsRef.current = {
          steps: st.run.steps, max: st.run.maxSteps,
          cost: st.run.costUsd, maxCost: st.run.maxCostUsd,
        };
      } catch {
        // Coût indisponible : non bloquant.
      }
    };
    void tick();
    pollRef.current = setInterval(() => void tick(), 2000);
  }, [stopPoll]);

  /** Affiche l'erreur RÉELLE d'un segment (registre serveur, pas le « An error occurred » générique). */
  const reportSegmentError = useCallback(async (runId: string | null, fallback: string) => {
    let detail = fallback;
    try {
      if (runId) {
        const st = await api<{ run: { error: string | null } }>(`/api/chat/${runId}`);
        if (st.run.error) detail = st.run.error;
      }
    } catch {
      // Registre indisponible : on garde le message du stream.
    }
    const text = `Run échoué : ${detail.slice(0, 500)}`;
    setMessages((m) => [...m, { role: "agent", text }]);
    finalizedRef.current = messagesRef.current.length;
  }, []);
  /** Dernier relevé étapes/coût (poll) — repli si le fetch final échoue. */
  const lastStepsRef = useRef<{ steps: number; max: number; cost: number; maxCost: number } | null>(null);

  /**
   * État de fin d'itération (doc 06 §4) : plafond d'étapes, budget, ou arrêt
   * du modèle avant la fin — dans les trois cas, le bouton « Continuer
   * l'itération » doit apparaître (même projet, même modèle, jamais de
   * relance automatique). Version relue fraîche (snapshot possible pendant
   * le run), jamais le compteur fermé au départ du run.
   */
  const applyEndState = useCallback(async (runId: string | null, pid: string) => {
    let steps = lastStepsRef.current?.steps ?? 0;
    let max = lastStepsRef.current?.max ?? 50;
    let cost = lastStepsRef.current?.cost ?? 0;
    let maxCost = lastStepsRef.current?.maxCost ?? 2;
    try {
      if (runId) {
        const st = await api<{ run: { steps: number; maxSteps: number; costUsd: number; maxCostUsd: number } }>(
          `/api/chat/${runId}`
        );
        steps = st.run.steps;
        max = st.run.maxSteps;
        cost = st.run.costUsd;
        maxCost = st.run.maxCostUsd;
        setRunSteps({ steps, max });
        setRunCost({ cost, max: maxCost });
      }
    } catch {
      // Registre indisponible : on garde le dernier relevé du poll.
    }
    let vlabel = "version courante";
    try {
      const vs = await api<{ versions: VersionSummary[] }>(`/api/projects/${pid}/versions`);
      if (vs.versions.length > 0) {
        vlabel = `v${Math.max(...vs.versions.map((v) => v.version_no))}`;
      }
    } catch {
      // Versions illisibles : libellé générique.
    }
    if (steps >= max) {
      setEndState({ kind: "steps", steps, max, versionLabel: vlabel });
    } else if (maxCost > 0 && cost >= maxCost) {
      setEndState({ kind: "budget", steps, max, versionLabel: vlabel });
    } else if (steps > 0) {
      // Arrêt du modèle (tâche possiblement inachevée) : même affordance.
      setEndState({ kind: "ended", steps, max, versionLabel: vlabel });
    }
  }, []);

  /** Un segment de stream (run initial ou reprise après approbation). */
  const streamSegment = useCallback(async (opts: {
    serverMessages: ChatMsg[];
    choice: string;
    pid: string;
    assistantIdx: number;
    baseText: string;
    baseParts: ToolPartIn[];
    ctrl: AbortController;
  }): Promise<{ text: string; runId: string | null; parts: ToolPartIn[]; pending: ApprovalRequest | null; streamError: string | null }> => {
    const result = await streamChat({
      messages: opts.serverMessages,
      model: opts.choice,
      projectId: opts.pid,
      clientBoard: boardRef.current,
      signal: opts.ctrl.signal,
      // Reprise après gate : les inputs des outils déjà exécutés datent du
      // segment précédent — sans ça, l'étape de reprise s'affiche « outil ».
      knownTools: opts.baseParts
        .filter((p) => p.toolCallId)
        .map((p) => ({ toolCallId: p.toolCallId, toolName: p.toolName, input: p.input ?? null })),
      cb: {
        onText: (full) =>
          setMessages((m) => {
            const next = [...m];
            next[opts.assistantIdx] = { ...next[opts.assistantIdx], text: opts.baseText + full };
            return next;
          }),
        onToolStart: (name, id, input) =>
          setSteps((prev) => [
            ...prev.filter((s) => s.id !== `t-${id}`),
            {
              id: `t-${id}`, label: TOOL_STEP_LABELS[name] ?? name, status: "running",
              detail: summarizeInput(name, input) || "En cours…", tool: name,
              startedAt: Date.now(),
            },
          ]),
        onToolEnd: (name, id, ok, detail, raw) => {
          setSteps((prev) =>
            prev.map((s) =>
              s.id === `t-${id}`
                ? {
                    ...s,
                    status: GATE_TOOLS.has(name) && !ok && detail.startsWith("Refusé")
                      ? ("denied" as const)
                      : ok ? ("done" as const) : ("error" as const),
                    detail: detail || name,
                    raw,
                  }
                : s
            )
          );
          if (name === "exportPack" && ok) {
            const url = `/api/projects/${opts.pid}/export`;
            setExportUrl(url);
            try {
              const a = document.createElement("a");
              a.href = url;
              document.body.appendChild(a);
              a.click();
              a.remove();
            } catch {
              // Téléchargement bloqué : le lien « Archive prête » reste cliquable.
            }
          }
        },
        onApprovalRequest: (approval) => {
          pendingRef.current = approval;
          setPendingApproval(approval);
          setSteps((prev) =>
            prev.map((s) =>
              s.id === `t-${approval.toolCallId}`
                ? { ...s, status: "awaiting" as const, detail: "En attente de votre approbation — aucun passage sans clic." }
                : s
            )
          );
        },
        onError: (message) =>
          setMessages((m) => {
            const next = [...m];
            const last = next[opts.assistantIdx];
            if (last.role === "agent") next[opts.assistantIdx] = { ...last, text: `${last.text}\nErreur de stream : ${message}` };
            return next;
          }),
      },
    });
    return {
      text: result.text,
      runId: result.runId,
      parts: [...opts.baseParts, ...result.parts],
      pending: result.pendingApproval,
      streamError: result.streamError,
    };
  }, []);

  const runChat = useCallback(async (text: string) => {
    if (!projectId || running) return;
    const choice = MODEL_VALUE_FOR_LABEL[model] ?? "meta-spark";
    const pid = projectId;
    setRunning(true);
    setRunCost(null);
    setRunSteps(null);
    lastStepsRef.current = null;
    setPendingApproval(null);
    pendingRef.current = null;
    resumeRef.current = null;
    setEndState(null);
    setExportUrl(null);
    setSteps([]);
    const history: ChatMsg[] = [...messagesRef.current, { role: "user", text }];
    setMessages(history);
    finalizedRef.current = history.length - 1; // le user seul est finalisé…
    const assistantIdx = history.length;
    setMessages([...history, { role: "agent", text: "" }]); // …le placeholder ne l'est pas
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      // Boucle de segments : run initial puis reprises après chaque approbation.
      let serverMessages: ChatMsg[] = history;
      let baseText = "";
      let baseParts: ToolPartIn[] = [];
      for (;;) {
        const seg = await streamSegment({
          serverMessages, choice, pid, assistantIdx, baseText, baseParts, ctrl,
        });
        if (seg.runId) startPoll(seg.runId);
        baseText = baseText + seg.text;
        baseParts = seg.parts;
        // Mémorise les parts sur le message (reprise + persistance finale).
        const frozen = baseParts;
        setMessages((m) => {
          const next = [...m];
          const last = next[assistantIdx];
          if (last?.role === "agent") next[assistantIdx] = { ...last, parts: frozen };
          return next;
        });
        if (!seg.pending) {
          // Segment final : le message agent est finalisé (persisté).
          finalizedRef.current = assistantIdx;
          if (seg.streamError) {
            await reportSegmentError(seg.runId, seg.streamError);
          } else {
            // Fin d'itération (plafond, budget ou arrêt modèle) : la carte
            // « Continuer l'itération » doit toujours pouvoir apparaître.
            await applyEndState(seg.runId, pid);
          }
          break;
        }
        // Suspension sur gate : le run serveur est terminé, on attend le clic.
        // La reprise relance streamSegment via continueTurn (même assistantIdx).
        resumeRef.current = { serverMessages, baseText, baseParts, assistantIdx, choice, pid };
        break;
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        const message = err instanceof Error ? err.message : String(err);
        setMessages((m) => {
          const next = [...m];
          const last = next[next.length - 1];
          if (last.role === "agent" && last.text === "") {
            next[next.length - 1] = { role: "agent", text: `Run échoué : ${message}` };
          } else {
            next.push({ role: "agent", text: `Run échoué : ${message}` });
          }
          return next;
        });
        finalizedRef.current = messagesRef.current.length;
      }
    } finally {
      // Si une approbation est en attente, le tour n'est pas fini : on reste
      // en `running` (bouton Stop visible) sans persister le message partiel.
      if (!pendingRef.current) {
        abortRef.current = null;
        setRunning(false);
        stopPoll();
        await refreshProjectState();
      }
    }
  }, [projectId, running, model, refreshProjectState, streamSegment, startPoll, stopPoll, reportSegmentError, applyEndState]);

  /** Reprise du tour après APPROBATION explicite (même message agent, même projet, même modèle).
   *  `reason` porte les modifications de l'utilisateur (plan/BOM corrigé) :
   *  le modèle les reçoit dans tool-approval-response et les applique avant
   *  de continuer — sans redemander. Un refus n'appelle jamais ceci :
   *  handleDeny annule la gate sans relancer (doc 06 §2.2). */
  const continueTurn = useCallback(async (reason?: string) => {
    const pending = pendingRef.current;
    const resume = resumeRef.current;
    if (!pending || !resume) return;
    pendingRef.current = null;
    setPendingApproval(null);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setSteps((prev) =>
      prev.map((s) =>
        s.id === `t-${pending.toolCallId}`
          ? { ...s, status: "running" as const, detail: reason ? "Approuvé avec modifications — reprise…" : "Approuvé — reprise du run…" }
          : s
      )
    );
    try {
      const responded: ToolPartIn = {
        toolName: pending.toolName,
        toolCallId: pending.toolCallId,
        input: pending.input ?? null,
        approval: {
          id: pending.approvalId,
          approved: true,
          ...(reason ? { reason: reason.slice(0, 2000) } : {}),
        },
      };
      const assistantMsg: ChatMsg = {
        role: "agent",
        text: resume.baseText,
        parts: [...resume.baseParts, responded],
      };
      const serverMessages: ChatMsg[] = [...resume.serverMessages, assistantMsg];
      for (;;) {
        const seg = await streamSegment({
          serverMessages, choice: resume.choice, pid: resume.pid,
          assistantIdx: resume.assistantIdx, baseText: resume.baseText, baseParts: assistantMsg.parts ?? [],
          ctrl,
        });
        if (seg.runId) startPoll(seg.runId);
        const newBaseText = resume.baseText + seg.text;
        const frozen = seg.parts;
        setMessages((m) => {
          const next = [...m];
          const last = next[resume.assistantIdx];
          if (last?.role === "agent") next[resume.assistantIdx] = { ...last, text: newBaseText, parts: frozen };
          return next;
        });
        if (!seg.pending) {
          finalizedRef.current = resume.assistantIdx;
          resumeRef.current = null;
          if (seg.streamError) {
            await reportSegmentError(seg.runId, seg.streamError);
          } else {
            await applyEndState(seg.runId, resume.pid);
          }
          break;
        }
        // Nouvelle gate (ex. H2 après H1) : on ré-arme la reprise.
        resumeRef.current = {
          serverMessages, baseText: newBaseText, baseParts: frozen,
          assistantIdx: resume.assistantIdx, choice: resume.choice, pid: resume.pid,
        };
        return;
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        const message = err instanceof Error ? err.message : String(err);
        setMessages((m) => [...m, { role: "agent", text: `Reprise échouée : ${message}` }]);
        finalizedRef.current = messagesRef.current.length;
      }
    } finally {
      if (!pendingRef.current) {
        abortRef.current = null;
        setRunning(false);
        stopPoll();
        await refreshProjectState();
      }
    }
  }, [refreshProjectState, streamSegment, startPoll, stopPoll, reportSegmentError, applyEndState]);

  const handleApprove = useCallback(() => {
    void continueTurn();
  }, [continueTurn]);

  const handleApproveWithReason = useCallback((reason: string) => {
    void continueTurn(reason);
  }, [continueTurn]);

  const handleDeny = useCallback(() => {
    // Refus de gate : on ANNULE, on ne relance rien. Le message agent
    // (texte + outils déjà exécutés) est finalisé pour la mémoire, puis une
    // note invite à préciser les modifications. Le panneau pré-remplit
    // « Modifie : » et focusse le champ (doc 06 §2.2).
    const pending = pendingRef.current;
    const resume = resumeRef.current;
    pendingRef.current = null;
    resumeRef.current = null;
    setPendingApproval(null);
    setEndState(null);
    setFocusKey((k) => k + 1);
    if (pending && resume) {
      const rid = pending.toolCallId;
      setSteps((prev) => prev.map((s) =>
        s.id === `t-${rid}` ? { ...s, status: "denied" as const, detail: "Refusé — précisez vos modifications." } : s
      ));
      const frozen: ToolPartIn[] = resume.baseParts;
      setMessages((m) => {
        const next = [...m];
        const last = next[resume.assistantIdx];
        if (last?.role === "agent") next[resume.assistantIdx] = { ...last, parts: frozen.length > 0 ? frozen : last.parts };
        return next;
      });
      finalizedRef.current = resume.assistantIdx;
      setMessages((m) => [...m, { role: "agent", text: "Gate refusée — rien n'a été exécuté sans votre accord. Précisez vos modifications ci-dessous puis Envoyer." }]);
      finalizedRef.current = messagesRef.current.length;
    }
    abortRef.current = null;
    setRunning(false);
    stopPoll();
    void refreshProjectState();
  }, [refreshProjectState, stopPoll]);

  const handleSend = (text: string) => {
    void runChat(text);
  };

  const handleStop = () => {
    setEndState(null);
    if (pendingRef.current) {
      // Annule l'attente d'approbation : le run serveur est déjà terminé.
      const id = pendingRef.current.toolCallId;
      pendingRef.current = null;
      resumeRef.current = null;
      setPendingApproval(null);
      setSteps((prev) => prev.map((s) =>
        s.id === `t-${id}` ? { ...s, status: "pending" as const, detail: "Gate annulée par l'utilisateur" } : s
      ));
      setMessages((m) => [...m, { role: "agent", text: "Gate annulée. Dites-moi comment continuer." }]);
      finalizedRef.current = messagesRef.current.length;
      abortRef.current = null;
      setRunning(false);
      stopPoll();
      return;
    }
    abortRef.current?.abort();
    abortRef.current = null;
    setRunning(false);
    stopPoll();
    setSteps((prev) => prev.map((s) => s.status === "running" ? { ...s, status: "pending", detail: "Interrompu par l'utilisateur" } : s));
    setMessages((m) => [...m, { role: "agent", text: "Run arrêté. La dernière version valide est conservée — dites-moi comment continuer." }]);
    finalizedRef.current = messagesRef.current.length;
  };

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <TopBar
        projects={projects}
        currentId={projectId}
        versions={versions}
        currentVersionNo={currentVersionNo}
        loading={projectLoading}
        onSelectProject={(id) => void openProject(id)}
        onCreateProject={(name) => void handleCreateProject(name)}
        onRestoreVersion={(vid) => void handleRestoreVersion(vid)}
        onSnapshot={() => void handleSnapshot()}
      />
      <main className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <AgentPanel
          steps={steps}
          running={running}
          messages={messages}
          onSend={handleSend}
          onStop={handleStop}
          onContinue={() => void runChat("Continue l'itération avec le même contexte projet.")}
          model={model}
          onModelChange={setModel}
          runCost={runCost}
          runSteps={runSteps}
          pendingApproval={pendingApproval}
          onApprove={handleApprove}
          onApproveWithReason={handleApproveWithReason}
          onDeny={handleDeny}
          endState={endState}
          exportUrl={exportUrl}
          style={{ "--agent-w": `${leftW}px` } as CSSProperties}
          focusKey={focusKey}
        />
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Redimensionner les panneaux"
          title="Glisser pour redimensionner (double-clic pour réinitialiser)"
          onPointerDown={onDividerPointerDown}
          onPointerMove={onDividerPointerMove}
          onPointerUp={onDividerPointerUp}
          onDoubleClick={() => setLeftW(400)}
          className="hidden shrink-0 cursor-col-resize touch-none items-stretch justify-center bg-transparent transition-colors hover:bg-primary/20 lg:flex"
        >
          <div className="w-px bg-border" />
        </div>
        <PreviewPanel
          fsMap={fsMap}
          versionLabel={currentVersionNo ? `v${currentVersionNo}` : "…"}
          onBoardState={(s) => {
            boardRef.current = s;
          }}
        />
      </main>
    </div>
  );
}
