// Sélecteurs projet + versions + snapshot (issue #3).
// Icônes seules pour les actions évidentes (title + aria-label), select
// natif comme le sélecteur de modèle (convention existante).
"use client";

import { useState } from "react";
import { Camera, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ProjectSummary, VersionSummary } from "@/lib/projects-client";

export function ProjectControls({
  projects,
  currentId,
  versions,
  currentVersionNo,
  disabled,
  onSelectProject,
  onCreateProject,
  onRestoreVersion,
  onSnapshot,
}: {
  projects: ProjectSummary[];
  currentId: string | null;
  versions: VersionSummary[];
  currentVersionNo: number | null;
  disabled?: boolean;
  onSelectProject: (id: string) => void;
  onCreateProject: (name: string) => void;
  onRestoreVersion: (versionId: string) => void;
  onSnapshot: () => void;
}) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");

  const submitCreate = () => {
    const clean = name.trim();
    if (!clean) return;
    setName("");
    setCreating(false);
    onCreateProject(clean);
  };

  return (
    <div className="flex min-w-0 items-center gap-2">
      <div className="min-w-0 leading-tight">
        {creating ? (
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitCreate();
              if (e.key === "Escape") setCreating(false);
            }}
            onBlur={() => name.trim() === "" && setCreating(false)}
            placeholder="Nom du projet…"
            maxLength={80}
            aria-label="Nom du nouveau projet"
            className="h-7 w-44 rounded-md border border-input bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
        ) : (
          <select
            value={currentId ?? ""}
            onChange={(e) => e.target.value && onSelectProject(e.target.value)}
            disabled={disabled || projects.length === 0}
            title="Projet courant"
            aria-label="Projet courant"
            className="h-7 max-w-52 truncate rounded-md border border-input bg-background px-1.5 text-sm font-medium outline-none focus:ring-2 focus:ring-ring"
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        )}
        <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <select
            value={versions.find((v) => v.version_no === currentVersionNo)?.id ?? ""}
            onChange={(e) => e.target.value && onRestoreVersion(e.target.value)}
            disabled={disabled || versions.length === 0}
            title="Restaurer une version (crée une nouvelle version copiée)"
            aria-label="Restaurer une version"
            className="h-5 max-w-44 truncate rounded border border-transparent bg-transparent text-[11px] outline-none hover:border-input focus:ring-2 focus:ring-ring"
          >
            {versions.map((v) => (
              <option key={v.id} value={v.id}>
                v{v.version_no} · {v.label || "sans label"}
              </option>
            ))}
          </select>
          <span aria-hidden="true">·</span>
          <span>{disabled ? "chargement…" : "sauvegardé"}</span>
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <Button
          variant="ghost"
          size="icon-sm"
          title={creating ? "Valider la création" : "Nouveau projet"}
          aria-label={creating ? "Valider la création" : "Nouveau projet"}
          disabled={disabled}
          onClick={() => (creating ? submitCreate() : setCreating(true))}
        >
          <Plus />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          title="Créer un point de restauration (fige la copie de travail en version)"
          aria-label="Créer un point de restauration"
          disabled={disabled || !currentId}
          onClick={onSnapshot}
        >
          <Camera />
        </Button>
      </div>
    </div>
  );
}
