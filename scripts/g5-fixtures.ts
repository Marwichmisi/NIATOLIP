// Fixtures G5 scindée (P0-2) — sans worker Docker, sans eval 150 s.
// Usage : `npm run g5:fixtures`
// Vérifie les faux verts corrigés sur Circuit JSON minimal hand-crafté :
// - PnP officiel : coordonnées finies obligatoires, DNP/testpoints exclus,
//   rotations non résolues = warnings (souple), jamais de CSV vide ;
// - Triple couverture sources ↔ BOM ↔ PnP ;
// - Plancher JLCPCB (trace/via) + fabricator-drc (surcharge via < 0,3 mm).
const failures: string[] = [];
function assert(cond: boolean, msg: string): void {
  console.log(`${cond ? "  OK " : "  KO "} ${msg}`);
  if (!cond) failures.push(msg);
}

function minimalSoup(): Array<Record<string, unknown>> {
  return [
    { type: "source_component", source_component_id: "sc_R1", name: "R1", ftype: "simple_resistor", supplier_part_numbers: { jlcpcb: ["C25744"] } },
    { type: "source_component", source_component_id: "sc_C1", name: "C1", ftype: "simple_capacitor", supplier_part_numbers: { jlcpcb: ["C1525"] } },
    { type: "pcb_board", pcb_board_id: "board_0", width: 40, height: 30 },
    { type: "pcb_component", pcb_component_id: "pcb_R1", source_component_id: "sc_R1", center: { x: 10, y: 5 }, layer: "top", rotation: 0 },
    { type: "pcb_component", pcb_component_id: "pcb_C1", source_component_id: "sc_C1", center: { x: -10, y: -5 }, layer: "top", rotation: 90 },
    { type: "pcb_trace", pcb_trace_id: "tr_0", width: 0.2, route: [{ x: 0, y: 0 }, { x: 10, y: 5 }] },
    { type: "pcb_via", pcb_via_id: "via_0", hole_diameter: 0.4, outer_diameter: 0.8, x: 0, y: 0 },
  ];
}

