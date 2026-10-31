// Persistance projets/versions/messages (issue #3, doc 07).
// - Backend Postgres quand DATABASE_URL est posée (Docker Compose).
// - Sinon backend fichiers JSON locaux (<PROJECTS_DIR>/<id>.json),
//   « version locale acceptable » (doc 01 §3.5, M1-1).
// Mono-utilisateur local : user_id fixe "local", table users préparée
// mais inactive (décision D12, activation en M3).
// Serveur uniquement.
import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { getPool, initSchema, isPgConfigured } from "@/lib/db";
import type { PoolClient } from "@/lib/db";
import { TOY_FSMAP_GOOD } from "@/lib/toy-circuit";

if (typeof window !== "undefined") {
  throw new Error("projects.ts est serveur-uniquement.");
}

export const LOCAL_USER_ID = "local";

export type AssemblyMode = "pcba-jlcpcb" | "pcb-seul" | "autre-fabricant" | "indecis";

export function validateAssemblyMode(input: unknown): AssemblyMode {
  if (input === "pcba-jlcpcb" || input === "pcb-seul" || input === "autre-fabricant" || input === "indecis") return input;
  err("invalid_assembly_mode", "Mode d'assemblage invalide (pcba-jlcpcb | pcb-seul | autre-fabricant | indecis).");
}

export interface ProjectSummary {
  id: string;
  name: string;
  assemblyMode: AssemblyMode;
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

export interface ChatHistoryMsg {
  role: "user" | "agent";
  text: string;
  created_at: string;
  /** Appels d'outils du run (mémoire inter-runs, option validée) : sans eux,
   *  le modèle repart de zéro à chaque question. Bornés à l'écriture. */
  parts?: StoredToolPart[];
}

/** Une partie d'outil persistée : appel + résultat (jamais de JSON brut volumineux). */
export interface StoredToolPart {
  toolName: string;
  toolCallId: string;
  input: unknown;
  output?: unknown;
  error?: string;
  /** Approbation H1/H2/export (mémoire : le modèle sait ce qui fut approuvé et avec quelles modifications). */
  approval?: { id: string; approved: boolean; reason?: string };
}

const MAX_PARTS_PER_MESSAGE = 100;
const MAX_PART_JSON = 50_000;

function validateParts(parts: unknown): StoredToolPart[] | undefined {
  if (parts === undefined) return undefined;
  if (!Array.isArray(parts)) err("invalid_message", "parts doit être un tableau.");
  const list = parts as unknown[];
  if (list.length > MAX_PARTS_PER_MESSAGE) {
    err("invalid_message", `Trop de parties d'outils (max ${MAX_PARTS_PER_MESSAGE}).`);
  }
  const out: StoredToolPart[] = [];
  for (const p of list) {
    const part = p as Record<string, unknown>;
    if (typeof part.toolName !== "string" || typeof part.toolCallId !== "string") {
      err("invalid_message", "Partie d'outil invalide (toolName/toolCallId requis).");
    }
    const clean: StoredToolPart = {
      toolName: (part.toolName as string).slice(0, 80),
      toolCallId: (part.toolCallId as string).slice(0, 80),
      input: part.input ?? null,
    };
    if (part.output !== undefined) clean.output = part.output;
    if (typeof part.error === "string") clean.error = part.error.slice(0, 2000);
    const ap = part.approval as { id?: unknown; approved?: unknown; reason?: unknown } | undefined;
    if (ap && typeof ap.id === "string" && typeof ap.approved === "boolean") {
      clean.approval = {
        id: ap.id.slice(0, 80),
        approved: ap.approved,
        ...(typeof ap.reason === "string" && ap.reason ? { reason: ap.reason.slice(0, 2000) } : {}),
      };
    }
    const size = JSON.stringify(clean).length;
    if (size > MAX_PART_JSON) err("invalid_message", `Partie d'outil trop grosse (${size} > ${MAX_PART_JSON}).`);
    out.push(clean);
  }
  return out;
}

const MAX_FILES = 50;
const MAX_FILE_BYTES = 200_000;
const MAX_NAME = 80;
const MAX_TEXT = 20_000;
const MAX_HISTORY = 300;
const PATH_RE = /^[A-Za-z0-9._/-]{1,120}$/;

function err(code: string, message: string, status = 400): never {
  const e = new Error(message) as Error & { code: string; status: number };
  e.code = code;
  e.status = status;
  throw e;
}

export function validateName(name: unknown): string {
  if (typeof name !== "string" || name.trim().length === 0) err("invalid_name", "Nom de projet vide.");
  const clean = name.trim().slice(0, MAX_NAME);
  if (clean.length === 0) err("invalid_name", "Nom de projet vide.");
  return clean;
}

export function validateFiles(input: unknown): Record<string, string> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    err("invalid_files", "files doit être un objet { chemin: contenu }.");
  }
  const files = input as Record<string, unknown>;
  const entries = Object.entries(files);
  if (entries.length === 0) err("invalid_files", "files vide : un projet a au moins un fichier.");
  if (entries.length > MAX_FILES) err("invalid_files", `Trop de fichiers (max ${MAX_FILES}).`);
  const out: Record<string, string> = {};
  for (const [p, c] of entries) {
    if (!PATH_RE.test(p) || p.includes("..")) err("invalid_files", `Chemin invalide : ${p}.`);
    if (typeof c !== "string") err("invalid_files", `Contenu non texte : ${p}.`);
    if (Buffer.byteLength(c, "utf8") > MAX_FILE_BYTES) {
      err("invalid_files", `Fichier trop gros : ${p} (max ${MAX_FILE_BYTES} o).`);
    }
    out[p] = c;
  }
  return out;
}

