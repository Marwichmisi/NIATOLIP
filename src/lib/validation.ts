// Jobs de validation M2 (issue #7, doc 05 G4/G5, doc 07 §1/§4).
// Docker-only strict (choix utilisateur) : le web crée des jobs `queued`,
// le worker (service `worker` du compose, image kicad/kicad:9.0 + Node)
// les réclame, exécute kicad-cli ERC/DRC + exports, écrit les rapports et
// les artefacts sur le volume partagé. Sans worker (dev local `npm run dev`),
// les jobs restent `queued` et l'API le dit honnêtement (jamais de faux vert).
//
// Double backend comme projects.ts : Postgres quand DATABASE_URL est posée,
// sinon JSON local dans PROJECTS_DIR/.cache. Serveur uniquement.
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getPool, initSchema, isPgConfigured } from "@/lib/db";

if (typeof window !== "undefined") {
  throw new Error("validation.ts est serveur-uniquement.");
}

export type ValidationStatus = "queued" | "running" | "done" | "error";

/** Kinds du pack fabrication (doc 05 §4). */
export const ARTIFACT_KINDS = ["gerber", "bom", "pnp", "kicad", "sources", "report"] as const;
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];

export interface ArtifactMeta {
  id: string;
  jobId: string | null;
  projectId: string;
  kind: ArtifactKind;
  filename: string;
  bytes: number;
  sha256: string;
  created_at: string;
  /** URL de téléchargement (route web). Renseignée par les routes GET. */
  url?: string;
}

export interface GateVerdict {
  status: "pass" | "fail";
  findings: Array<{ severity: "error" | "warning"; code: string; message: string; ref?: string }>;
  stats: Record<string, number | string>;
}

export interface ValidationJob {
  id: string;
  projectId: string;
  versionId: string | null;
  versionNo: number | null;
  label: string;
  status: ValidationStatus;
  worker: string | null;
  kicadVersion: string | null;
  tscircuitVersion: string | null;
  filesSnapshot: Record<string, string>;
  g0g3: unknown;
  erc: unknown;
  drc: unknown;
  g4: GateVerdict | null;
  g5: GateVerdict | null;
  error: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  artifacts?: ArtifactMeta[];
}

const MAX_SNAPSHOT_FILES = 50;
const MAX_SNAPSHOT_BYTES = 8_000_000;

function err(code: string, message: string, status = 400): never {
  const e = new Error(message) as Error & { code: string; status: number };
  e.code = code;
  e.status = status;
  throw e;
}

function artifactsDir(): string {
  return process.env.ARTIFACTS_DIR ?? join(process.cwd(), "artifacts");
}

function jobsCachePath(): string {
  const base = process.env.PROJECTS_DIR ?? join(process.cwd(), "projects");
  return join(base, ".cache", "validation-jobs.json");
}

function sha256Hex(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

function artifactFilePath(artifactId: string, filename: string): string {
  const safe = filename.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 80) || "artefact";
  return join(artifactsDir(), `${artifactId}--${safe}`);
}

function toJob(row: Record<string, unknown>): ValidationJob {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    versionId: (row.version_id as string | null) ?? null,
    versionNo: (row.version_no as number | null) ?? null,
    label: String(row.label ?? ""),
    status: row.status as ValidationStatus,
    worker: (row.worker as string | null) ?? null,
    kicadVersion: (row.kicad_version as string | null) ?? null,
    tscircuitVersion: (row.tscircuit_version as string | null) ?? null,
    filesSnapshot: (row.files_snapshot as Record<string, string>) ?? {},
    g0g3: (row.g0g3 as unknown) ?? null,
    erc: (row.erc as unknown) ?? null,
    drc: (row.drc as unknown) ?? null,
    g4: (row.g4 as GateVerdict | null) ?? null,
    g5: (row.g5 as GateVerdict | null) ?? null,
    error: (row.error as string | null) ?? null,
    created_at: new Date(row.created_at as string).toISOString(),
    started_at: row.started_at ? new Date(row.started_at as string).toISOString() : null,
    finished_at: row.finished_at ? new Date(row.finished_at as string).toISOString() : null,
  };
}

