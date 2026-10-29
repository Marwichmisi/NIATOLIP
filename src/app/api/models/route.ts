// GET /api/models : choix exposés à l'UI (IDs résolus serveur, aucune clé).
import { getDefaultChoice, getModelCatalog, getProviderStatus } from "@/lib/models";

export const dynamic = "force-dynamic";

export async function GET() {
  const catalog = getModelCatalog();
  const status = getProviderStatus();
  return Response.json({
    defaultChoice: getDefaultChoice(),
    models: (
      Object.keys(catalog) as Array<keyof typeof catalog>
    ).map((choice) => ({
      choice,
      modelId: catalog[choice].modelId,
      configured: status[choice].configured,
    })),
  });
}
