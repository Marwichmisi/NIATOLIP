// État d'un run agent (poll UI : étapes, coût, fin).
import { getRun } from "@/lib/agent-runs";

export async function GET(_req: Request, ctx: { params: Promise<{ runId: string }> }) {
  const { runId } = await ctx.params;
  const run = getRun(runId);
  if (!run) return Response.json({ error: "Run introuvable." }, { status: 404 });
  return Response.json({ run });
}
