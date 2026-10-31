// POST /api/projects : création { name, templateId? }.
// templateId (T1/T2/T3, FR-14) amorce la copie de travail depuis le template ;
// sinon la carte jouet historique. Template inconnu → 400.
import { createProject, toApiError } from "@/lib/projects";
import { getTemplate } from "@/lib/templates";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { listProjects } = await import("@/lib/projects");
    return Response.json({ projects: await listProjects() });
  } catch (e) {
    return toApiError(e);
  }
}

export async function POST(req: Request) {
  try {
    let body: { name?: unknown; templateId?: unknown };
    try {
      body = (await req.json()) as typeof body;
    } catch {
      return Response.json({ error: { code: "invalid_json", message: "Corps JSON invalide." } }, { status: 400 });
    }
    let seed: Record<string, string> | undefined;
    if (body.templateId !== undefined) {
      const t = typeof body.templateId === "string" ? getTemplate(body.templateId) : null;
      if (!t) {
        return Response.json(
          { error: { code: "unknown_template", message: "Template inconnu (attendu : T1, T2 ou T3)." } },
          { status: 400 }
        );
      }
      seed = { "main.tsx": t.files["main.tsx"], "parts.json": t.files["parts.json"] };
    }
    const project = await createProject(typeof body.name === "string" ? body.name : "Nouveau projet", seed);
    return Response.json({ project, templateId: body.templateId ?? null }, { status: 201 });
  } catch (e) {
    return toApiError(e);
  }
}
