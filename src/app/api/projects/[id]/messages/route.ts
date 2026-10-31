// /api/projects/:id/messages : historique de conversation (restauration à la réouverture).
// GET : historique (texte + parties d'outils). POST : ajoute { messages: [{ role, text, parts? }] }.
import { appendMessages, getMessages, toApiError } from "@/lib/projects";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    return Response.json({ messages: await getMessages(id) });
  } catch (e) {
    return toApiError(e);
  }
}

export async function POST(req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    let body: { messages?: unknown };
    try {
      body = (await req.json()) as typeof body;
    } catch {
      return Response.json({ error: { code: "invalid_json", message: "Corps JSON invalide." } }, { status: 400 });
    }
    if (!Array.isArray(body.messages) || body.messages.length === 0) {
      return Response.json(
        { error: { code: "invalid_message", message: "messages manquant (tableau non vide)." } },
        { status: 400 }
      );
    }
    await appendMessages(id, body.messages as Array<{ role: string; text: string; parts?: unknown }>);
    return Response.json({ ok: true }, { status: 201 });
  } catch (e) {
    return toApiError(e);
  }
}