function withUrls(job: ValidationJob, artifacts: ArtifactMeta[]): ValidationJob {
  return {
    ...job,
    artifacts: artifacts.map((a) => ({ ...a, url: `/api/artifacts/${a.id}/download` })),
  };
}

// ---------- Backend Postgres ----------

async function pgCreate(
  projectId: string,
  files: Record<string, string>,
  opts: { versionId?: string | null; versionNo?: number | null; label?: string; g0g3?: unknown }
): Promise<ValidationJob> {
  await initSchema();
  const id = randomUUID();
  const { rows } = await getPool().query(
    `insert into validation_jobs(id, project_id, version_id, version_no, label, status, files_snapshot, g0g3)
     values($1,$2,$3,$4,$5,'queued',$6,$7) returning *`,
    [
      id,
      projectId,
      opts.versionId ?? null,
      opts.versionNo ?? null,
      (opts.label ?? "").slice(0, 120),
      JSON.stringify(files),
      opts.g0g3 === undefined ? null : JSON.stringify(opts.g0g3),
    ]
  );
  return toJob(rows[0] as Record<string, unknown>);
}

async function pgGet(id: string): Promise<ValidationJob> {
  await initSchema();
  const { rows } = await getPool().query("select * from validation_jobs where id=$1", [id]);
  if (rows.length === 0) err("not_found", "Job de validation introuvable.", 404);
  const job = toJob(rows[0] as Record<string, unknown>);
  const arts = await getPool().query("select * from artifacts where job_id=$1 order by created_at asc", [id]);
  return withUrls(
    job,
    (arts.rows as Record<string, unknown>[]).map((r) => ({
      id: String(r.id),
      jobId: (r.job_id as string | null) ?? null,
      projectId: String(r.project_id),
      kind: r.kind as ArtifactKind,
      filename: String(r.filename),
      bytes: Number(r.bytes),
      sha256: String(r.sha256),
      created_at: new Date(r.created_at as string).toISOString(),
    }))
  );
}

async function pgLatestForProject(projectId: string): Promise<ValidationJob | null> {
  await initSchema();
  const { rows } = await getPool().query(
    "select * from validation_jobs where project_id=$1 order by created_at desc limit 1",
    [projectId]
  );
  if (rows.length === 0) return null;
  return pgGet(String((rows[0] as Record<string, unknown>).id));
}

async function pgLatestGreen(projectId: string): Promise<ValidationJob | null> {
  await initSchema();
  // Dernier job terminé avec G4+G5 verts (JSONB : g4->>'status' = 'pass').
  const { rows } = await getPool().query(
    `select * from validation_jobs where project_id=$1 and status='done'
     and g4->>'status'='pass' and g5->>'status'='pass'
     order by finished_at desc nulls last, created_at desc limit 1`,
    [projectId]
  );
  if (rows.length === 0) return null;
  return pgGet(String((rows[0] as Record<string, unknown>).id));
}

// ---------- Backend fichiers locaux ----------

interface FileJobsDoc {
  jobs: Array<Omit<ValidationJob, "artifacts"> & { artifacts?: ArtifactMeta[] }>;
  artifacts: ArtifactMeta[];
}

async function fileReadDoc(): Promise<FileJobsDoc> {
  try {
    const raw = await readFile(jobsCachePath(), "utf8");
    const parsed = JSON.parse(raw) as FileJobsDoc;
    if (!Array.isArray(parsed.jobs) || !Array.isArray(parsed.artifacts)) {
      return { jobs: [], artifacts: [] };
    }
    return parsed;
  } catch {
    return { jobs: [], artifacts: [] };
  }
}

