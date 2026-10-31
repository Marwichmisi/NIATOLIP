// Approbations H1/H2 — vérité serveur (P0-3, issue #14).
// Le flux agent utilise AI SDK `toolApproval: user-approval` : `execute` ne
// tourne que sur approbation explicite, donc l'enregistrement dans l'outil
// (requestFinalApproval / requestPlanApproval) est déjà une preuve serveur.
// Cette table la rend vérifiable par les routes d'export sans faire confiance
// à l'historique UIMessage client (spoofable via POST /messages au prototype
// mono-user). Écriture unique : l'outil agent. La route POST /approvals
// n'existe que pour les flows manuels/tests.
// Serveur uniquement.
if (typeof window !== "undefined") {
  throw new Error("src/lib/approvals.ts est serveur uniquement.");
}

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getPool, initSchema, isPgConfigured } from "@/lib/db";

export type ApprovalGate = "H1" | "H2";

export interface ApprovalRecord {
  id: string;
  projectId: string;
  gate: ApprovalGate;
  approved: boolean;
  jobId: string | null;
  reason: string | null;
  created_at: string;
}

export interface RecordApprovalInput {
  gate: ApprovalGate;
  approved: boolean;
  jobId?: string | null;
  reason?: string | null;
}

function err(code: string, message: string, status = 400): never {
  const e = new Error(message) as Error & { code: string; status: number };
  e.code = code;
  e.status = status;
  throw e;
}

function approvalsCachePath(): string {
  const base = process.env.PROJECTS_DIR ?? join(process.cwd(), "projects");
  return join(base, ".cache", "approvals.json");
}

interface FileApprovalsDoc {
  approvals: ApprovalRecord[];
}

async function fileReadDoc(): Promise<FileApprovalsDoc> {
  try {
    const raw = await readFile(approvalsCachePath(), "utf8");
    const parsed = JSON.parse(raw) as FileApprovalsDoc;
    if (!Array.isArray(parsed.approvals)) return { approvals: [] };
    return parsed;
  } catch {
    return { approvals: [] };
  }
}

async function fileWriteDoc(doc: FileApprovalsDoc): Promise<void> {
  const p = approvalsCachePath();
  await mkdir(join(p, ".."), { recursive: true });
  const tmp = `${p}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(doc), "utf8");
  await rename(tmp, p);
}

// Sérialise les read-modify-write du backend fichiers (même process).
// tmp+rename protège le lecteur, pas deux écrivains concurrents (doc 15 §6.2).
let fileQueue: Promise<void> = Promise.resolve();

function fileMutex<T>(fn: () => Promise<T>): Promise<T> {
  const run = fileQueue.then(fn, fn);
  fileQueue = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

function toRecord(row: Record<string, unknown>): ApprovalRecord {
  return {
    id: String(row.id),
    projectId: String(row.project_id ?? row.projectId),
    gate: row.gate as ApprovalGate,
    approved: Boolean(row.approved),
    jobId: (row.job_id as string | null) ?? (row.jobId as string | null) ?? null,
    reason: (row.reason as string | null) ?? null,
    created_at: new Date(row.created_at as string).toISOString(),
  };
}

function validateInput(input: RecordApprovalInput): void {
  if (input.gate !== "H1" && input.gate !== "H2") {
    err("invalid_gate", "Gate invalide (H1 | H2).");
  }
  if (typeof input.approved !== "boolean") err("invalid_approval", "approved doit être un booléen.");
  if (input.jobId !== undefined && input.jobId !== null) {
    if (typeof input.jobId !== "string" || input.jobId.length === 0 || input.jobId.length > 64) {
      err("invalid_job", "jobId invalide.");
    }
  }
  if (input.reason !== undefined && input.reason !== null && typeof input.reason !== "string") {
    err("invalid_reason", "reason doit être un texte.");
  }
}

/** Enregistre une décision de gate (clic Approuver/Refuser). */
export async function recordApproval(
  projectId: string,
  input: RecordApprovalInput
): Promise<ApprovalRecord> {
  if (!/^[A-Za-z0-9-]{1,64}$/.test(projectId)) err("not_found", "Projet introuvable.", 404);
  validateInput(input);
  const rec: ApprovalRecord = {
    id: randomUUID(),
    projectId,
    gate: input.gate,
    approved: input.approved,
    jobId: input.jobId ?? null,
    reason: typeof input.reason === "string" ? input.reason.slice(0, 2000) : null,
    created_at: new Date().toISOString(),
  };
  if (isPgConfigured()) {
    await initSchema();
    await getPool().query(
      "insert into approvals(id, project_id, gate, approved, job_id, reason) values($1,$2,$3,$4,$5,$6)",
      [rec.id, rec.projectId, rec.gate, rec.approved, rec.jobId, rec.reason]
    );
    return rec;
  }
  return fileMutex(async () => {
    const doc = await fileReadDoc();
    doc.approvals.push(rec);
    await fileWriteDoc(doc);
    return rec;
  });
}

/** Historique des décisions d'un projet (plus récent d'abord, borné). */
export async function listApprovals(projectId: string): Promise<ApprovalRecord[]> {
  if (!/^[A-Za-z0-9-]{1,64}$/.test(projectId)) err("not_found", "Projet introuvable.", 404);
  if (isPgConfigured()) {
    await initSchema();
    const { rows } = await getPool().query(
      "select * from approvals where project_id=$1 order by created_at desc limit 100",
      [projectId]
    );
    return (rows as Record<string, unknown>[]).map(toRecord);
  }
  const doc = await fileReadDoc();
  return doc.approvals
    .filter((a) => a.projectId === projectId)
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
    .slice(0, 100);
}

/**
 * H2 valide pour un job d'export : une approbation H2 `approved:true`
 * postérieure à `job.finished_at`. Si l'approbation porte un jobId, il doit
 * correspondre au job exporté (lie la revue au rapport ERC/DRC exact) ; sinon
 * l'horodatage suffit (revue postérieure au rapport).
 */
export async function hasValidH2(
  projectId: string,
  job: { id: string; finished_at: string | null }
): Promise<{ ok: boolean; approval: ApprovalRecord | null }> {
  if (!job.finished_at) return { ok: false, approval: null };
  const doneAt = Date.parse(job.finished_at);
  if (!Number.isFinite(doneAt)) return { ok: false, approval: null };
  const all = await listApprovals(projectId);
  for (const a of all) {
    if (a.gate !== "H2" || !a.approved) continue;
    if (a.jobId !== null && a.jobId !== job.id) continue;
    const at = Date.parse(a.created_at);
    if (!Number.isFinite(at) || at < doneAt) continue;
    return { ok: true, approval: a };
  }
  return { ok: false, approval: null };
}