export function hashContent(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function projectsDir(): string {
  return process.env.PROJECTS_DIR ?? path.join(process.cwd(), "projects");
}

function filePath(id: string): string {
  if (!/^[A-Za-z0-9-]{1,64}$/.test(id)) err("not_found", "Projet introuvable.", 404);
  return path.join(projectsDir(), `${id}.json`);
}

interface FileProjectDoc {
  id: string;
  user_id: string;
  name: string;
  assemblyMode?: AssemblyMode;
  created_at: string;
  updated_at: string;
  current_version_id: string | null;
  working_files: Record<string, string>;
  versions: Array<{
    id: string;
    version_no: number;
    label: string;
    created_from_run_id: string | null;
    created_at: string;
    files: Record<string, string>;
  }>;
  conversation: ChatHistoryMsg[];
}

async function readDoc(id: string): Promise<FileProjectDoc> {
  try {
    const raw = await fs.readFile(filePath(id), "utf8");
    return JSON.parse(raw) as FileProjectDoc;
  } catch {
    err("not_found", "Projet introuvable.", 404);
  }
}

async function writeDoc(doc: FileProjectDoc): Promise<void> {
  const dir = projectsDir();
  await fs.mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `.${doc.id}.tmp`);
  await fs.writeFile(tmp, JSON.stringify(doc), "utf8");
  await fs.rename(tmp, filePath(doc.id));
}

const now = () => new Date().toISOString();

function toSummaryPg(row: {
  id: string; name: string; assembly_mode?: string | null; created_at: Date | string; updated_at: Date | string;
  current_version_id: string | null; current_version_no: number | null;
}): ProjectSummary {
  return {
    id: row.id,
    name: row.name,
    assemblyMode: (row.assembly_mode as AssemblyMode) ?? "indecis",
    created_at: new Date(row.created_at).toISOString(),
    updated_at: new Date(row.updated_at).toISOString(),
    current_version_id: row.current_version_id,
    current_version_no: row.current_version_no,
  };
}

// ---------- Backend Postgres ----------

