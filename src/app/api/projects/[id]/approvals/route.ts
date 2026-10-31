// /api/projects/:id/approvals — vérité serveur des gates humaines (P0-3).
// GET : historique des décisions H1/H2 du projet.
// POST : { gate: H1|H2, approved: boolean, jobId?, reason? }.
// Écriture nominale : l'outil agent (execute ne tourne que sur approbation
// explicite via toolApproval user-approval). Cette route couvre les flows
// manuels et les tests directs. Limite assumée au prototype mono-user sans
// auth (D12, fermeture en P4-2) : un appel direct peut s'auto-approuver —
// voir docs/05 §1. L'agent, lui, ne peut pas contourner : son approval
// n'existe que sur clic réel.
export const dynamic = "force-dynamic";

import { getProject, readJsonBody, toApiError } from "@/lib/projects";
import { listApprovals, recordApproval } from "@/lib/approvals";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    await getProject(id);
    return Response.json({ approvals: await listApprovals(id) });
  } catch (e) {
    return toApiError(e);
  }
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    await getProject(id);
    let body: { gate?: unknown; approved?: unknown; jobId?: unknown; reason?: unknown } = {};
    try {
      body = await readJsonBody<typeof body>(req);
    } catch {
      return Response.json({ error: { code: "invalid_json", message: "Corps JSON invalide." } }, { status: 400 });
    }
    if (body.gate !== "H1" && body.gate !== "H2") {
      return Response.json({ error: { code: "invalid_gate", message: "Gate invalide (H1 | H2)." } }, { status: 400 });
    }
    if (typeof body.approved !== "boolean") {
      return Response.json({ error: { code: "invalid_approval", message: "approved doit être un booléen." } }, { status: 400 });
    }
    const rec = await recordApproval(id, {
      gate: body.gate,
      approved: body.approved,
      jobId: typeof body.jobId === "string" ? body.jobId : null,
      reason: typeof body.reason === "string" ? body.reason : null,
    });
    return Response.json({ approval: rec }, { status: 201 });
  } catch (e) {
    return toApiError(e);
  }
}
