// Types partagés client pour l'API projets (reflets de src/lib/projects.ts,
// serveur-uniquement : ce fichier est la seule chose que le client importe).
export interface ProjectSummary {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
  current_version_id: string | null;
  current_version_no: number | null;
}

export interface VersionSummary {
  id: string;
  version_no: number;
  label: string;
  created_at: string;
  file_count: number;
}
