// Sync des épinglages tscircuit racine ↔ worker (dette D1 revue #12, R4 revue #13).
// Usage : `npm run versions:check`
// Le worker est un paquet séparé SANS overrides : chaque version tscircuit doit
// être identique des deux côtés, sinon le worker évalue avec un autre moteur
// que le web (doublons imbriqués, Module not found — cf. AGENTS.md).
import { readFileSync } from "node:fs";
import { join } from "node:path";

const failures: string[] = [];
function check(cond: boolean, msg: string): void {
  console.log(`${cond ? "  OK " : "  KO "} ${msg}`);
  if (!cond) failures.push(msg);
}

function readJson(p: string): Record<string, unknown> {
  return JSON.parse(readFileSync(p, "utf8")) as Record<string, unknown>;
}

async function main(): Promise<void> {
  const root = join(process.cwd(), "package.json");
  const worker = join(process.cwd(), "worker", "package.json");
  const rootPkg = readJson(root) as { dependencies: Record<string, string>; overrides: Record<string, string> };
  const workerPkg = readJson(worker) as { dependencies: Record<string, string> };
  const { TSCIRCUIT_VERSIONS } = (await import("../src/lib/toy-circuit.js")) as {
    TSCIRCUIT_VERSIONS: Record<string, string>;
  };
  const workerSrc = readFileSync(join(process.cwd(), "worker", "src", "index.js"), "utf8");
  const g5src = readFileSync(join(process.cwd(), "worker", "src", "g5.js"), "utf8");

  // 1. Moteur tscircuit : root deps == root overrides == worker deps == TSCIRCUIT_VERSIONS.
  // (circuit-json n'a pas d'entrée TSCIRCUIT_VERSIONS : la référence est l'override racine.)
  for (const name of ["@tscircuit/core", "@tscircuit/eval", "@tscircuit/checks"]) {
    const key = name.split("/")[1];
    const expected = (TSCIRCUIT_VERSIONS as Record<string, string>)[key];
    // Dép directe racine optionnelle (core n'y est qu'en overrides via tscircuit) ;
    // overrides + worker sont obligatoires.
    if (rootPkg.dependencies[name] !== undefined) {
      check(rootPkg.dependencies[name] === expected, `${name} racine == TSCIRCUIT_VERSIONS.${key} (${expected})`);
    } else {
      console.log(`  -- ${name} : pas de dép directe racine (overrides fait foi)`);
    }
    check(rootPkg.overrides[name] === expected, `${name} overrides == ${expected}`);
    check(workerPkg.dependencies[name] === expected, `${name} worker == ${expected}`);
  }
  {
    const cj = "circuit-json";
    const expectedCj = rootPkg.overrides[cj];
    check(typeof expectedCj === "string" && expectedCj.length > 0, `circuit-json : override racine présent (${expectedCj})`);
    if (rootPkg.dependencies[cj] !== undefined) {
      check(rootPkg.dependencies[cj] === expectedCj, `circuit-json racine == overrides (${expectedCj})`);
    } else {
      console.log(`  -- circuit-json : pas de dép directe racine (overrides fait foi)`);
    }
    check(workerPkg.dependencies[cj] === expectedCj, `circuit-json worker == overrides (${expectedCj})`);
  }
  // 2. Convertisseurs + PnP + fabricator : root == worker == constantes worker.
  const pairs: Array<[string, string]> = [
    ["circuit-json-to-bom-csv", "CONVERTER_BOM_VERSION"],
    ["circuit-json-to-gerber", "CONVERTER_GERBER_VERSION"],
    ["circuit-json-to-kicad", "CONVERTER_KICAD_VERSION"],
    ["circuit-json-to-pnp-csv", "CONVERTER_PNP_VERSION"],
    ["@tscircuit/fabricator-drc", "FABRICATOR_DRC_VERSION"],
  ];
  for (const [dep, cst] of pairs) {
    check(rootPkg.dependencies[dep] === workerPkg.dependencies[dep], `${dep} racine == worker (${workerPkg.dependencies[dep]})`);
    const m = new RegExp(`const ${cst} = "([^"]+)"`).exec(workerSrc);
    check(m?.[1] === workerPkg.dependencies[dep], `${cst} == ${dep} (${m?.[1] ?? "introuvable"})`);
  }
  // 3. Specs github : même commit racine/worker/g5.js.
  const shaRe = /jlcpcb-manufacturing-specs#([0-9a-f]{7,40})/;
  const rootSha = shaRe.exec(rootPkg.dependencies["@tscircuit/jlcpcb-manufacturing-specs"] ?? "")?.[1];
  const workerSha = shaRe.exec(workerPkg.dependencies["@tscircuit/jlcpcb-manufacturing-specs"] ?? "")?.[1];
  const g5Sha = /JLC_SPECS_COMMIT = "([0-9a-f]+)"/.exec(g5src)?.[1];
  check(!!rootSha && rootSha === workerSha, `specs commit racine == worker (${workerSha})`);
  check(!!g5Sha && workerSha?.startsWith(g5Sha) === true, `JLC_SPECS_COMMIT == specs worker (${g5Sha})`);
  // 4. P0-4 : la quarantaine est versionnée par les checks (un bump invalide
  // l'historique — jamais de déclassement persistant sous N+1).
  const gatesSrc = readFileSync(join(process.cwd(), "src", "lib", "agent-gates.ts"), "utf8");
  check(
    gatesSrc.includes("checksVersion: string") && gatesSrc.includes("parsed.checksVersion !== CHECKS_VERSION"),
    "quarantaine versionnée par CHECKS_VERSION (invalidation au bump)"
  );

  if (failures.length > 0) {
    console.log(`\n${failures.length} épinglage(s) désynchronisé(s).`);
    process.exit(1);
  }
  console.log("\nÉpinglages synchronisés (racine ↔ worker ↔ constantes).");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
