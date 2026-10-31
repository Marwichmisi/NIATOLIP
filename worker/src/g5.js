// Helpers G5 purs (P0-2, retours revue #13 R3/R4).
// Aucune E/S, aucun import : testés via `npm run g5:fixtures` (import direct).
// `index.js` ne fait que l'orchestration (éval, KiCad, artefacts, DB).

/** Commit épinglé de `@tscircuit/jlcpcb-manufacturing-specs` (dép github). */
export const JLC_SPECS_COMMIT = "020e767d0c08794dec5eed2fa8635244c800599a";

/**
 * Plancher JLCPCB — copie synchronisée de `jlcMinTolerances` du commit épinglé.
 * Le paquet github n'expose que du `.ts` (pas de dist) : le worker Node pur ne
 * peut pas l'importer, d'où cet inline versionné. Test de sync : bloc G5-9 de
 * `scripts/g5-fixtures.ts` (deep-equal sous tsx, qui lui peut importer le paquet).
 */
export const JLC_MIN_INLINE = {
  min_trace_width: 0.1,
  min_via_hole_edge_to_via_hole_edge_clearance: 0.1,
  min_plated_hole_drill_edge_to_drill_edge_clearance: 0.15,
  min_trace_to_hole_edge_clearance: 0.2,
  min_trace_to_pad_edge_clearance: 0.1,
  min_pad_edge_to_pad_edge_clearance: 0.1,
  min_board_edge_clearance: 0.2,
  min_via_hole_diameter: 0.2,
  min_via_pad_diameter: 0.3,
};

export function parsePartsJson(files) {
  try {
    const raw = files["parts.json"];
    if (typeof raw !== "string") return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Normalise D17 (doc 04 §1 / doc 15 §4.2) + compat legacy templates
    // (sans statut) : lcsc présent => verified implicite, footprint inconnu.
    return parsed
      .filter((p) => p && typeof p.ref === "string")
      .map((p) => ({
        ref: p.ref,
        value: typeof p.value === "string" ? p.value : "",
        pkg: typeof p.pkg === "string" ? p.pkg : typeof p.footprint === "string" ? p.footprint : "",
        lcsc: typeof p.lcsc === "string" ? p.lcsc : null,
        mpn: typeof p.mpn === "string" ? p.mpn : null,
        role: typeof p.role === "string" ? p.role : "",
        status:
          p.status === "verified" ||
          p.status === "out_of_stock" ||
          p.status === "generic" ||
          p.status === "custom" ||
          p.status === "missing"
            ? p.status
            : typeof p.lcsc === "string"
              ? "verified"
              : "missing",
        footprintVerified:
          typeof p.footprintVerified === "boolean" ? p.footprintVerified : null,
      }));
  } catch {
    return [];
  }
}

/**
 * Noms des composants à assembler (R3 : exclut test points ET do_not_place).
 * Un `doNotPlace` (soudure manuelle, doc 04 §5) est absent du PnP officiel —
 * il doit donc être absent de la couverture, sinon `pnp_mismatch` à tort.
 * Une source reste assemblée si AU MOINS un de ses placements n'est pas DNP.
 */
export function getFittedSourceNames(circuitJson) {
  const dnpOnly = new Set();
  const fitted = new Set();
  for (const el of circuitJson) {
    if (el?.type !== "pcb_component" || typeof el.source_component_id !== "string") continue;
    if (el.do_not_place === true) dnpOnly.add(el.source_component_id);
    else fitted.add(el.source_component_id);
  }
  const out = [];
  for (const el of circuitJson) {
    if (el?.type !== "source_component") continue;
    if (el.ftype === "simple_test_point") continue;
    if (typeof el.source_component_id !== "string") continue;
    if (!fitted.has(el.source_component_id)) continue;
    if (typeof el.name === "string" && el.name.length > 0) out.push(el.name);
  }
  return out;
}

export function getPcbBoardId(circuitJson) {
  for (const el of circuitJson) {
    if (el?.type === "pcb_board" && typeof el.pcb_board_id === "string") return el.pcb_board_id;
  }
  return null;
}

