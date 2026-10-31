// /api/projects/:id/export — téléchargements.
// GET : archive M1 des sources (copie de travail, NON VALIDÉE — doc 05 §1 :
// l'utilisateur peut télécharger un projet non validé à tout moment, mais le
// pack « validé » exige G4 + G5-PCB verts + H2 ; G5-PCBA souple = warnings).
// POST { jobId? } : index du pack fabrication validé (G4+G5-PCB verts exigés).
// Sans jobId : dernier job vert du projet. 409 + code explicite sinon.
export const dynamic = "force-dynamic";

import JSZip from "jszip";
import { getAssemblyMode, getProject, getWorkingFiles, toApiError } from "@/lib/projects";
import { getValidationJob, isJobGreenForExport, latestGreenValidationJob } from "@/lib/validation";
import { hasValidH2 } from "@/lib/approvals";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const project = await getProject(id);
    const files = await getWorkingFiles(id);
    const zip = new JSZip();
    for (const [p, c] of Object.entries(files)) {
      if (p.startsWith(".")) continue; // fichiers réservés hors livrable
      zip.file(p, c);
    }
    zip.file(
      "LISEZMOI.txt",
      [
        `NIATOLIP — archive SOURCES (non validée) — projet "${project.name}"`,
        `Exporté le ${new Date().toISOString()}`,
        "",
        "Ceci est la copie de travail brute, SANS gate KiCad (G4/G5).",
        "Le pack fabrication « validé » (Gerber/BOM/PnP + validation-report.md)",
        "exige G0–G5 verts + revue H2 : voir POST /api/projects/:id/export avec jobId.",
      ].join("\n")
    );
    const buf = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
    return new Response(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="niatolip-sources-${id.slice(0, 8)}.zip"`,
      },
    });
  } catch (e) {
    return toApiError(e);
  }
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    await getProject(id);
    let body: { jobId?: unknown } = {};
    try {
      body = (await req.json()) as typeof body;
    } catch {
      body = {};
    }
    const job =
      typeof body.jobId === "string" && body.jobId.length > 0
        ? await getValidationJob(body.jobId)
        : await latestGreenValidationJob(id);
    if (!job) {
      return Response.json(
        {
          error: {
            code: "no_green_job",
            message:
              "Aucun job G4/G5-PCB vert pour ce projet. Lancez requestManufacturingValidation puis corrigez jusqu'au vert.",
          },
        },
        { status: 409 }
      );
    }
    if (job.projectId !== id) {
      return Response.json({ error: { code: "wrong_project", message: "Ce job appartient à un autre projet." } }, { status: 409 });
    }
    const g5pcb = job.g5_pcb ?? job.g5;
    const g5pcba = job.g5_pcba ?? job.g5;
    // R2 : le mode d'assemblage est lu et surfacé (enforcement complet en #20 :
    // en mode pcba-jlcpcb, des erreurs G5-PCBA devraient bloquer sauf dérogation).
    const assemblyMode = await getAssemblyMode(id);
    if (!isJobGreenForExport(job)) {
      const detail =
        job.status !== "done"
          ? `job ${job.status} (worker en cours ou en attente — relancez getValidationResult)`
          : `gates non vertes (G4:${job.g4?.status ?? "?"} G5-PCB:${g5pcb?.status ?? "?"} G5-PCBA:${g5pcba?.status ?? "?"}) — corrigez puis relancez`;
      return Response.json({ error: { code: "gates_not_green", message: `Pack validé refusé : ${detail}.` } }, { status: 409 });
    }
    // P0-3 : export « validé » conditionné à H2 effectivement approuvée
    // (état serveur, jamais un paramètre auto-déclaré).
    const h2 = await hasValidH2(id, { id: job.id, finished_at: job.finished_at });
    if (!h2.ok) {
      return Response.json(
        {
          error: {
            code: "h2_missing",
            message:
              "Pack validé refusé : H2 non approuvée pour ce job. Présentez la revue (requestFinalApproval avec jobId) puis faites approuver avant l'export.",
          },
        },
        { status: 409 }
      );
    }
    const pcbaWarnings = (g5pcba?.findings ?? []).filter((f) => f.severity === "warning").slice(0, 10).map((f) => `${f.code}: ${f.message}`);
    return Response.json({
      jobId: job.id,
      versionNo: job.versionNo,
      kicadVersion: job.kicadVersion,
      tscircuitVersion: job.tscircuitVersion,
      assemblyMode,
      g5_pcb: g5pcb?.status ?? null,
      g5_pcba: g5pcba?.status ?? null,
      pcbaWarnings,
      note: pcbaWarnings.length > 0 ? "G5-PCBA vert avec avertissements (à vos risques) : voir validation-report.md avant commande." : undefined,
      downloads: (job.artifacts ?? []).map((a) => ({ kind: a.kind, filename: a.filename, bytes: a.bytes, url: a.url })),
    });
  } catch (e) {
    return toApiError(e);
  }
}
