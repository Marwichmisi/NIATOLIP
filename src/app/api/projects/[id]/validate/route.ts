// POST /api/projects/:id/validate — crée un job worker KiCad (G4/G5).
// P0-3 (issue #14) : le `g0g3` déclaré par l'appelant est IGNORÉ. Le serveur
// réévalue le snapshot (G0–G3 natifs) et ne crée NI version NI job si rouge
// (409 gates_not_green). Sans versionId : snapshot de la copie de travail
// dans une nouvelle version (doc 07 §2 : l'export référence un version_id).
// Réponse : { jobId, status: "queued", versionNo }. Le worker (docker compose
// service `worker`) réclame le job ; sans worker, il reste `queued`.
export const dynamic = "force-dynamic";
export const maxDuration = 300; // réévaluation serveur 20–150 s + marge

import { getProject, getVersionFiles, getWorkingFiles, toApiError } from "@/lib/projects";
import { createValidationJob } from "@/lib/validation";
import { assertSequenceForValidation } from "@/lib/sequence";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    await getProject(id);
    let body: { versionId?: unknown; label?: unknown } = {};
    try {
      body = (await req.json()) as typeof body;
    } catch {
      body = {};
    }
    // P0-3 : aucun champ g0g3 lu — tout appel mensonger est inopérant.
    const label = typeof body.label === "string" ? body.label.slice(0, 120) : "validation KiCad";
    let files: Record<string, string>;
    let versionId: string | null = null;
    let versionNo: number | null = null;
    if (typeof body.versionId === "string" && body.versionId.length > 0) {
      const v = await getVersionFiles(id, body.versionId);
      files = v.files;
      versionId = body.versionId;
      versionNo = v.versionNo;
    } else {
      files = await getWorkingFiles(id);
    }
    // Recalcul serveur AVANT tout figement : rouge → 409, rien créé.
    const snapshot = await assertSequenceForValidation(files);
    if (typeof body.versionId !== "string" || body.versionId.length === 0) {
      // Snapshot fige la version validée (doc 07 §2 : l'export référence un version_id).
      const { createVersion } = await import("@/lib/projects");
      const v = await createVersion(id, label);
      versionId = v.id;
      versionNo = v.version_no;
      files = await getWorkingFiles(id);
    }
    const job = await createValidationJob(id, files, { versionId, versionNo, label, g0g3: snapshot });
    return Response.json({ jobId: job.id, status: job.status, versionNo }, { status: 201 });
  } catch (e) {
    return toApiError(e);
  }
}