async function pgList(): Promise<ProjectSummary[]> {
  await initSchema();
  const { rows } = await getPool().query(
    `select p.id, p.name, p.assembly_mode, p.created_at, p.updated_at, p.current_version_id, v.version_no as current_version_no
     from projects p left join project_versions v on v.id = p.current_version_id
     where p.user_id = $1 order by p.updated_at desc`,
    [LOCAL_USER_ID]
  );
  return rows.map(toSummaryPg);
}

async function pgCreate(name: string, seed?: Record<string, string>): Promise<ProjectSummary> {
  await initSchema();
  const id = randomUUID();
  const t = now();
  const seedFiles = seed ?? { ...TOY_FSMAP_GOOD };
  const client = await getPool().connect();
  const versionId = randomUUID();
  try {
    await client.query("begin");
    await client.query(
      "insert into projects(id, user_id, name, working_files) values($1,$2,$3,$4)",
      [id, LOCAL_USER_ID, name, JSON.stringify(seedFiles)]
    );
    await client.query(
      "insert into project_versions(id, project_id, version_no, label) values($1,$2,1,'création')",
      [versionId, id]
    );
    for (const [p, c] of Object.entries(seedFiles)) {
      await client.query(
        "insert into project_files(version_id, path, content, content_hash) values($1,$2,$3,$4)",
        [versionId, p, c, hashContent(c)]
      );
    }
    await client.query("update projects set current_version_id=$1, updated_at=$2 where id=$3", [
      versionId, t, id,
    ]);
    await client.query("insert into conversations(id, project_id) values($1,$2)", [randomUUID(), id]);
    await client.query("commit");
  } catch (e) {
    await client.query("rollback");
    throw e;
  } finally {
    client.release();
  }
  return { id, name, assemblyMode: "indecis", created_at: t, updated_at: t, current_version_id: versionId, current_version_no: 1 };
}

async function pgGet(id: string): Promise<ProjectSummary> {
  await initSchema();
  const { rows } = await getPool().query(
    `select p.id, p.name, p.assembly_mode, p.created_at, p.updated_at, p.current_version_id, v.version_no as current_version_no
     from projects p left join project_versions v on v.id = p.current_version_id
     where p.id=$1 and p.user_id=$2`,
    [id, LOCAL_USER_ID]
  );
  if (rows.length === 0) err("not_found", "Projet introuvable.", 404);
  return toSummaryPg(rows[0]);
}

async function pgRename(id: string, name: string): Promise<ProjectSummary> {
  await initSchema();
  const { rowCount } = await getPool().query(
    "update projects set name=$1, updated_at=now() where id=$2 and user_id=$3",
    [name, id, LOCAL_USER_ID]
  );
  if (rowCount === 0) err("not_found", "Projet introuvable.", 404);
  return pgGet(id);
}

async function pgDelete(id: string): Promise<void> {
  await initSchema();
  const { rowCount } = await getPool().query("delete from projects where id=$1 and user_id=$2", [
    id, LOCAL_USER_ID,
  ]);
  if (rowCount === 0) err("not_found", "Projet introuvable.", 404);
}

async function pgGetFiles(id: string): Promise<Record<string, string>> {
  await initSchema();
  const { rows } = await getPool().query(
    "select working_files from projects where id=$1 and user_id=$2", [id, LOCAL_USER_ID]
  );
  if (rows.length === 0) err("not_found", "Projet introuvable.", 404);
  return (rows[0].working_files ?? {}) as Record<string, string>;
}

async function pgPutFiles(id: string, files: Record<string, string>): Promise<void> {
  await initSchema();
  const { rowCount } = await getPool().query(
    "update projects set working_files=$1, updated_at=now() where id=$2 and user_id=$3",
    [JSON.stringify(files), id, LOCAL_USER_ID]
  );
  if (rowCount === 0) err("not_found", "Projet introuvable.", 404);
}

