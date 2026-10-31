// /api/projects/:id/files : copie de travail (fsMap courant → RunFrame).
// GET : fichiers. PUT : remplace la copie de travail { files } (versions via /versions).
import { getWorkingFiles, putWorkingFiles, toApiError } from "@/lib/projects";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    return Response.json({ files: await getWorkingFiles(id) });
  } catch (e) {
    return toApiError(e);
  }
}

export async function PUT(req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    let body: { files?: unknown };
    try {
      body = (await req.json()) as typeof body;
    } catch {
      return Response.json({ error: { code: "invalid_json", message: "Corps JSON invalide." } }, { status: 400 });
    }
    await putWorkingFiles(id, body.files as Record<string, string>);
    return Response.json({ files: await getWorkingFiles(id) });
  } catch (e) {
    return toApiError(e);
  }
}
