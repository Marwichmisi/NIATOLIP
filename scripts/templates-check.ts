// Vérification des templates T1–T3 (issue #8) : chaque template est évalué
// par le VRAI tscircuit serveur (même moteur que l'agent) et passe les gates
// G0–G3 natives (P0-1, doc 12 : aucun faux positif maison restant).
// Usage : `npm run templates:check`
import { evaluateFullServer, runAllGates } from "../src/lib/agent-gates";

async function main(): Promise<void> {
  const { TEMPLATES } = await import("../src/lib/templates");
  let failed = 0;
  for (const t of TEMPLATES) {
    const files = { "main.tsx": t.files["main.tsx"], "parts.json": t.files["parts.json"] };
    console.log(`\n=== ${t.id} — ${t.title} (${t.status}) ===`);
    try {
      const full = await evaluateFullServer(files, "main.tsx");
      // Référence purement native comme le corpus : quarantaine ignorée
      // explicitement, divergences remontées en clair (signal, pas verdict).
      const { reports, divergences } = await runAllGates(full.summary, full.circuitJson);
      for (const r of reports) {
        const icon = r.status === "pass" ? "✓" : "✗";
        console.log(`  ${icon} ${r.gate}: ${r.status} ${JSON.stringify(r.stats)}`);
        for (const f of r.findings.filter((x) => x.severity === "error").slice(0, 8)) {
          console.log(`      - [${f.code}] ${f.message.slice(0, 160)}`);
        }
      }
      for (const d of divergences.slice(0, 8)) {
        console.log(`  ! divergence ${d.gate}/${d.ruleCode} (${d.kind})`);
      }
      const hard = reports.filter((r) => r.status === "fail");
      if (hard.length > 0) {
        failed++;
        console.log(`  → ÉCHEC (${hard.map((r) => r.gate).join(",")})`);
      } else {
        console.log(`  → OK (G0–G3 verts)`);
      }
    } catch (err) {
      failed++;
      console.log(`  → EXCEPTION : ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (failed > 0) {
    console.log(`\n${failed} template(s) en échec G0–G3.`);
    process.exit(1);
  }
  console.log("\nTous les templates sont G0–G3 verts.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
