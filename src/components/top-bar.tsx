"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { CircuitBoard, Download, Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ProjectControls } from "@/components/project-controls";
import type { ProjectSummary, VersionSummary } from "@/lib/projects-client";

export function TopBar({
  projects,
  currentId,
  versions,
  currentVersionNo,
  loading,
  onSelectProject,
  onCreateProject,
  onRestoreVersion,
  onSnapshot,
}: {
  projects: ProjectSummary[];
  currentId: string | null;
  versions: VersionSummary[];
  currentVersionNo: number | null;
  loading: boolean;
  onSelectProject: (id: string) => void;
  onCreateProject: (name: string) => void;
  onRestoreVersion: (versionId: string) => void;
  onSnapshot: () => void;
}) {
  const { theme, setTheme } = useTheme();
  // next-themes ne connaît le thème que côté client : sans ce garde, le
  // serveur et le client rendent une icône/titre différents → erreur
  // d'hydratation React #418 + re-rendu complet visible (layout qui saute).
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const dark = mounted && theme === "dark";
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

      <ProjectControls
        projects={projects}
        currentId={currentId}
        versions={versions}
        currentVersionNo={currentVersionNo}
        disabled={loading}
        onSelectProject={onSelectProject}
        onCreateProject={onCreateProject}
        onRestoreVersion={onRestoreVersion}
        onSnapshot={onSnapshot}
      />

      <Badge variant="success" className="ml-1 hidden sm:inline-flex">Checks OK</Badge>

      <div className="ml-auto flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setTheme(dark ? "light" : "dark")}
          title={dark ? "Passer en thème clair" : "Passer en thème sombre"}
          aria-label="Basculer le thème"
        >
          {dark ? <Sun /> : <Moon />}
        </Button>

        <Button size="sm" className="hidden sm:inline-flex">
          <Download /> Exporter
        </Button>
      </div>
    </header>
  );
}