async function pgVersions(id: string): Promise<VersionSummary[]> {
  await initSchema();
  await pgGet(id);
  const { rows } = await getPool().query(
    `select v.id, v.version_no, v.label, v.created_at, count(f.path)::int as file_count
     from project_versions v left join project_files f on f.version_id = v.id
     where v.project_id=$1 group by v.id order by v.version_no desc`,
    [id]
  );
  return rows.map((r) => ({
    id: r.id as string,
    version_no: r.version_no as number,
    label: r.label as string,
    created_at: new Date(r.created_at).toISOString(),
    file_count: r.file_count as number,
  }));
}

async function snapshot(
  client: PoolClient,
  projectId: string,
  files: Record<string, string>,
  label: string
): Promise<{ versionId: string; versionNo: number }> {
  const next = await client.query("select coalesce(max(version_no),0)+1 as version_no from project_versions where project_id=$1", [
    projectId,
  ]);
  const versionNo = (next.rows[0] as unknown as { version_no: number }).version_no;
  const versionId = randomUUID();
  await client.query(
    "insert into project_versions(id, project_id, version_no, label) values($1,$2,$3,$4)",
    [versionId, projectId, versionNo, label]
  );
  for (const [p, c] of Object.entries(files)) {
    await client.query(
      "insert into project_files(version_id, path, content, content_hash) values($1,$2,$3,$4)",
      [versionId, p, c, hashContent(c)]
    );
  }
  await client.query(
    "update projects set current_version_id=$1, updated_at=now() where id=$2",
    [versionId, projectId]
  );
  return { versionId, versionNo };
}

async function pgCreateVersion(id: string, label?: string): Promise<VersionSummary> {
  await initSchema();
  const files = await pgGetFiles(id);
  const client = await getPool().connect();
  try {
    await client.query("begin");
    const { versionId, versionNo } = await snapshot(
      client, id, files, label?.slice(0, 120) || `v${Date.now()}`
    );
    await client.query("commit");
    void versionId;
    const list = await pgVersions(id);
    return list.find((v) => v.version_no === versionNo)!;
  } catch (e) {
    await client.query("rollback");
    throw e;
  } finally {
    client.release();
  }
}

async function pgRestore(id: string, versionId: string, label?: string): Promise<VersionSummary> {
  await initSchema();
  await pgGet(id);
  const { rows } = await getPool().query(
    "select path, content from project_files where version_id=$1 and exists(select 1 from project_versions where id=$1 and project_id=$2)",
    [versionId, id]
  );
  if (rows.length === 0) err("not_found", "Version introuvable.", 404);
  const files: Record<string, string> = {};
  for (const r of rows) files[r.path as string] = r.content as string;
  const client = await getPool().connect();
  try {
    await client.query("begin");
    // Copie de travail + snapshot dans la même transaction : jamais d'état
    // intermédiaire (working modifié sans nouvelle version).
    await client.query("update projects set working_files=$1, updated_at=now() where id=$2", [
      JSON.stringify(files), id,
    ]);
    const src = await client.query("select version_no from project_versions where id=$1", [versionId]);
    const srcNo = (src.rows[0] as unknown as { version_no: number }).version_no;
    const { versionNo } = await snapshot(
      client, id, files, label?.slice(0, 120) || `restauration depuis v${srcNo}`
    );
    await client.query("commit");
    const list = await pgVersions(id);
    return list.find((v) => v.version_no === versionNo)!;
  } catch (e) {
    await client.query("rollback");
    throw e;
  } finally {
    client.release();
  }
}

async function pgConvId(projectId: string): Promise<string> {
  const { rows } = await getPool().query("select id from conversations where project_id=$1 limit 1", [
    projectId,
  ]);
  if (rows.length > 0) return rows[0].id as string;
  const cid = randomUUID();
  await getPool().query("insert into conversations(id, project_id) values($1,$2)", [cid, projectId]);
  return cid;
}

