// /api/projects/:id/versions : GET liste, POST snapshot { label? }.
import { createVersion, listVersions, toApiError } from "@/lib/projects";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    return Response.json({ versions: await listVersions(id) });
  } catch (e) {
    return toApiError(e);
  }
}

export async function POST(req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    let label: string | undefined;
    try {
      const body = (await req.json()) as { label?: unknown };
      if (typeof body.label === "string") label = body.label;
    } catch {
      // Corps vide accepté : label auto.
    }
    const version = await createVersion(id, label);
    return Response.json({ version }, { status: 201 });
  } catch (e) {
    return toApiError(e);
  }
}