/**
 * Plancher fabricant JLCPCB (G5-PCB) : erreurs bloquantes si sous le minimum.
 * Ne contrôle que le mesurable sans calcul de clearance (largeurs, vias) —
 * les clearances restent du ressort du DRC KiCad (G4, voir limitation doc 05 §3).
 */
export function checkJlcSpecs(circuitJson, jlcMin) {
  const findings = [];
  for (const el of circuitJson) {
    if (el?.type === "pcb_trace" && Array.isArray(el.route)) {
      const w = typeof el.width === "number" ? el.width : null;
      if (w !== null && w < (jlcMin.min_trace_width ?? 0.1)) {
        findings.push({
          severity: "error",
          code: "jlc_min_trace_width",
          message: `Piste sous minimum JLCPCB (${w} mm < ${jlcMin.min_trace_width} mm).`,
        });
        break;
      }
    }
  }
  for (const el of circuitJson) {
    if (el?.type === "pcb_via") {
      const hole = typeof el.hole_diameter === "number" ? el.hole_diameter : null;
      const outer = typeof el.outer_diameter === "number" ? el.outer_diameter : null;
      if (hole !== null && hole < (jlcMin.min_via_hole_diameter ?? 0.2)) {
        findings.push({
          severity: "error",
          code: "jlc_min_via_hole",
          message: `Via trou ${hole} mm < minimum JLCPCB ${jlcMin.min_via_hole_diameter} mm.`,
        });
        break;
      }
      if (outer !== null && outer < (jlcMin.min_via_pad_diameter ?? 0.3)) {
        findings.push({
          severity: "error",
          code: "jlc_min_via_pad",
          message: `Via pad ${outer} mm < minimum JLCPCB ${jlcMin.min_via_pad_diameter} mm.`,
        });
        break;
      }
    }
  }
  return findings.slice(0, 20);
}

/** Triple couverture : sources (assemblées) ↔ BOM ↔ PnP officiel. */
export function computeCoverage({ circuitJson, parts, pnpRefs }) {
  const bomRefs = new Set(parts.map((p) => p?.ref).filter((r) => typeof r === "string"));
  const fittedSources = getFittedSourceNames(circuitJson);
  const missingInBom = fittedSources.filter((r) => !bomRefs.has(r));
  const missingInPnp = fittedSources.filter((r) => !pnpRefs.includes(r));
  const extraInPnp = pnpRefs.filter((r) => !fittedSources.includes(r) && !bomRefs.has(r));
  return { bomRefs, fittedSources, missingInBom, missingInPnp, extraInPnp };
}

/**
 * G5-PCB : Gerber + BOM design + plancher JLCPCB. Le stock ne bloque jamais
 * le PCB nu (D17) ; le PnP n'est pas exigé pour un PCB nu.
 */
export function buildG5Pcb({ bomRefs, missingInBom, gerberFailed, specsFindings, fabricatorWarnings, bomRows }) {
  const findings = [];
  if (bomRefs.size === 0) findings.push({ severity: "error", code: "bom_empty", message: "BOM vide : parts.json manquant ou sans ref — renseignez [{ ref, lcsc, mpn, role }]." });
  if (missingInBom.length > 0) findings.push({ severity: "error", code: "bom_coverage", message: `Composants sans ligne BOM : ${missingInBom.slice(0, 10).join(", ")}.` });
  if (gerberFailed) findings.push({ severity: "error", code: "gerber_failed", message: "Gerber non généré (kicad-cli et lib en échec)." });
  for (const f of specsFindings) findings.push(f);
  for (const w of fabricatorWarnings) findings.push(w);
  return {
    status: findings.some((f) => f.severity === "error") ? "fail" : "pass",
    findings: findings.slice(0, 20),
    stats: { bomRows, missingBom: missingInBom.length, gerberOk: gerberFailed ? 0 : 1, specsErrors: specsFindings.filter((f) => f.severity === "error").length },
  };
}

