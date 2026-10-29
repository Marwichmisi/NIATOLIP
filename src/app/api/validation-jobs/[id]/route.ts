// GET /api/validation-jobs/:id — statut job worker (jalon M2, issue #7).
// Stub honnête : 501 tant que le worker n'existe pas.
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(
    {
      error: {
        code: "worker_m2",
        message: "Jobs de validation indisponibles : worker Docker au jalon M2 (issue #7).",
      },
    },
    { status: 501 }
  );
}
