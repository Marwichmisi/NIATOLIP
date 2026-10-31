// GET /api/artifacts/:id/download — téléchargement d'un artefact du pack.
// P0-3 (issue #14) : les artefacts de fabrication (gerber/bom/pnp/kicad)
// d'un job non vert sont refusés (409 gates_not_green) — ils ne doivent
// jamais circuler sous étiquette « validé ». `sources.zip` et le rapport
// restent téléchargeables (debug) quel que soit le verdict.
// Mono-utilisateur local (pas d'auth au prototype, décision D12) ; le contrôle
// d'appartenance arrivera avec l'auth (M3).
export const dynamic = "force-dynamic";

import { toApiError } from "@/lib/projects";
import { getArtifactMeta, getValidationJob, isJobGreenForExport, readArtifactContent } from "@/lib/validation";

const MIME: Record<string, string> = {
  ".zip": "application/zip",
  ".csv": "text/csv; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
};

// Seuls les livrables du pack « validé » sont gardés (P0-3).
const GUARDED_KINDS = new Set(["gerber", "bom", "pnp", "kicad"]);

function mimeOf(filename: string): string {
  const dot = filename.lastIndexOf(".");
  const ext = dot >= 0 ? filename.slice(dot).toLowerCase() : "";
  return MIME[ext] ?? "application/octet-stream";
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const meta = await getArtifactMeta(id);
    if (meta.jobId && GUARDED_KINDS.has(meta.kind)) {
      let green = false;
      try {
        const job = await getValidationJob(meta.jobId);
        green = isJobGreenForExport(job);
      } catch {
        green = false;
      }
      if (!green) {
        return Response.json(
          {
            error: {
              code: "gates_not_green",
              message:
                "Artefact non téléchargeable sous étiquette « validé » : le job n'est pas vert G4+G5-PCB (corrigez puis relancez, ou téléchargez sources.zip / validation-report.md pour le debug).",
            },
          },
          { status: 409 }
        );
      }
    }
    const buf = await readArtifactContent(meta);
    return new Response(new Uint8Array(buf), {
      headers: {
        "Content-Type": mimeOf(meta.filename),
        "Content-Disposition": `attachment; filename="${meta.filename.replace(/"/g, "")}"`,
        "X-Checksum-Sha256": meta.sha256,
      },
    });
  } catch (e) {
    return toApiError(e);
  }
}
