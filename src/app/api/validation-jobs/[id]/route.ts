// GET /api/validation-jobs/:id — statut + rapports bornés du job worker.
// Docker-only strict : `queued`/`running` tant que le worker ne l'a pas traité.
export const dynamic = "force-dynamic";

import { toApiError } from "@/lib/projects";
import { getValidationJob, summarizeJobForAgent } from "@/lib/validation";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const job = await getValidationJob(id);
    return Response.json({ job: summarizeJobForAgent(job) });
  } catch (e) {
    return toApiError(e);
  }
}
