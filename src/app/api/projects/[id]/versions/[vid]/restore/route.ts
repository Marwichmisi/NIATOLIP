// POST /api/projects/:id/versions/:vid/restore : restauration.
// Règle doc 07 §2 : la restauration copie la version source dans la copie
// de travail ET fige une nouvelle version (historique jamais réécrit).
import { restoreVersion, toApiError } from "@/lib/projects";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; vid: string }> };

export async function POST(req: Request, ctx: Ctx) {
  try {
    const { id, vid } = await ctx.params;
    let label: string | undefined;
    try {
      const body = (await req.json()) as { label?: unknown };
      if (typeof body.label === "string") label = body.label;
    } catch {
      // Corps vide accepté.
    }
    const version = await restoreVersion(id, vid, label);
    return Response.json({ version }, { status: 201 });
  } catch (e) {
    return toApiError(e);
  }
}