async function fileWriteDoc(doc: FileJobsDoc): Promise<void> {
  const p = jobsCachePath();
  await mkdir(join(p, ".."), { recursive: true });
  const tmp = `${p}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(doc), "utf8");
  await rename(tmp, p);
}

async function fileCreate(
  projectId: string,
  files: Record<string, string>,
  opts: { versionId?: string | null; versionNo?: number | null; label?: string; g0g3?: unknown }
): Promise<ValidationJob> {
  const doc = await fileReadDoc();
  const now = new Date().toISOString();
  const job: ValidationJob = {
    id: randomUUID(),
    projectId,
    versionId: opts.versionId ?? null,
    versionNo: opts.versionNo ?? null,
    label: (opts.label ?? "").slice(0, 120),
    status: "queued",
    worker: null,
    kicadVersion: null,
    tscircuitVersion: null,
    filesSnapshot: files,
    g0g3: opts.g0g3 ?? null,
    erc: null,
    drc: null,
    g4: null,
    g5: null,
    error: null,
    created_at: now,
    started_at: null,
    finished_at: null,
    artifacts: [],
  };
  doc.jobs.push({ ...job, artifacts: [] });
  await fileWriteDoc(doc);
  return job;
}

async function fileGet(id: string): Promise<ValidationJob> {
  const doc = await fileReadDoc();
  const job = doc.jobs.find((j) => j.id === id);
  if (!job) err("not_found", "Job de validation introuvable.", 404);
  const arts = doc.artifacts
    .filter((a) => a.jobId === id)
    .map((a) => ({ ...a, url: `/api/artifacts/${a.id}/download` }));
  return { ...(job as ValidationJob), artifacts: arts };
}

// ---------- Façade ----------

function checkSnapshot(files: Record<string, string>): Record<string, string> {
  const entries = Object.entries(files);
  if (entries.length === 0) err("invalid_snapshot", "Snapshot vide : rien à valider.");
  if (entries.length > MAX_SNAPSHOT_FILES) {
    err("invalid_snapshot", `Trop de fichiers (${entries.length} > ${MAX_SNAPSHOT_FILES}).`);
  }
  let total = 0;
  for (const [, c] of entries) total += Buffer.byteLength(c, "utf8");
  if (total > MAX_SNAPSHOT_BYTES) err("invalid_snapshot", "Snapshot trop gros (> 8 Mo).");
  return files;
}

export async function createValidationJob(
  projectId: string,
  files: Record<string, string>,
  opts: { versionId?: string | null; versionNo?: number | null; label?: string; g0g3?: unknown } = {}
): Promise<ValidationJob> {
  const clean = checkSnapshot({ ...files });
  if (isPgConfigured()) return pgCreate(projectId, clean, opts);
  return fileCreate(projectId, clean, opts);
}

export async function getValidationJob(id: string): Promise<ValidationJob> {
  if (!/^[A-Za-z0-9-]{1,64}$/.test(id)) err("not_found", "Job de validation introuvable.", 404);
  if (isPgConfigured()) return pgGet(id);
  return fileGet(id);
}

export async function latestValidationJob(projectId: string): Promise<ValidationJob | null> {
  if (isPgConfigured()) return pgLatestForProject(projectId);
  const doc = await fileReadDoc();
  const jobs = doc.jobs.filter((j) => j.projectId === projectId).sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  if (jobs.length === 0) return null;
  return fileGet(jobs[0].id);
}

export async function latestGreenValidationJob(projectId: string): Promise<ValidationJob | null> {
  if (isPgConfigured()) return pgLatestGreen(projectId);
  const doc = await fileReadDoc();
  const jobs = doc.jobs
    .filter((j) => j.projectId === projectId && j.status === "done" && j.g4?.status === "pass" && j.g5?.status === "pass")
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  if (jobs.length === 0) return null;
  return fileGet(jobs[0].id);
}

export function workerAvailableHint(): string {
  return (
    "Worker KiCad non joignable : lancez `docker compose up --build` (service `worker`) " +
    "puis relancez la validation. En dev local sans Docker, les jobs restent `queued` (Docker-only strict, issue #7)."
  );
}

// ---------- Artefacts ----------

export async function createArtifactRecord(
  jobId: string | null,
  projectId: string,
  kind: ArtifactKind,
  filename: string,
  content: Buffer
): Promise<ArtifactMeta> {
  if (!ARTIFACT_KINDS.includes(kind)) err("invalid_kind", `Kind d'artefact invalide : ${kind}.`);
  if (content.length === 0) err("invalid_artifact", "Artefact vide.");
  if (content.length > 50_000_000) err("invalid_artifact", "Artefact trop gros (> 50 Mo).");
  const id = randomUUID();
  await mkdir(artifactsDir(), { recursive: true });
  await writeFile(artifactFilePath(id, filename), content);
  const meta: ArtifactMeta = {
    id,
    jobId,
    projectId,
    kind,
    filename,
    bytes: content.length,
    sha256: sha256Hex(content),
    created_at: new Date().toISOString(),
  };
  if (isPgConfigured()) {
    await initSchema();
    await getPool().query(
      "insert into artifacts(id, job_id, project_id, kind, filename, bytes, sha256) values($1,$2,$3,$4,$5,$6,$7)",
      [id, jobId, projectId, kind, filename, content.length, meta.sha256]
    );
  } else {
    const doc = await fileReadDoc();
    doc.artifacts.push(meta);
    await fileWriteDoc(doc);
  }
  return { ...meta, url: `/api/artifacts/${id}/download` };
}

