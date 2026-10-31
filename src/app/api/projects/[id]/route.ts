// /api/projects/:id : détail (GET), renommage + mode assemblage (PATCH { name?, assemblyMode? }), suppression (DELETE).
import { deleteProject, getProject, renameProject, setAssemblyMode, toApiError } from "@/lib/projects";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    return Response.json({ project: await getProject(id) });
  } catch (e) {
    return toApiError(e);
  }
}

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    let body: { name?: unknown; assemblyMode?: unknown };
    try {
      body = (await req.json()) as typeof body;
    } catch {
      return Response.json({ error: { code: "invalid_json", message: "Corps JSON invalide." } }, { status: 400 });
    }
    let project = await getProject(id);
    if (typeof body.assemblyMode === "string") {
      project = await setAssemblyMode(id, body.assemblyMode as "pcba-jlcpcb" | "pcb-seul" | "autre-fabricant" | "indecis");
    }
    if (typeof body.name === "string" && body.name.trim().length > 0) {
      project = await renameProject(id, String(body.name ?? ""));
    }
    return Response.json({ project });
  } catch (e) {
    return toApiError(e);
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    await deleteProject(id);
    return Response.json({ ok: true });
  } catch (e) {
    return toApiError(e);
  }
}
