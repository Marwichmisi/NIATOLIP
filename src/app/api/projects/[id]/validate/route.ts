// POST /api/projects/:id/validate — crée un job worker KiCad (G4/G5).
// P0-3 (issue #14) : le `g0g3` déclaré par l'appelant est IGNORÉ. Le serveur
// réévalue le snapshot (G0–G3 natifs) et ne crée NI version NI job si rouge
// (409 gates_not_green). Sans versionId : snapshot de la copie de travail
// dans une nouvelle version (doc 07 §2 : l'export référence un version_id).
// Le job fige les fichiers de la VERSION (relus après createVersion), jamais
// la copie de travail évaluée — version figée et snapshot évalué coïncident.
// Réponse : { jobId, status: "queued", versionNo }. Le worker (docker compose
// service `worker`) réclame le job ; sans worker, il reste `queued`.
export const dynamic = "force-dynamic";
export const maxDuration = 300; // réévaluation serveur 20–150 s + marge

import { createVersion, getProject, getVersionFiles, getWorkingFiles, readJsonBody, toApiError } from "@/lib/projects";
import { createValidationJob } from "@/lib/validation";
import { assertSequenceForValidation } from "@/lib/sequence";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    await getProject(id);
    let body: { versionId?: unknown; label?: unknown } = {};
    try {
      body = await readJsonBody<typeof body>(req);
    } catch {
      body = {};
    }
    // P0-3 : aucun champ g0g3 lu — tout appel mensonger est inopérant.
    const label = typeof body.label === "string" ? body.label.slice(0, 120) : "validation KiCad";
    if (typeof body.versionId === "string" && body.versionId.length > 0) {
      const v = await getVersionFiles(id, body.versionId);
      // Recalcul serveur AVANT tout job : rouge → 409, rien créé.
      const snapshot = await assertSequenceForValidation(v.files);
      const job = await createValidationJob(id, v.files, { versionId: body.versionId, versionNo: v.versionNo, label, g0g3: snapshot });
      return Response.json({ jobId: job.id, status: job.status, versionNo: v.versionNo }, { status: 201 });
    }
    const working = await getWorkingFiles(id);
    // Recalcul serveur AVANT figement : rouge → 409, ni version ni job.
    const snapshot = await assertSequenceForValidation(working);
    // Snapshot fige la version validée (doc 07 §2 : l'export référence un version_id).
    const created = await createVersion(id, label);
    // Le job fige les fichiers de la version, pas la copie de travail.
    const { files, versionNo } = await getVersionFiles(id, created.id);
    const job = await createValidationJob(id, files, { versionId: created.id, versionNo, label, g0g3: snapshot });
    const sourcingWarning = snapshot.sourcing.untraced.length > 0 ? snapshot.sourcing.verdict : undefined;
    return Response.json(
      { jobId: job.id, status: job.status, versionNo, ...(sourcingWarning ? { sourcingWarning } : {}) },
      { status: 201 }
    );
  } catch (e) {
    return toApiError(e);
  }
}