export async function getArtifactMeta(id: string): Promise<ArtifactMeta> {
  if (!/^[A-Za-z0-9-]{1,64}$/.test(id)) err("not_found", "Artefact introuvable.", 404);
  if (isPgConfigured()) {
    await initSchema();
    const { rows } = await getPool().query("select * from artifacts where id=$1", [id]);
    if (rows.length === 0) err("not_found", "Artefact introuvable.", 404);
    const r = rows[0] as Record<string, unknown>;
    return {
      id: String(r.id),
      jobId: (r.job_id as string | null) ?? null,
      projectId: String(r.project_id),
      kind: r.kind as ArtifactKind,
      filename: String(r.filename),
      bytes: Number(r.bytes),
      sha256: String(r.sha256),
      created_at: new Date(r.created_at as string).toISOString(),
    };
  }
  const doc = await fileReadDoc();
  const a = doc.artifacts.find((x) => x.id === id);
  if (!a) err("not_found", "Artefact introuvable.", 404);
  return a;
}

export async function readArtifactContent(meta: ArtifactMeta): Promise<Buffer> {
  try {
    const buf = await readFile(artifactFilePath(meta.id, meta.filename));
    if (buf.length !== meta.bytes || sha256Hex(buf) !== meta.sha256) {
      err("artifact_corrupt", "Artefact corrompu (empreinte SHA-256 différente).", 500);
    }
    return buf;
  } catch (e) {
    if ((e as { code?: string })?.code === "artifact_corrupt") throw e;
    err("not_found", "Fichier d'artefact manquant sur le volume partagé.", 404);
  }
}

/** Résumé borné d'un job pour l'agent (jamais de JSON ERC/DRC brut). */
export function summarizeJobForAgent(job: ValidationJob): Record<string, unknown> {
  const slice = (v: unknown): unknown => {
    if (v && typeof v === "object" && Array.isArray((v as { findings?: unknown[] }).findings)) {
      const g = v as GateVerdict;
      return { status: g.status, findings: g.findings.slice(0, 20), stats: g.stats };
    }
    return v ?? null;
  };
  const erc = job.erc as { summary?: unknown } | null;
  const drc = job.drc as { summary?: unknown } | null;
  return {
    jobId: job.id,
    status: job.status,
    versionNo: job.versionNo,
    kicadVersion: job.kicadVersion,
    tscircuitVersion: job.tscircuitVersion,
    g4: slice(job.g4),
    g5: slice(job.g5),
    ercSummary: erc?.summary ?? null,
    drcSummary: drc?.summary ?? null,
    error: job.error,
    artifacts: (job.artifacts ?? []).map((a) => ({ kind: a.kind, filename: a.filename, bytes: a.bytes, url: a.url })),
    ...(job.status === "queued" || job.status === "running"
      ? { note: "Job en attente du worker. Relancez getValidationResult plus tard ; n'inventez jamais un verdict." }
      : {}),
  };
}