async function pgMessages(id: string): Promise<ChatHistoryMsg[]> {
  await initSchema();
  await pgGet(id);
  const cid = await pgConvId(id);
  const { rows } = await getPool().query(
    "select role, ui_message_json, created_at from messages where conversation_id=$1 order by created_at asc, id asc limit $2",
    [cid, MAX_HISTORY]
  );
  return rows.map((r) => {
    const payload = (r.ui_message_json ?? {}) as { text?: unknown; parts?: unknown };
    const msg: ChatHistoryMsg = {
      role: r.role as "user" | "agent",
      text: String(payload.text ?? ""),
      created_at: new Date(r.created_at).toISOString(),
    };
    if (Array.isArray(payload.parts)) msg.parts = payload.parts as StoredToolPart[];
    return msg;
  });
}

async function pgAppendMessages(id: string, msgs: Array<{ role: string; text: string; parts?: unknown }>): Promise<void> {
  await initSchema();
  await pgGet(id);
  const cid = await pgConvId(id);
  for (const m of msgs) {
    if (m.role !== "user" && m.role !== "agent") err("invalid_message", "role doit être user|agent.");
    if (typeof m.text !== "string" || m.text.length === 0 || m.text.length > MAX_TEXT) {
      err("invalid_message", "text vide ou trop long (max 20000).");
    }
    const parts = validateParts(m.parts);
    await getPool().query("insert into messages(id, conversation_id, role, ui_message_json) values($1,$2,$3,$4)", [
      randomUUID(), cid, m.role, JSON.stringify(parts ? { text: m.text, parts } : { text: m.text }),
    ]);
  }
}

// ---------- Backend fichiers locaux ----------

function docSummary(doc: FileProjectDoc): ProjectSummary {
  const cur = doc.versions.find((v) => v.id === doc.current_version_id);
  return {
    id: doc.id,
    name: doc.name,
    assemblyMode: doc.assemblyMode ?? "indecis",
    created_at: doc.created_at,
    updated_at: doc.updated_at,
    current_version_id: doc.current_version_id,
    current_version_no: cur?.version_no ?? null,
  };
}

async function fileList(): Promise<ProjectSummary[]> {
  await fs.mkdir(projectsDir(), { recursive: true });
  const entries = await fs.readdir(projectsDir());
  const docs: FileProjectDoc[] = [];
  for (const e of entries) {
    if (!e.endsWith(".json") || e.startsWith(".")) continue;
    try {
      const raw = await fs.readFile(path.join(projectsDir(), e), "utf8");
      docs.push(JSON.parse(raw) as FileProjectDoc);
    } catch {
      // Fichier étranger ou corrompu : ignoré (jamais de crash de liste).
    }
  }
  return docs
    .sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1))
    .map(docSummary);
}

async function fileCreate(name: string, seed?: Record<string, string>): Promise<ProjectSummary> {
  const t = now();
  const versionId = randomUUID();
  const seedFiles = seed ?? { ...TOY_FSMAP_GOOD };
  const doc: FileProjectDoc = {
    id: randomUUID(),
    user_id: LOCAL_USER_ID,
    name,
    assemblyMode: "indecis",
    created_at: t,
    updated_at: t,
    current_version_id: versionId,
    working_files: { ...seedFiles },
    versions: [
      {
        id: versionId,
        version_no: 1,
        label: "création",
        created_from_run_id: null,
        created_at: t,
        files: { ...seedFiles },
      },
    ],
    conversation: [],
  };
  await writeDoc(doc);
  return docSummary(doc);
}

