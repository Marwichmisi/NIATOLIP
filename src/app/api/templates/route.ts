// GET /api/templates : galerie des templates vérifiés (issue #8, FR-14).
// Métadonnées + BOM (sans le code — l'agent applique via applyTemplate,
// la création via POST /api/projects { templateId }).
import { listTemplateMeta, TEMPLATES } from "@/lib/templates";

export const dynamic = "force-dynamic";

export async function GET() {
  const meta = listTemplateMeta();
  const bomById: Record<string, typeof TEMPLATES[number]["bom"]> = {};
  for (const t of TEMPLATES) bomById[t.id] = t.bom;
  return Response.json({
    templates: meta.map((m) => ({ ...m, bom: bomById[m.id] ?? [] })),
  });
}
