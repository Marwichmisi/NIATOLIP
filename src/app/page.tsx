"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as RPointerEvent } from "react";
import { TopBar } from "@/components/top-bar";
import { AgentPanel, type ChatMsg } from "@/components/agent-panel";
import { PreviewPanel } from "@/components/preview-panel";
import { INITIAL_STEPS, type AgentStep } from "@/data/mock";
import type { ProjectSummary, VersionSummary } from "@/lib/projects-client";

const SIM_MESSAGES = [
  "Je pars du plan approuvé. Je vérifie d'abord les composants réels chez JLCPCB, puis je génère le code.",
  "Schéma généré et évalué sans erreur. Je contrôle la netlist et le placement avant de lancer le routage.",
  "Placement validé. Je lance le routage — vous pouvez suivre l'avancement dans l'aperçu PCB.",
];

const LAST_PROJECT_KEY = "niatolip:lastProjectId";
const DEFAULT_PROJECT_NAME = "Sensor Node — ESP32-C3";
const GREETING: ChatMsg = { role: "agent", text: "Bonjour — décrivez la carte à créer, ou approuvez le plan proposé pour lancer la génération." };

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  const data = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } };
  if (!res.ok) throw new Error(data.error?.message ?? `Requête ${path} : HTTP ${res.status}`);
  return data;
}

export default function Home() {
  const [model, setModel] = useState("Meta · Spark 1.3");
  const [planApproved, setPlanApproved] = useState(false);
  const [steps, setSteps] = useState<AgentStep[]>(INITIAL_STEPS);
  const [messages, setMessages] = useState<ChatMsg[]>([GREETING]);
  const [running, setRunning] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
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

  const currentVersionNo =
    projects.find((p) => p.id === projectId)?.current_version_no ?? null;

  const refreshProjects = useCallback(async () => {
    const data = await api<{ projects: ProjectSummary[] }>("/api/projects");
    setProjects(data.projects);
    return data.projects;
  }, []);

  const openProject = useCallback(async (id: string) => {
    setProjectLoading(true);
    clearTimers();
    setRunning(false);
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
      persistedCount.current = history.length > 0 ? history.length : 0;
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
  useEffect(() => {
    if (projectLoading || !projectId || persisting.current) return;
    if (messages.length <= persistedCount.current) {
      persistedCount.current = messages.length;
      return;
    }
    const pending = messages.slice(persistedCount.current);
    persistedCount.current = messages.length;
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

  const clearTimers = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };

  const startSimulation = useCallback((announce = false) => {
    clearTimers();
    setRunning(true);
    setSteps(INITIAL_STEPS.map((s) =>
      s.id === "routing" || s.id === "snapshot" || s.id === "kicad" ? { ...s, status: "pending" as const, detail: s.id === "routing" ? "En attente" : s.detail } : s
    ));
    if (announce) setMessages((m) => [...m, { role: "agent", text: SIM_MESSAGES[0] }]);

    const at = (ms: number, fn: () => void) => timers.current.push(setTimeout(fn, ms));
    at(900, () => setMessages((m) => [...m, { role: "agent", text: SIM_MESSAGES[1] }]));
    at(1400, () => setSteps((prev) => prev.map((s) => s.id === "routing" ? { ...s, status: "running", detail: "Routage des pistes en cours…" } : s)));
    at(1600, () => setMessages((m) => [...m, { role: "agent", text: SIM_MESSAGES[2] }]));
    at(4200, () => setSteps((prev) => prev.map((s) =>
      s.id === "routing" ? { ...s, status: "done", detail: "0 net non connecté" } :
      s.id === "snapshot" ? { ...s, status: "running", detail: "Analyse du snapshot…" } : s
    )));
    at(5800, () => setSteps((prev) => prev.map((s) =>
      s.id === "snapshot" ? { ...s, status: "done", detail: "Orientation connecteurs et découplages conformes" } :
      s.id === "kicad" ? { ...s, status: "running", detail: "DRC KiCad dans le worker…" } : s
    )));
    at(7600, () => {
      setSteps((prev) => prev.map((s) => s.id === "kicad" ? { ...s, status: "done", detail: "DRC propre · 0 violation bloquante" } : s));
      setMessages((m) => [...m, { role: "agent", text: "Terminé : routage vérifié (0 net non connecté) et DRC KiCad propre. La revue finale est disponible dans l'onglet Validation." }]);
      setRunning(false);
    });
  }, []);

  useEffect(() => {
    const t = setTimeout(() => { if (planApproved) startSimulation(true); }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planApproved]);

  useEffect(() => clearTimers, []);

  const handleSend = (text: string) => {
    setMessages((m) => [...m, { role: "user", text }]);
    if (!planApproved) {
      setPlanApproved(true);
      return;
    }
    timers.current.push(setTimeout(() => startSimulation(true), 400));
  };

  const handleStop = () => {
    clearTimers();
    setRunning(false);
    setSteps((prev) => prev.map((s) => s.status === "running" ? { ...s, status: "pending", detail: "Interrompu par l'utilisateur" } : s));
    setMessages((m) => [...m, { role: "agent", text: "Run arrêté. La dernière version valide est conservée — dites-moi comment continuer." }]);
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
          planApproved={planApproved}
          onApprovePlan={() => setPlanApproved(true)}
          onSend={handleSend}
          onStop={handleStop}
          onContinue={() => startSimulation(true)}
          model={model}
          onModelChange={setModel}
          style={{ "--agent-w": `${leftW}px` } as CSSProperties}
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
        <PreviewPanel fsMap={fsMap} versionLabel={currentVersionNo ? `v${currentVersionNo}` : "…"} />
      </main>
    </div>
  );
}