async function main(): Promise<void> {
  const { convertCircuitJsonToPickAndPlaceRows, convertCircuitJsonToPickAndPlaceCsv } = await import("circuit-json-to-pnp-csv");
  const { runDrcChecks } = await import("@tscircuit/fabricator-drc");
  const specs = await import("@tscircuit/jlcpcb-manufacturing-specs");
  const g5 = (await import("../worker/src/g5.js")) as unknown as {
    JLC_MIN_INLINE: Record<string, number>;
    normalizeKicadSchPower: (sch: string) => { text: string; count: number };
    getFittedSourceNames: (cj: unknown[]) => string[];
    computeCoverage: (args: { circuitJson: unknown[]; parts: Array<Record<string, unknown>>; pnpRefs: string[] }) => { fittedSources: string[]; missingInBom: string[]; missingInPnp: string[]; extraInPnp: string[] };
    buildG5Pcba: (args: Record<string, unknown>) => { status: string; findings: Array<{ code: string; severity: string }> };
  };

  console.log("== G5-1 PnP officiel : coordonnées finies ==");
  const soup = minimalSoup() as never;
  const warnings: string[] = [];
  const rows = convertCircuitJsonToPickAndPlaceRows(soup, { supplier: "jlcpcb", requireSupplierRotation: false, onRotationWarning: (w) => { warnings.push(w.designator); } });
  assert(rows.length === 2, `2 lignes PnP (reçu ${rows.length})`);
  assert(rows.every((r) => Number.isFinite(r.mid_x) && Number.isFinite(r.mid_y)), "coordonnées finies (anti-faux-vert CSV vide)");
  assert(rows.some((r) => r.designator === "R1") && rows.some((r) => r.designator === "C1"), "designators R1/C1 présents");
  const csv = convertCircuitJsonToPickAndPlaceCsv(soup, { supplier: "jlcpcb", requireSupplierRotation: false });
  assert(csv.includes("Mid X") && csv.includes("R1") && csv.includes("10.000"), "CSV officiel avec coordonnées (pas de ',,,,' )");
  assert(!/,,,\s*$/.test(csv.split("\n")[1] ?? ""), "pas de ligne vide de coordonnées");

  console.log("== G5-2 DNP / test-point exclus ==");
  const soupDnp = [...minimalSoup(), { type: "pcb_component", pcb_component_id: "pcb_DNP", source_component_id: "sc_R1", center: { x: 0, y: 0 }, layer: "top", rotation: 0, do_not_place: true }] as never;
  const rowsDnp = convertCircuitJsonToPickAndPlaceRows(soupDnp, { supplier: "jlcpcb" });
  assert(rowsDnp.length === 2, `DNP exclu (reçu ${rowsDnp.length})`);

  console.log("== G5-3 requireSupplierRotation sans supplier = échec explicite ==");
  let threw = false;
  try {
    convertCircuitJsonToPickAndPlaceRows(soup, { requireSupplierRotation: true } as never);
  } catch { threw = true; }
  assert(threw, "requireSupplierRotation sans supplier lève");

  console.log("== G5-4 specs JLCPCB plancher ==");
  assert(typeof specs.jlcMinTolerances.min_trace_width === "number" && specs.jlcMinTolerances.min_trace_width <= 0.1, `min_trace_width=${specs.jlcMinTolerances.min_trace_width}`);
  assert(typeof specs.jlcMinTolerances.min_via_hole_diameter === "number", "min_via_hole_diameter présent");
  const thinTrace = [{ type: "pcb_trace", width: 0.05, route: [{ x: 0, y: 0 }] }];
  const isThinBad = (thinTrace[0] as { width: number }).width < (specs.jlcMinTolerances.min_trace_width ?? 0.1);
  assert(isThinBad, "piste 0,05 mm détectée sous plancher");

  console.log("== G5-5 fabricator-drc surcharge via ==");
  const smallVia = [
    { type: "pcb_board", pcb_board_id: "board_0" },
    { type: "pcb_via", pcb_via_id: "via_small", hole_diameter: 0.2 },
  ] as never;
  const diags = runDrcChecks({ circuitJson: smallVia, fabricatorPreset: "jlcpcb_economy", pcbBoardId: "board_0" });
  assert(diags.length === 1 && diags[0].type === "pcb_fabricator_extra_charge_warning", "via 0,2 mm = 1 warning surcharge");
  const okVia = [{ type: "pcb_board", pcb_board_id: "b" }, { type: "pcb_via", pcb_via_id: "v", hole_diameter: 0.3 }] as never;
  assert(runDrcChecks({ circuitJson: okVia, fabricatorPreset: "jlcpcb_economy", pcbBoardId: "b" }).length === 0, "via 0,3 mm = 0 warning");
  assert(runDrcChecks({ circuitJson: okVia, fabricatorPreset: "preset_inconnu", pcbBoardId: "b" }).length === 0, "preset inconnu = 0 diagnostic");

  console.log("== G5-6 rotation souple = warnings, pas d'exception ==");
  // Sans pin1_location ni partsEngine, la conversion souple garde la rotation PCB + warning.
  // Les 2 composants de minimalSoup() déclenchent chacun exactement 1 warning.
  assert(warnings.length === 2, `2 rotations non résolues collectées en warnings (reçu ${warnings.length})`);

  console.log("== G5-7 DNP exclu de la couverture (R3) ==");
  // Un composant 100 % do_not_place (soudure manuelle, doc 04 §5) est absent du
  // PnP officiel : il doit être absent de la couverture, sinon pnp_mismatch à tort.
  const soupDnpCov = [
    ...minimalSoup(),
    { type: "source_component", source_component_id: "sc_D2", name: "D2", ftype: "simple_led", supplier_part_numbers: { jlcpcb: ["C6848499"] } },
    { type: "pcb_component", pcb_component_id: "pcb_D2", source_component_id: "sc_D2", center: { x: 0, y: 8 }, layer: "top", rotation: 0, do_not_place: true },
  ];
  const fittedDnp = g5.getFittedSourceNames(soupDnpCov as unknown[]);
  assert(fittedDnp.length === 2 && fittedDnp.includes("R1") && fittedDnp.includes("C1"), `DNP exclu des sources assemblées (reçu ${JSON.stringify(fittedDnp)})`);
  const rowsDnpCov = convertCircuitJsonToPickAndPlaceRows(soupDnpCov as never, { supplier: "jlcpcb" });
  assert(!rowsDnpCov.some((r) => r.designator === "D2"), "DNP absent du PnP officiel");
  const cov = g5.computeCoverage({
    circuitJson: soupDnpCov as unknown[],
    parts: [{ ref: "R1", lcsc: "C25744" }, { ref: "C1", lcsc: "C1525" }, { ref: "D2", lcsc: "C6848499" }],
    pnpRefs: rowsDnpCov.map((r) => r.designator).filter(Boolean),
  });
  assert(cov.missingInPnp.length === 0 && cov.extraInPnp.length === 0, `couverture cohérente avec DNP (manquants: ${cov.missingInPnp}, en-trop: ${cov.extraInPnp})`);
  // Garde : sans le fix, D2 serait dans fittedSources → pnp_mismatch.
  const verdictDnp = g5.buildG5Pcba({
    parts: [{ ref: "R1", lcsc: "C25744" }, { ref: "C1", lcsc: "C1525" }, { ref: "D2", lcsc: "C6848499" }],
    bomRefs: new Set(["R1", "C1", "D2"]),
    missingInPnp: cov.missingInPnp, extraInPnp: cov.extraInPnp,
    pnpRowCount: rowsDnpCov.length, pnpTool: "test",
    badCoords: [], pnpError: null,
    stock: { known: [], unknown: [], outOfStock: [] }, gerberFailed: false,
    rotationWarnings: [], orientationErrors: [], fabricatorWarnings: [],
    bomRows: 3, pnpCoherent: cov.missingInPnp.length === 0 && cov.extraInPnp.length === 0,
  });
  assert(verdictDnp.status === "pass" && !verdictDnp.findings.some((f) => f.code === "pnp_mismatch"), "G5-PCBA vert avec DNP (pas de pnp_mismatch)");

  console.log("== G5-8 fermeture des imports worker (R5) ==");
  // Tout import statique/dynamique des dists exécutées par le worker doit se
  // résoudre DANS worker/node_modules (l'image Docker ne contient que lui).
  // Sans ça, le worker meurt en éval avec Cannot find package (constaté ×8 en E2E).
  {
    const { readFileSync, existsSync, readdirSync, statSync } = await import("node:fs");
    const { join } = await import("node:path");
    const WM = join(process.cwd(), "worker", "node_modules");
    const roots = ["@tscircuit/eval", "@tscircuit/core", "kicad-to-circuit-json", "@tscircuit/capacity-autorouter", "circuit-json-to-bom-csv", "circuit-json-to-gerber", "circuit-json-to-kicad", "circuit-json-to-pnp-csv", "circuit-json-to-connectivity-map", "circuit-json-to-bpc", "@tscircuit/fabricator-drc", "@tscircuit/circuit-json-util", "@tscircuit/soup-util"];
    const builtins = new Set(["fs", "path", "os", "crypto", "child_process", "util", "events", "stream", "buffer", "string_decoder", "querystring", "url", "assert", "zlib", "http", "https", "tty", "worker_threads", "perf_hooks", "async_hooks", "module", "process", "timers", "constants", "vm", "inspector", "node:test"]);
    const bare = new Set<string>();
    const re = /(?:from\s+['"]|import\s*\(\s*['"])([^'"\s;{}][^'"]*)['"]/g;
    const walk = (d: string): void => {
      for (const e of readdirSync(d)) {
        const p = join(d, e);
        if (statSync(p).isDirectory()) { if (e !== "node_modules") walk(p); continue; }
        if (!/\.(js|mjs|cjs)$/.test(e)) continue;
        const src = readFileSync(p, "utf8");
        let m: RegExpExecArray | null;
        while ((m = re.exec(src))) bare.add(m[1]);
      }
    };
    for (const r of roots) { try { walk(join(WM, r)); } catch { failures.push(`racine worker manquante: ${r}`); } }
    const missing: string[] = [];
    // Allowlist documentée (hors graphe d'exécution du worker, prouvé par l'E2E) :
    // - archiver : import statique du seul cli.js de circuit-json-to-gerber (le worker n'importe que l'entrée lib) ;
    // - circuit-to-svg : dynamic import avec .catch explicite dans core (optionnel assumé) ;
    // - jscad-fiber : chemin 3D/enclosure, absent même de l'arbre racine complet ; à re-trier si le worker évalue un jour des composants 3D.
    const allowedMissing = new Set(["archiver", "circuit-to-svg", "jscad-fiber"]);
    for (const b of [...bare].sort()) {
      if (b.startsWith(".") || b.startsWith("https:") || b.includes("${")) continue;
      const top = b.startsWith("@") ? b.split("/").slice(0, 2).join("/") : b.split("/")[0].replace(/^node:/, "");
      if (builtins.has(top) || builtins.has(`node:${top}`)) continue;
      if (!/^[a-z@][a-z0-9@/_.-]*$/i.test(top)) continue;
      if (!existsSync(join(WM, top)) && !allowedMissing.has(top)) missing.push(top);
    }
    assert(missing.length === 0, `imports worker tous résolus en local (${missing.slice(0, 5).join(", ") || "ok"})`);
  }

  console.log("== G5-9 sync inline ↔ paquet specs (R4) ==");
  {
    const keys = Object.keys(specs.jlcMinTolerances).sort();
    const inlineKeys = Object.keys(g5.JLC_MIN_INLINE).sort();
    assert(JSON.stringify(keys) === JSON.stringify(inlineKeys), `mêmes clés specs (paquet: ${keys.length}, inline: ${inlineKeys.length})`);
    const diff = keys.filter((k) => (specs.jlcMinTolerances as Record<string, number>)[k] !== (g5.JLC_MIN_INLINE as Record<string, number>)[k]);
    assert(diff.length === 0, `valeurs inline sync avec le paquet (${diff.join(", ") || "ok"})`);
  }

  console.log("== G5-10 normalisation (power global|local) → (power) (P0-6 #28) ==");
  {
    const sample = "(lib_symbols (symbol \"Custom:rail_up_1_1\" (power global) (pin (length 0.01)))) (symbol \"X\" (power local)) (symbol \"Y\" (power))";
    const { text, count } = g5.normalizeKicadSchPower(sample);
    assert(count === 2, `2 occurrences normalisées (reçu ${count})`);
    assert(!/\(power\s+(?:global|local)\)/.test(text), "plus aucun (power global|local)");
    assert((text.match(/\(power\)/g) ?? []).length === 3, "3× (power) nu après normalisation");
    const idem = g5.normalizeKicadSchPower("(power)");
    assert(idem.count === 0 && idem.text === "(power)", "schéma déjà compatible : inchangé, count 0");
  }

  if (failures.length > 0) {
    console.log(`\n${failures.length} fixture(s) G5 en échec.`);
    process.exit(1);
  }
  console.log("\nToutes les fixtures G5 sont conformes (PnP officiel, specs, fabricator-drc).");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