async function fileSnapshot(doc: FileProjectDoc, label: string): Promise<VersionSummary> {
  const versionNo = doc.versions.reduce((m, v) => Math.max(m, v.version_no), 0) + 1;
  const v = {
    id: randomUUID(),
    version_no: versionNo,
    label: label.slice(0, 120),
    created_from_run_id: null as string | null,
    created_at: now(),
    files: { ...doc.working_files },
  };
  doc.versions.push(v);
  doc.current_version_id = v.id;
  doc.updated_at = now();
  await writeDoc(doc);
  return {
    id: v.id,
    version_no: v.version_no,
    label: v.label,
    created_at: v.created_at,
    file_count: Object.keys(v.files).length,
  };
}

// ---------- Façade (sélection du backend) ----------

export function storageBackend(): "postgres" | "fichiers" {
  return isPgConfigured() ? "postgres" : "fichiers";
}

export async function listProjects(): Promise<ProjectSummary[]> {
  return storageBackend() === "postgres" ? pgList() : fileList();
}

export async function createProject(name: string, seed?: Record<string, string>): Promise<ProjectSummary> {
  const clean = validateName(name);
  if (seed !== undefined) validateFiles(seed);
  return storageBackend() === "postgres" ? pgCreate(clean, seed) : fileCreate(clean, seed);
}

export async function getProject(id: string): Promise<ProjectSummary> {
  if (storageBackend() === "postgres") return pgGet(id);
  return docSummary(await readDoc(id));
}

export async function renameProject(id: string, name: string): Promise<ProjectSummary> {
  const clean = validateName(name);
  if (storageBackend() === "postgres") return pgRename(id, clean);
  const doc = await readDoc(id);
  doc.name = clean;
  doc.updated_at = now();
  await writeDoc(doc);
  return docSummary(doc);
}

export async function deleteProject(id: string): Promise<void> {
  if (storageBackend() === "postgres") return pgDelete(id);
  await readDoc(id);
  await fs.unlink(filePath(id));
}

export async function getWorkingFiles(id: string): Promise<Record<string, string>> {
  if (storageBackend() === "postgres") return pgGetFiles(id);
  return { ...(await readDoc(id)).working_files };
}

export async function putWorkingFiles(id: string, files: Record<string, string>): Promise<void> {
  const clean = validateFiles(files);
  if (storageBackend() === "postgres") return pgPutFiles(id, clean);
  const doc = await readDoc(id);
  doc.working_files = clean;
  doc.updated_at = now();
  await writeDoc(doc);
}

export async function listVersions(id: string): Promise<VersionSummary[]> {
  if (storageBackend() === "postgres") return pgVersions(id);
  const doc = await readDoc(id);
  return [...doc.versions]
    .sort((a, b) => b.version_no - a.version_no)
    .map((v) => ({
      id: v.id,
      version_no: v.version_no,
      label: v.label,
      created_at: v.created_at,
      file_count: Object.keys(v.files).length,
    }));
}

/** Fichiers figés d'une version (snapshot immuable, M2 : entrée du worker). */
export async function getVersionFiles(id: string, versionId: string): Promise<{ versionNo: number; files: Record<string, string> }> {
  if (storageBackend() === "postgres") {
    await initSchema();
    await pgGet(id);
    const { rows } = await getPool().query(
      "select path, content from project_files where version_id=$1 and exists(select 1 from project_versions where id=$1 and project_id=$2)",
      [versionId, id]
    );
    if (rows.length === 0) err("not_found", "Version introuvable.", 404);
    const files: Record<string, string> = {};
    for (const r of rows) files[r.path as string] = r.content as string;
    const vno = await getPool().query("select version_no from project_versions where id=$1", [versionId]);
    const versionNo = (vno.rows[0] as unknown as { version_no: number } | undefined)?.version_no ?? 0;
    return { versionNo, files };
  }
  const doc = await readDoc(id);
  const src = doc.versions.find((v) => v.id === versionId);
  if (!src) err("not_found", "Version introuvable.", 404);
  return { versionNo: src.version_no, files: { ...src.files } };
}

