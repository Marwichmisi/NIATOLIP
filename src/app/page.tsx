"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { TopBar } from "@/components/top-bar";
import { AgentPanel, type ChatMsg } from "@/components/agent-panel";
import { PreviewPanel } from "@/components/preview-panel";
import { INITIAL_STEPS, type AgentStep } from "@/data/mock";

const SIM_MESSAGES = [
  "Je pars du plan approuvé. Je vérifie d'abord les composants réels chez JLCPCB, puis je génère le code.",
  "Schéma généré et évalué sans erreur. Je contrôle la netlist et le placement avant de lancer le routage.",
  "Placement validé. Je lance le routage — vous pouvez suivre l'avancement dans l'aperçu PCB.",
];

export default function Home() {
  const [model, setModel] = useState("Meta · Spark 1.3");
  const [planApproved, setPlanApproved] = useState(false);
  const [steps, setSteps] = useState<AgentStep[]>(INITIAL_STEPS);
  const [messages, setMessages] = useState<ChatMsg[]>([
    { role: "agent", text: "Bonjour — décrivez la carte à créer, ou approuvez le plan proposé pour lancer la génération." },
  ]);
  const [running, setRunning] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const routed = steps.find((s) => s.id === "routing")?.status === "done";

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
    setMessages((m) => [...m, { role: "agent", text: "Run arrêté. La dernière version valide (v12) est conservée — dites-moi comment continuer." }]);
  };

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <TopBar model={model} onModelChange={setModel} />
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
        />
        <PreviewPanel routed={routed} />
      </main>
    </div>
  );
}