/**
 * G5-PCBA (souple votée) : rupture confirmée, BOM vide, coordonnées PnP et
 * couverture PnP restent des erreurs ; stock inconnu, footprint non vérifié,
 * statuts generic/custom/out_of_stock et rotations non résolues = warnings
 * « à vos risques » (jamais bloquants — enforcement complet en #20).
 */
export function buildG5Pcba({ parts, bomRefs, missingInPnp, extraInPnp, pnpRowCount, pnpTool, badCoords, pnpError, stock, gerberFailed, rotationWarnings, orientationErrors, fabricatorWarnings, bomRows, pnpCoherent }) {
  const findings = [];
  if (bomRefs.size === 0) findings.push({ severity: "error", code: "bom_empty", message: "BOM vide : parts.json manquant ou sans ref." });
  const missingLcsc = parts.filter((p) => typeof p?.ref === "string" && typeof p?.lcsc !== "string").map((p) => p.ref);
  if (missingLcsc.length > 0) findings.push({ severity: "error", code: "bom_incomplete", message: `Refs sans LCSC : ${missingLcsc.slice(0, 10).join(", ")} — searchComponents d'abord.` });
  if (missingInPnp.length > 0 || extraInPnp.length > 0 || pnpRowCount === 0) {
    findings.push({ severity: "error", code: "pnp_mismatch", message: `PnP incohérent (${pnpTool}) : manquants ${missingInPnp.slice(0, 10).join(", ") || "—"}, en-trop ${extraInPnp.slice(0, 10).join(", ") || "—"}, lignes ${pnpRowCount}.` });
  }
  if ((badCoords ?? []).length > 0) {
    findings.push({ severity: "error", code: "pnp_missing_coordinates", message: `PnP sans coordonnées : ${(badCoords ?? []).slice(0, 10).map((r) => r.designator).join(", ")} — jamais de CSV vide.` });
  }
  if (pnpError) {
    findings.push({ severity: "error", code: "pnp_generation_failed", message: `PnP officiel en échec : ${String(pnpError).slice(0, 200)}.` });
  }
  if (stock.outOfStock.length > 0) findings.push({ severity: "error", code: "stock_empty", message: `Rupture confirmée : ${stock.outOfStock.join(", ")} — changer de pièce.` });
  if (gerberFailed) findings.push({ severity: "error", code: "gerber_failed", message: "Gerber non généré (kicad-cli et lib en échec)." });
  for (const u of stock.unknown.slice(0, 10)) {
    findings.push({ severity: "warning", code: "stock_unknown", message: `Stock inconnu pour ${u} — revérifier avant commande (export autorisé, à vos risques).` });
  }
  const unverifiedFootprint = parts.filter((p) => p.footprintVerified === false).map((p) => p.ref);
  if (unverifiedFootprint.length > 0) {
    findings.push({ severity: "warning", code: "footprint_unverified", message: `Empreinte non vérifiée (à vos risques) : ${unverifiedFootprint.slice(0, 10).join(", ")} — confirmer via getComponentDetails.` });
  }
  const nonVerifiedStatus = parts.filter((p) => ["generic", "custom", "out_of_stock"].includes(p.status)).map((p) => `${p.ref}(${p.status})`);
  if (nonVerifiedStatus.length > 0) {
    findings.push({ severity: "warning", code: "sourcing_non_verified", message: `Statuts non-verified (export autorisé, à vos risques) : ${nonVerifiedStatus.slice(0, 10).join(", ")}.` });
  }
  for (const w of [...rotationWarnings, ...orientationErrors].slice(0, 10)) {
    findings.push({ severity: "warning", code: "pnp_rotation_unverified", message: `Rotation PnP non vérifiée (souple) : ${w}` });
  }
  for (const w of fabricatorWarnings) findings.push(w);
  return {
    status: findings.some((f) => f.severity === "error") ? "fail" : "pass",
    findings: findings.slice(0, 20),
    stats: { bomRows, pnpRows: pnpRowCount, outOfStock: stock.outOfStock.length, unknownStock: stock.unknown.length, pnpCoherent: pnpCoherent ? 1 : 0, rotationWarnings: rotationWarnings.length },
  };
}