export async function createVersion(id: string, label?: string): Promise<VersionSummary> {
  const cleanLabel =
    typeof label === "string" && label.trim().length > 0 ? label.trim() : `v${Date.now()}`;
  if (storageBackend() === "postgres") return pgCreateVersion(id, cleanLabel);
  const doc = await readDoc(id);
  return fileSnapshot(doc, cleanLabel);
}

export async function restoreVersion(
  id: string,
  versionId: string,
  label?: string
): Promise<VersionSummary> {
  if (storageBackend() === "postgres") return pgRestore(id, versionId, label);
  const doc = await readDoc(id);
  const src = doc.versions.find((v) => v.id === versionId);
  if (!src) err("not_found", "Version introuvable.", 404);
  doc.working_files = { ...src.files };
  const cleanLabel =
    typeof label === "string" && label.trim().length > 0
      ? label.trim()
      : `restauration depuis v${src.version_no}`;
  return fileSnapshot(doc, cleanLabel);
}

export async function getMessages(id: string): Promise<ChatHistoryMsg[]> {
  if (storageBackend() === "postgres") return pgMessages(id);
  return (await readDoc(id)).conversation.slice(-MAX_HISTORY);
}

export async function appendMessages(
  id: string,
  msgs: Array<{ role: string; text: string; parts?: unknown }>
): Promise<void> {
  for (const m of msgs) {
    if (m.role !== "user" && m.role !== "agent") err("invalid_message", "role doit être user|agent.");
    if (typeof m.text !== "string" || m.text.length === 0 || m.text.length > MAX_TEXT) {
      err("invalid_message", "text vide ou trop long (max 20000).");
    }
    validateParts(m.parts);
  }
  if (storageBackend() === "postgres") return pgAppendMessages(id, msgs);
  const doc = await readDoc(id);
  for (const m of msgs) {
    const parts = validateParts(m.parts);
    doc.conversation.push({
      role: m.role as "user" | "agent",
      text: m.text,
      created_at: now(),
      ...(parts ? { parts } : {}),
    });
  }
  doc.conversation = doc.conversation.slice(-MAX_HISTORY);
  doc.updated_at = now();
  await writeDoc(doc);
}

/** Erreur JSON structurée doc 07 : { error: { code, message } }. */
export function toApiError(e: unknown): Response {
  const code = (e as { code?: string })?.code ?? "internal";
  const status = (e as { status?: number })?.status ?? 500;
  const message = e instanceof Error ? e.message : "Erreur interne.";
  return Response.json({ error: { code, message } }, { status });
}

/** Lit un corps JSON sans dupliquer le try/catch dans chaque route. */
export async function readJsonBody<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    err("invalid_json", "Corps JSON invalide.");
  }
}

export async function getAssemblyMode(id: string): Promise<AssemblyMode> {
  if (storageBackend() === "postgres") {
    await initSchema();
    const { rows } = await getPool().query("select assembly_mode from projects where id=$1", [id]);
    if (rows.length === 0) err("not_found", "Projet introuvable.", 404);
    const m = (rows[0] as { assembly_mode?: unknown }).assembly_mode;
    return m === "pcba-jlcpcb" || m === "pcb-seul" || m === "autre-fabricant" ? (m as AssemblyMode) : "indecis";
  }
  const doc = await readDoc(id);
  return doc.assemblyMode ?? "indecis";
}

export async function setAssemblyMode(id: string, mode: AssemblyMode): Promise<ProjectSummary> {
  const clean = validateAssemblyMode(mode);
  if (storageBackend() === "postgres") {
    await initSchema();
    const { rowCount } = await getPool().query("update projects set assembly_mode=$1, updated_at=now() where id=$2", [clean, id]);
    if (rowCount === 0) err("not_found", "Projet introuvable.", 404);
    return pgGet(id);
  }
  const doc = await readDoc(id);
  doc.assemblyMode = clean;
  doc.updated_at = now();
  await writeDoc(doc);
  return docSummary(doc);
}
