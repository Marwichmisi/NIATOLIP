// Worker validation KiCad M2 (issue #7, doc 05 G4/G5).
// Boucle : réclame un job `queued` → traite (10 min max) → écrit rapports + artefacts.
// Sorties : table validation_jobs (erc/drc/g4/g5) + table artifacts + fichiers
// sur ARTIFACTS_DIR (volume partagé avec le web). Node 22, ESM, zéro secret lu
// à part DATABASE_URL.
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pkg from "pg";
import JSZip from "jszip";
import {
  JLC_MIN_INLINE,
  JLC_SPECS_COMMIT,
  buildG5Pcb,
  buildG5Pcba,
  checkJlcSpecs,
  computeCoverage,
  getPcbBoardId,
  normalizeKicadSchPower,
  parsePartsJson,
} from "./g5.js";

const { Pool } = pkg;

// Versions épinglées — synchronisées avec la racine (package.json + toy-circuit.ts).
// Toute montée de version = PR dédiée (doc 01 §6).
const TSCIRCUIT_EVAL_VERSION = "0.0.1668";
const TSCIRCUIT_CORE_VERSION = "0.0.2230";
const CONVERTER_KICAD_VERSION = "0.0.262";
const CONVERTER_GERBER_VERSION = "0.0.122";
const CONVERTER_BOM_VERSION = "0.0.24";
const CONVERTER_PNP_VERSION = "0.0.21";
const FABRICATOR_DRC_VERSION = "0.0.4";
// JLC_SPECS_COMMIT importé de ./g5.js (avec JLC_MIN_INLINE).
const KICAD_IMAGE = "kicad/kicad:9.0";

const DATABASE_URL = process.env.DATABASE_URL ?? "";
const ARTIFACTS_DIR = process.env.ARTIFACTS_DIR ?? "/artifacts";
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS ?? "5000");
const JOB_TIMEOUT_MS = Number(process.env.JOB_TIMEOUT_MS ?? "600000");
const WORKER_ID = `worker-${randomUUID().slice(0, 8)}`;

if (!DATABASE_URL) {
  console.error("[worker] DATABASE_URL manquante — arrêt (Docker-only strict : le worker vit dans le compose).");
  process.exit(1);
}

const pool = new Pool({ connectionString: DATABASE_URL, max: 3, idleTimeoutMillis: 30_000 });

let stopped = false;
process.on("SIGTERM", () => { stopped = true; });
process.on("SIGINT", () => { stopped = true; });

function log(...args) {
  console.log(`[${new Date().toISOString()} ${WORKER_ID}]`, ...args);
}

function sha256Hex(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

function runCmd(cmd, args, opts = {}) {
  const timeout = opts.timeoutMs ?? 300_000;
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout, maxBuffer: 32 * 1024 * 1024, cwd: opts.cwd }, (err, stdout, stderr) => {
      resolve({
        code: err && typeof err.code === "number" ? err.code : err ? 1 : 0,
        stdout: String(stdout ?? ""),
        stderr: String(stderr ?? "").slice(0, 4000),
        timeout: Boolean(err && (err.killed || /timed out/i.test(err.message ?? ""))),
      });
    });
  });
}

function resolveEntrypoint(files) {
  if (typeof files["main.tsx"] === "string") return "main.tsx";
  if (typeof files["index.tsx"] === "string") return "index.tsx";
  const first = Object.keys(files).filter((p) => p.endsWith(".tsx")).sort()[0];
  if (!first) throw new Error("Aucun fichier .tsx dans le snapshot.");
  return first;
}

// ---------- Évaluation tscircuit (même moteur que le web : @tscircuit/eval) ----------

async function evaluateSnapshot(files, entrypoint) {
  const { CircuitRunner } = await import("@tscircuit/eval");
  const runner = new CircuitRunner();
  try {
    const run = (async () => {
      await runner.executeWithFsMap({ fsMap: files, entrypoint });
      await runner.renderUntilSettled();
      return runner.getCircuitJson();
    })();
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Évaluation tscircuit : timeout après 150 s.")), 150_000)
    );
    const raw = await Promise.race([run, timeout]);
    return Array.isArray(raw) ? raw : [];
  } finally {
    await runner.kill().catch(() => {});
  }
}

// ---------- Lecture défensive des rapports kicad-cli JSON ----------

function summarizeKicadReport(raw, kind, exitCode) {
  const findings = [];
  let errors = 0;
  let warnings = 0;
  let unparsed = false;
  try {
    const push = (sev, code, message, ref) => {
      findings.push({ severity: sev, code: String(code ?? kind).slice(0, 80), message: String(message ?? "").slice(0, 300), ...(ref ? { ref: String(ref).slice(0, 40) } : {}) });
      if (sev === "error") errors++;
      else warnings++;
    };
    const visit = (item) => {
      if (!item || typeof item !== "object") return;
      const sevRaw = String(item.severity ?? item.type ?? item.level ?? "").toLowerCase();
      const sev = /err|error|fatal/.test(sevRaw) ? "error" : /warn/.test(sevRaw) ? "warning" : null;
      const message = item.message ?? item.description ?? item.title ?? item.violation ?? null;
      if (sev && message) {
        push(sev, item.code ?? item.type ?? kind, message, item.component ?? item.net ?? item.ref ?? item.designator ?? undefined);
        return;
      }
      // Forme { errors: [...], warnings: [...] }.
      for (const v of (item.errors ?? [])) {
        if (typeof v === "string") push("error", kind, v);
        else visit({ ...v, severity: "error" });
      }
      for (const v of (item.warnings ?? [])) {
        if (typeof v === "string") push("warning", kind, v);
        else visit({ ...v, severity: "warning" });
      }
      // Forme { violations: [...] } (schéma kicad-cli ERC/DRC).
      for (const v of (item.violations ?? [])) visit(v);
      for (const v of (item.sheets ?? [])) visit(v);
      for (const v of (item.items ?? [])) visit(v);
    };
    if (Array.isArray(raw)) {
      for (const v of raw) visit(v);
    } else {
      visit(raw);
    }
    if (findings.length === 0 && exitCode !== 0) {
      // Schéma inconnu mais violations signalées : strict et honnête.
      // Extrait brut joint pour diagnostic (borne à 200 o.).
      unparsed = true;
      const excerpt = JSON.stringify(raw).slice(0, 200);
      push("error", `${kind}_unparsed`, `Rapport ${kind} non vide (schéma JSON inattendu, ${JSON.stringify(raw).length} o., extrait : ${excerpt}) — traité comme bloquant.`);
    }
  } catch (e) {
    unparsed = true;
    findings.push({ severity: "error", code: `${kind}_parse_error`, message: `Rapport ${kind} illisible : ${e.message}` });
    errors++;
  }
  return {
    summary: { kind, exitCode, errors, warnings, unparsed },
    findings: findings.slice(0, 20),
    stats: { exitCode, errors, warnings, unparsed: unparsed ? 1 : 0 },
  };
}

// ---------- Exports ----------

async function tryKicadExports(pcbPath, outDir) {
  const out = { gerbersDir: null, drillDir: null, posCsv: null, log: [] };
  const gerbersDir = join(outDir, "gerbers");
  const drillDir = join(outDir, "drill");
  await mkdir(gerbersDir, { recursive: true });
  await mkdir(drillDir, { recursive: true });
  // Flags stables documentés (docs.kicad.org cli) : --format json, --output, --exit-code-violations.
  let r = await runCmd("kicad-cli", ["pcb", "export", "gerbers", "--output", gerbersDir, pcbPath], { cwd: outDir });
  out.log.push(`gerbers: exit=${r.code} ${r.stderr.slice(0, 200)}`);
  if (r.code === 0) out.gerbersDir = gerbersDir;
  r = await runCmd("kicad-cli", ["pcb", "export", "drill", "--output", drillDir, pcbPath], { cwd: outDir });
  out.log.push(`drill: exit=${r.code} ${r.stderr.slice(0, 200)}`);
  if (r.code === 0) out.drillDir = drillDir;
  const posPath = join(outDir, "pos.csv");
  r = await runCmd("kicad-cli", ["pcb", "export", "pos", "--output", posPath, "--format", "csv", pcbPath], { cwd: outDir });
  out.log.push(`pos: exit=${r.code} ${r.stderr.slice(0, 200)}`);
  if (r.code === 0) out.posCsv = posPath;
  return out;
}

async function libGerberFiles(circuitJson) {
  try {
    const { convertCircuitJsonToGerberFiles } = await import("circuit-json-to-gerber");
    const files = await convertCircuitJsonToGerberFiles(circuitJson);
    const out = {};
    for (const [name, content] of Object.entries(files ?? {})) {
      const text = typeof content === "string" ? content : (content?.gerberContent ?? content?.content ?? null);
      if (typeof text === "string") out[name] = text;
    }
    return out;
  } catch (e) {
    return { __error: e.message };
  }
}

async function buildBom(circuitJson, parts) {
  const byRef = new Map();
  for (const p of parts) {
    if (p && typeof p.ref === "string") byRef.set(p.ref, p);
  }
  try {
    const { convertCircuitJsonToBomRows, convertBomRowsToCsv } = await import("circuit-json-to-bom-csv");
    const rows = await convertCircuitJsonToBomRows({
      circuitJson,
      resolvePart: async ({ source_component }) => {
        const ref = source_component?.name;
        const part = typeof ref === "string" ? byRef.get(ref) : null;
        if (!part || typeof part.lcsc !== "string") return null;
        return {
          supplier_part_number_columns: { "JLCPCB Part #": part.lcsc },
          ...(typeof part.mpn === "string" ? { manufacturer_mpn_pairs: [{ manufacturer: "", mpn: part.mpn }] } : {}),
          ...(typeof part.role === "string" ? { extra_columns: { role: part.role } } : {}),
        };
      },
    });
    return { csv: convertBomRowsToCsv(rows), rows: rows.length, tool: "circuit-json-to-bom-csv", byRef };
  } catch (e) {
    // Repli honnête : CSV minimal depuis parts.json.
    const lines = ["Ref,Value,Footprint,LCSC,MPN,Role"];
    for (const p of parts) {
      lines.push([p.ref ?? "", p.value ?? "", p.pkg ?? p.footprint ?? "", p.lcsc ?? "", p.mpn ?? "", p.role ?? ""].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","));
    }
    return { csv: lines.join("\n") + "\n", rows: parts.length, tool: `fallback-manuel (${e.message})`, byRef };
  }
}

async function recheckStock(lcscList) {
  // Best-effort : endpoint documenté par jlc.ts (easyeda, cache_only).
  // Stock confirmé à 0 → bloquant G5 ; inconnu → warning explicite (pas de faux vert).
  const out = { checkedAt: new Date().toISOString(), known: [], unknown: [], outOfStock: [] };
  for (const lcsc of [...new Set(lcscList)].slice(0, 100)) {
    const id = /^C?\d+$/i.test(lcsc) ? `C${lcsc.replace(/^C/i, "")}` : null;
    if (!id) { out.unknown.push(lcsc); continue; }
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 20_000);
      const res = await fetch(`https://jlcsearch.tscircuit.com/api/easyeda_components/${id}?cache_only=true`, { signal: ctrl.signal });
      clearTimeout(timer);
      if (!res.ok) { out.unknown.push(id); continue; }
      const data = await res.json();
      const flat = JSON.stringify(data);
      const m = /"stock"\s*:\s*(\d+)/.exec(flat);
      if (!m) { out.unknown.push(id); continue; }
      const stock = Number(m[1]);
      out.known.push({ lcsc: id, stock });
      if (stock === 0) out.outOfStock.push(id);
    } catch {
      out.unknown.push(id);
    }
  }
  return out;
}

async function runFabricatorDrc(circuitJson) {
  // Surcharge JLCPCB (vias < 0,3 mm) : warning uniquement, jamais bloquant.
  try {
    const { runDrcChecks } = await import("@tscircuit/fabricator-drc");
    const pcbBoardId = getPcbBoardId(circuitJson);
    if (!pcbBoardId) return [];
    const diags = runDrcChecks({ circuitJson, fabricatorPreset: "jlcpcb_economy", pcbBoardId });
    return (Array.isArray(diags) ? diags : []).map((d) => ({
      severity: "warning",
      code: "fabricator_extra_charge",
      message: String(d.message ?? "Surcharge fabricant possible (via < 0,3 mm).").slice(0, 300),
    }));
  } catch (e) {
    return [{ severity: "warning", code: "fabricator_drc_unavailable", message: `Fabricator-DRC indisponible : ${e.message}` }];
  }
}

async function buildPnpOfficial(circuitJson) {
  // PnP officiel (P0-2/P0-5) : lib tscircuit, jamais de CSV aux coordonnées vides.
  // Mode souple transitoire : rotations non résolues = warnings collectés, pas d'exception.
  const rotationWarnings = [];
  const orientationErrors = [];
  let prepared = circuitJson;
  try {
    const { populatePartOrientationMetadata } = await import("circuit-json-to-pnp-csv");
    try {
      prepared = await populatePartOrientationMetadata(circuitJson, {
        supplier: "jlcpcb",
        partsEngineDisabled: true,
      });
    } catch (e) {
      // partsEngine désactivé => la lib lève avec la liste des rotations non vérifiées.
      // On la convertit en warnings (souple), on garde le JSON d'origine.
      const msg = e instanceof Error ? e.message : String(e);
      for (const line of msg.split("\n").slice(0, 20)) {
        const t = line.trim();
        if (t.length > 0) orientationErrors.push(t.slice(0, 300));
      }
      prepared = circuitJson;
    }
  } catch (e) {
    orientationErrors.push(`populatePartOrientationMetadata indisponible : ${e.message}`);
  }
  try {
    const { convertCircuitJsonToPickAndPlaceRows, convertCircuitJsonToPickAndPlaceCsv } = await import(
      "circuit-json-to-pnp-csv"
    );
    const onRotationWarning = (w) => {
      rotationWarnings.push(`${w.designator}: ${w.reason} — ${w.message}`.slice(0, 300));
    };
    const opts = { supplier: "jlcpcb", requireSupplierRotation: false, onRotationWarning };
    const rows = convertCircuitJsonToPickAndPlaceRows(prepared, opts);
    let csv = "";
    try {
      csv = convertCircuitJsonToPickAndPlaceCsv(prepared, { supplier: "jlcpcb", requireSupplierRotation: false });
    } catch (e) {
      // Ne devrait pas arriver en mode souple ; repli CSV manuel depuis rows.
      const header = "Designator,Mid X,Mid Y,Layer,Rotation\n";
      csv = header + rows.map((r) => `${r.designator},${Number(r.mid_x).toFixed(3)},${Number(r.mid_y).toFixed(3)},${r.layer},${r.rotation}`).join("\n") + "\n";
    }
    // Garde-fou anti-faux-vert : coordonnées manquantes = échec explicite.
    const badCoords = rows.filter((r) => !Number.isFinite(r.mid_x) || !Number.isFinite(r.mid_y));
    return { rows, csv, rotationWarnings, orientationErrors, badCoords, tool: `circuit-json-to-pnp-csv ${CONVERTER_PNP_VERSION} (supplier jlcpcb, souple)` };
  } catch (e) {
    return { rows: [], csv: "", rotationWarnings, orientationErrors, badCoords: [], tool: `pnp-échec: ${e.message}`, error: e.message };
  }
}

// ---------- Rapport ----------

function buildReport({ job, g0g3, evalStats, ercParsed, drcParsed, g4, g5pcb, g5pcba, bom, stock, pnp, gerberTool, kicadVersion, warnings, fabricatorWarnings, specsTool }) {
  const lines = [
    `# Rapport de validation — job ${job.id}`,
    ``,
    `- Projet : ${job.project_id} — version n°${job.version_no ?? "?"} (${job.label})`,
    `- Date : ${new Date().toISOString()}`,
    `- Worker : ${WORKER_ID} — image ${KICAD_IMAGE}`,
    `- kicad-cli : ${kicadVersion}`,
    `- tscircuit eval : ${TSCIRCUIT_EVAL_VERSION} / core ${TSCIRCUIT_CORE_VERSION} (overrides racine)`,
    `- convertisseurs : kicad ${CONVERTER_KICAD_VERSION}, gerber ${CONVERTER_GERBER_VERSION}, bom ${CONVERTER_BOM_VERSION}, pnp ${CONVERTER_PNP_VERSION}`,
    `- fabricant : @tscircuit/fabricator-drc ${FABRICATOR_DRC_VERSION} (preset jlcpcb_economy), specs ${JLC_SPECS_COMMIT.slice(0, 7)}`,
    ``,
    `## Gates`,
    ``,
    `- G0–G3 (rappel web) : ${JSON.stringify(g0g3 ?? null)}`,
    `- Composants évalués : ${evalStats.components}, traces : ${evalStats.traces}`,
    `- G4 ERC/DRC : **${g4.status.toUpperCase()}** — ERC exit ${ercParsed.summary.exitCode} (${ercParsed.summary.errors} erreurs, ${ercParsed.summary.warnings} warnings), DRC exit ${drcParsed.summary.exitCode} (${drcParsed.summary.errors} erreurs, ${drcParsed.summary.warnings} warnings)`,
  ];
  for (const f of [...ercParsed.findings, ...drcParsed.findings].slice(0, 20)) {
    lines.push(`  - [${f.severity}] ${f.code} : ${f.message}`);
  }
  lines.push(
    ``,
    `- G5-PCB (PCB nu) : **${g5pcb.status.toUpperCase()}** — Gerber + BOM design + plancher JLCPCB`,
  );
  for (const f of (g5pcb.findings ?? []).slice(0, 20)) {
    lines.push(`  - [${f.severity}] ${f.code} : ${f.message}`);
  }
  lines.push(
    `- G5-PCBA (assemblage, souple) : **${g5pcba.status.toUpperCase()}** — stock/PnP/footprint en avertissement sauf BOM vide, coordonnées PnP et rupture confirmée`,
  );
  for (const f of (g5pcba.findings ?? []).slice(0, 20)) {
    lines.push(`  - [${f.severity}] ${f.code} : ${f.message}`);
  }
  lines.push(
    ``,
    `- BOM : ${bom.rows} lignes (outil : ${bom.tool})`,
    `- Stock revérifié le ${stock.checkedAt} : ${stock.known.length} connus, ${stock.unknown.length} inconnus, ${stock.outOfStock.length} en rupture confirmée`,
  );
  if (stock.outOfStock.length > 0) lines.push(`  - Ruptures : ${stock.outOfStock.join(", ")}`);
  if (stock.unknown.length > 0) lines.push(`  - Stock inconnu (warning, à revérifier avant commande) : ${stock.unknown.slice(0, 20).join(", ")}`);
  lines.push(
    `- PnP officiel : ${pnp.rows} lignes (${pnp.tool}), cohérent : ${pnp.coherent ? "oui" : "NON — " + (pnp.missing ?? []).slice(0, 10).join(", ")}`,
    `- Gerber : ${gerberTool}`,
    `- Specs JLCPCB : ${specsTool}`,
    ...(fabricatorWarnings.length > 0 ? [`- Fabricant : ${fabricatorWarnings.map((w) => w.message).join(" | ").slice(0, 400)}`] : [`- Fabricant : aucun surcoût détecté`]),
    ``,
    `## Warnings`,
    ...(warnings.length > 0 ? warnings.map((w) => `- ${w}`) : ["- aucun"]),
    ``,
    `## Limites assumées (doc 05 §5, à lire avant commande)`,
    ``,
    `- Pas de simulation électrique (SPICE) : un DRC propre peut être électriquement faux.`,
    `- Pas d'intégrité de signal ni d'impédance (hors périmètre D8).`,
    `- Stock/prix JLCPCB valables à l'instant de la revérification uniquement.`,
    `- Rotations PnP JLCPCB en mode souple : vérifier visuellement avant commande (bascule strict après corpus).`,
    `- La première fabrication reste un prototype : petite quantité, test avant série.`,
    `- Validation humaine H2 obligatoire avant export du pack.`,
  );
  return lines.join("\n") + "\n";
}

// ---------- Traitement d'un job ----------

async function claimJob() {
  const { rows } = await pool.query(
    `update validation_jobs set status='running', worker=$1, started_at=now()
     where id=(select id from validation_jobs where status='queued' order by created_at limit 1 for update skip locked)
     returning *`,
    [WORKER_ID]
  );
  return rows.length > 0 ? rows[0] : null;
}

async function failJob(id, message) {
  await pool.query("update validation_jobs set status='error', error=$2, finished_at=now() where id=$1", [id, String(message).slice(0, 2000)]);
}

async function writeArtifact(jobId, projectId, kind, filename, content) {
  const buf = Buffer.isBuffer(content) ? content : Buffer.from(content);
  const id = randomUUID();
  await mkdir(ARTIFACTS_DIR, { recursive: true });
  const safe = filename.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 80) || "artefact";
  await writeFile(join(ARTIFACTS_DIR, `${id}--${safe}`), buf);
  await pool.query(
    "insert into artifacts(id, job_id, project_id, kind, filename, bytes, sha256) values($1,$2,$3,$4,$5,$6,$7)",
    [id, jobId, projectId, kind, filename, buf.length, sha256Hex(buf)]
  );
  return { id, bytes: buf.length };
}

async function zipFiles(files) {
  const zip = new JSZip();
  for (const [p, c] of Object.entries(files)) zip.file(p, c);
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

async function processJob(job) {
  const jobId = job.id;
  const projectId = job.project_id;
  const files = job.files_snapshot ?? {};
  const workdir = join(tmpdir(), `niatolip-${jobId.slice(0, 8)}`);
  await mkdir(workdir, { recursive: true });
  const kicadInfo = await runCmd("kicad-cli", ["--version"]);
  const kicadVersion = `${(kicadInfo.stdout || kicadInfo.stderr).trim()}`.slice(0, 120) || "inconnue";

  // 1. Évaluation tscircuit.
  let circuitJson;
  try {
    circuitJson = await evaluateSnapshot(files, resolveEntrypoint(files));
  } catch (e) {
    await pool.query("update validation_jobs set status='done', error=$2, kicad_version=$3, tscircuit_version=$4, finished_at=now() where id=$1", [
      jobId, `Évaluation tscircuit impossible : ${e.message}`, kicadVersion, TSCIRCUIT_EVAL_VERSION,
    ]);
    log(`job ${jobId} : éval impossible — ${e.message}`);
    return;
  }
  const errCount = circuitJson.filter((el) => typeof el?.type === "string" && el.type.endsWith("_error")).length;
  const evalStats = {
    components: circuitJson.filter((el) => el?.type === "source_component").length,
    traces: circuitJson.filter((el) => el?.type === "source_trace").length,
  };
  if (errCount > 0) {
    await pool.query("update validation_jobs set status='done', error=$2, kicad_version=$3, tscircuit_version=$4, finished_at=now() where id=$1", [
      jobId, `G0 rouge côté worker : ${errCount} erreur(s) tscircuit — corrigez puis relancez.`, kicadVersion, TSCIRCUIT_EVAL_VERSION,
    ]);
    log(`job ${jobId} : G0 rouge (${errCount} erreurs)`);
    return;
  }

  // 2. Export KiCad.
  const { CircuitJsonToKicadSchConverter, CircuitJsonToKicadPcbConverter, CircuitJsonToKicadProConverter } = await import("circuit-json-to-kicad");
  const schConv = new CircuitJsonToKicadSchConverter(circuitJson);
  schConv.runUntilFinished();
  const pcbConv = new CircuitJsonToKicadPcbConverter(circuitJson);
  pcbConv.runUntilFinished();
  const proConv = new CircuitJsonToKicadProConverter(circuitJson, { projectName: "project", schematicFilename: "project.kicad_sch", pcbFilename: "project.kicad_pcb" });
  proConv.runUntilFinished();
  const schPath = join(workdir, "project.kicad_sch");
  const pcbPath = join(workdir, "project.kicad_pcb");
  // P0-6 #28 : normalisation `(power global|local)` → `(power)` pour kicad-cli
  // 9.0.9 (le format v10 est rejeté avec `Failed to load schematic`, exit 3).
  // Les pins rail à 0,01 mm sont innocentes (symboles natifs à `length 0`).
  const rawSch = schConv.getOutputString();
  const { text: normalizedSch, count: powerNormalized } = normalizeKicadSchPower(rawSch);
  await writeFile(schPath, normalizedSch);
  await writeFile(pcbPath, pcbConv.getOutputString());
  await writeFile(join(workdir, "project.kicad_pro"), proConv.getOutputString());
  try {
    for (const f of schConv.getOutputFiles({ schematicFilename: "project.kicad_sch" })) {
      if (f.filename !== "project.kicad_sch") await writeFile(join(workdir, f.filename), f.content);
    }
  } catch { /* hiérarchie optionnelle */ }

  // 3. ERC/DRC.
  const ercRun = await runCmd("kicad-cli", ["sch", "erc", "--format", "json", "--severity-all", "--exit-code-violations", "--output", join(workdir, "erc.json"), schPath], { cwd: workdir });
  const drcRun = await runCmd("kicad-cli", ["pcb", "drc", "--format", "json", "--severity-all", "--exit-code-violations", "--output", join(workdir, "drc.json"), pcbPath], { cwd: workdir });
  let ercRaw = null;
  let drcRaw = null;
  try { ercRaw = JSON.parse(await readFile(join(workdir, "erc.json"), "utf8")); } catch { ercRaw = { note: `erc.json illisible (exit ${ercRun.code})`, stderr: ercRun.stderr.slice(0, 500) }; }
  try { drcRaw = JSON.parse(await readFile(join(workdir, "drc.json"), "utf8")); } catch { drcRaw = { note: `drc.json illisible (exit ${drcRun.code})`, stderr: drcRun.stderr.slice(0, 500) }; }
  const ercParsed = summarizeKicadReport(ercRaw, "erc", ercRun.code);
  const drcParsed = summarizeKicadReport(drcRaw, "drc", drcRun.code);
  const blocking = [
    ...ercParsed.findings.filter((f) => f.severity === "error"),
    ...drcParsed.findings.filter((f) => f.severity === "error"),
  ].slice(0, 20);
  // Doc 05 : seuls les bloquants (erreurs) empêchent G4 — les warnings restent
  // visibles en H2. Les exit codes kicad ne sont décisifs qu'en schéma
  // inattendu (unparsed) : --exit-code-violations compte aussi les warnings.
  const exitGate =
    (ercParsed.summary.unparsed && ercRun.code !== 0) ||
    (drcParsed.summary.unparsed && drcRun.code !== 0);
  const g4 = {
    status: blocking.length === 0 && !exitGate ? "pass" : "fail",
    findings: [...ercParsed.findings, ...drcParsed.findings].slice(0, 20),
    stats: { ercExit: ercRun.code, drcExit: drcRun.code, ercErrors: ercParsed.summary.errors, drcErrors: drcParsed.summary.errors, warnings: ercParsed.summary.warnings + drcParsed.summary.warnings, strictExitGate: exitGate ? 1 : 0 },
  };

  const warnings = [];
  if (powerNormalized > 0) warnings.push(`Schéma KiCad normalisé pour KiCad 9 : ${powerNormalized} occurrence(s) \`(power global|local)\` → \`(power)\` (P0-6 #28, convertisseur circuit-json-to-kicad ${CONVERTER_KICAD_VERSION}).`);
  // Tri hole_clearance (P0-6 #28) : `hole_clearance` < 0,2 mm reste une ERREUR
  // bloquante G4 — c'est la spec JLCPCB publique « Via hole to Track : 0,2 mm »
  // (pas un artefact du convertisseur, pas un warning fabricant). Cause probée :
  // marge obstacle 0,15 du solveur < 0,2 requis ; aucune décote ici.
  if (ercParsed.summary.unparsed || drcParsed.summary.unparsed) warnings.push("Schéma JSON kicad-cli inattendu : violations traitées comme bloquantes (strict).");

  // Artefacts toujours produits : sources + rapport (même en G4 rouge, sans exports finaux).
  const sourcesZip = await zipFiles(files);
  await writeArtifact(jobId, projectId, "sources", "sources.zip", sourcesZip);

  if (g4.status === "fail") {
    const blocked = { status: "fail", findings: [{ severity: "error", code: "g4_blocked", message: "G4 rouge : G5-PCB/G5-PCBA non jugées — corrigez puis relancez." }], stats: { blocked: 1 } };
    const report = buildReport({ job, g0g3: job.g0g3, evalStats, ercParsed, drcParsed, g4, g5pcb: blocked, g5pcba: blocked, bom: { rows: 0, tool: "non calculée (G4 rouge)" }, stock: { checkedAt: new Date().toISOString(), known: [], unknown: [], outOfStock: [] }, pnp: { rows: 0, coherent: false, missing: [], tool: "non calculé (G4 rouge)" }, gerberTool: "non généré (G4 rouge : pas d'exports finaux)", kicadVersion, warnings, fabricatorWarnings: [], specsTool: "non vérifié (G4 rouge)" });
    await writeArtifact(jobId, projectId, "report", "validation-report.md", report);
    try {
      await pool.query(
        "update validation_jobs set status='done', kicad_version=$2, tscircuit_version=$3, erc=$4, drc=$5, g4=$6, g5_pcb=$7, g5_pcba=$8, g5=$9, error=$10, finished_at=now() where id=$1",
        [jobId, kicadVersion, TSCIRCUIT_EVAL_VERSION, JSON.stringify({ summary: ercParsed.summary, exitCode: ercRun.code, stderr: ercRun.stderr.slice(0, 500) }), JSON.stringify({ summary: drcParsed.summary, exitCode: drcRun.code, stderr: drcRun.stderr.slice(0, 500) }), JSON.stringify(g4), JSON.stringify(blocked), JSON.stringify(blocked), JSON.stringify(blocked), `G4 rouge : ${blocking.length} violation(s) bloquante(s) — corrigez puis relancez.`]
      );
    } catch {
      await pool.query(
        "update validation_jobs set status='done', kicad_version=$2, tscircuit_version=$3, erc=$4, drc=$5, g4=$6, g5=$7, error=$8, finished_at=now() where id=$1",
        [jobId, kicadVersion, TSCIRCUIT_EVAL_VERSION, JSON.stringify({ summary: ercParsed.summary, exitCode: ercRun.code, stderr: ercRun.stderr.slice(0, 500) }), JSON.stringify({ summary: drcParsed.summary, exitCode: drcRun.code, stderr: drcRun.stderr.slice(0, 500) }), JSON.stringify(g4), JSON.stringify(blocked), `G4 rouge : ${blocking.length} violation(s) bloquante(s) — corrigez puis relancez.`]
      );
    }
    log(`job ${jobId} : G4 ROUGE (${blocking.length} bloquantes)`);
    return;
  }

  // 4. Exports finaux (G4 vert).
  const kicadOut = await tryKicadExports(pcbPath, workdir);
  const gerberEntries = {};
  let gerberTool = "kicad-cli";
  if (kicadOut.gerbersDir) {
    for (const f of await readdir(kicadOut.gerbersDir)) {
      gerberEntries[`gerbers/${f}`] = await readFile(join(kicadOut.gerbersDir, f));
    }
  }
  if (Object.keys(gerberEntries).length === 0) {
    const lib = await libGerberFiles(circuitJson);
    if (lib.__error || Object.keys(lib).length === 0) {
      warnings.push(`Gerber : échec kicad-cli ET lib (${lib.__error ?? "vide"}) — G5 incertain.`);
      gerberTool = "échec (voir warnings)";
    } else {
      Object.assign(gerberEntries, lib);
      gerberTool = `circuit-json-to-gerber ${CONVERTER_GERBER_VERSION} (repli, kicad-cli en échec)`;
      warnings.push("Gerber : repli lib tscircuit (kicad-cli en échec) — DRC KiCad reste vert, re-export à prévoir.");
    }
  }
  if (kicadOut.drillDir) {
    for (const f of await readdir(kicadOut.drillDir)) {
      gerberEntries[`drill/${f}`] = await readFile(join(kicadOut.drillDir, f));
    }
  }
  const gerberZip = new JSZip();
  for (const [p, c] of Object.entries(gerberEntries)) gerberZip.file(p, c);
  const gerberBuf = await gerberZip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  await writeArtifact(jobId, projectId, "gerber", "gerber.zip", gerberBuf);

  // 5. BOM + stock.
  const parts = parsePartsJson(files);
  const bom = await buildBom(circuitJson, parts);
  const lcscList = parts.map((p) => p?.lcsc).filter((l) => typeof l === "string");
  const stock = await recheckStock(lcscList);

  // 5b. Specs fabricant JLCPCB (plancher) + Fabricator-DRC (surcharge).
  // Inline versionné (paquet github sans dist, voir g5.js) + tentative import.
  let jlcMin = { ...JLC_MIN_INLINE };
  let specsTool = `jlcpcb-manufacturing-specs ${JLC_SPECS_COMMIT.slice(0, 7)} (jlcMinTolerances inline)`;
  try {
    const specs = await import("@tscircuit/jlcpcb-manufacturing-specs");
    if (specs?.jlcMinTolerances) {
      jlcMin = { ...jlcMin, ...specs.jlcMinTolerances };
      specsTool = `jlcpcb-manufacturing-specs ${JLC_SPECS_COMMIT.slice(0, 7)} (jlcMinTolerances)`;
    }
  } catch {
    // Repli silencieux sur l'inline synchronisé (test de sync : g5:fixtures G5-9).
  }
  const specsFindings = checkJlcSpecs(circuitJson, jlcMin);
  const fabricatorWarnings = await runFabricatorDrc(circuitJson);

  // 6. PnP officiel — kicad-cli pos n'est plus utilisé comme source (format
  // fragile) ; il reste un indice de cohérence optionnel.
  const pnpOfficial = await buildPnpOfficial(circuitJson);
  const pnpRows = pnpOfficial.rows;
  const pnpTool = pnpOfficial.tool;
  const pnpRefs = pnpRows.map((r) => r.designator).filter(Boolean);
  if (pnpOfficial.error) warnings.push(`PnP officiel : ${pnpOfficial.error}`);
  for (const w of [...pnpOfficial.rotationWarnings, ...pnpOfficial.orientationErrors].slice(0, 10)) {
    warnings.push(`PnP rotation (souple) : ${w}`);
  }
  // Triple couverture : sources (assemblées : ni testpoints ni DNP) ↔ BOM ↔ PnP.
  const { bomRefs, fittedSources, missingInBom, missingInPnp, extraInPnp } = computeCoverage({ circuitJson, parts, pnpRefs });
  const pnpCoherent = missingInPnp.length === 0 && extraInPnp.length === 0 && pnpRows.length > 0;
  const pnp = { rows: pnpRows.length, coherent: pnpCoherent, missing: [...missingInPnp, ...extraInPnp], tool: pnpTool };
  const pnpCsv = pnpOfficial.csv && pnpOfficial.csv.length > 0 ? pnpOfficial.csv : "Designator,Mid X,Mid Y,Layer,Rotation\n";
  await writeArtifact(jobId, projectId, "pnp", "pnp.csv", pnpCsv);
  await writeArtifact(jobId, projectId, "bom", "bom.csv", bom.csv);

  // 7. Projet KiCad.
  const kicadZip = new JSZip();
  for (const f of await readdir(workdir)) {
    if (/\.(kicad_sch|kicad_pcb|kicad_pro)$/.test(f)) kicadZip.file(f, await readFile(join(workdir, f)));
  }
  await writeArtifact(jobId, projectId, "kicad", "project-kicad.zip", await kicadZip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));

  // 8. Verdicts G5 scindés (P0-2, helpers purs testés : worker/src/g5.js).
  const gerberFailed = gerberTool.startsWith("échec");
  const g5pcb = buildG5Pcb({ bomRefs, missingInBom, gerberFailed, specsFindings, fabricatorWarnings, bomRows: bom.rows });

  const g5pcba = buildG5Pcba({
    parts, bomRefs, missingInPnp, extraInPnp,
    pnpRowCount: pnpRows.length, pnpTool,
    badCoords: pnpOfficial.badCoords ?? [], pnpError: pnpOfficial.error ?? null,
    stock, gerberFailed,
    rotationWarnings: pnpOfficial.rotationWarnings, orientationErrors: pnpOfficial.orientationErrors,
    fabricatorWarnings, bomRows: bom.rows, pnpCoherent: pnp.coherent,
  });
  // Compat : legacy g5 = PCBA (le plus strict historiquement).
  const g5 = g5pcba;

  const report = buildReport({ job, g0g3: job.g0g3, evalStats, ercParsed, drcParsed, g4, g5pcb, g5pcba, bom, stock, pnp, gerberTool, kicadVersion, warnings, fabricatorWarnings, specsTool });
  await writeArtifact(jobId, projectId, "report", "validation-report.md", report);

  try {
    await pool.query(
      "update validation_jobs set status='done', kicad_version=$2, tscircuit_version=$3, erc=$4, drc=$5, g4=$6, g5_pcb=$7, g5_pcba=$8, g5=$9, error=$10, finished_at=now() where id=$1",
      [
        jobId, kicadVersion, TSCIRCUIT_EVAL_VERSION,
        JSON.stringify({ summary: ercParsed.summary, exitCode: ercRun.code }),
        JSON.stringify({ summary: drcParsed.summary, exitCode: drcRun.code }),
        JSON.stringify(g4), JSON.stringify(g5pcb), JSON.stringify(g5pcba), JSON.stringify(g5),
        g5pcb.status === "pass" ? null : `G5-PCB rouge : ${g5pcb.findings.filter((f) => f.severity === "error").length} erreur(s) — voir rapport.`,
      ]
    );
  } catch {
    await pool.query(
      "update validation_jobs set status='done', kicad_version=$2, tscircuit_version=$3, erc=$4, drc=$5, g4=$6, g5=$7, error=$8, finished_at=now() where id=$1",
      [
        jobId, kicadVersion, TSCIRCUIT_EVAL_VERSION,
        JSON.stringify({ summary: ercParsed.summary, exitCode: ercRun.code }),
        JSON.stringify({ summary: drcParsed.summary, exitCode: drcRun.code }),
        JSON.stringify(g4), JSON.stringify(g5),
        g5.status === "pass" ? null : `G5 rouge : ${g5pcba.findings.filter((f) => f.severity === "error").length} erreur(s) — voir rapport.`,
      ]
    );
  }
  log(`job ${jobId} : G4 ${g4.status} / G5-PCB ${g5pcb.status} / G5-PCBA ${g5pcba.status}`);
}

// ---------- Boucle ----------

async function main() {
  log(`démarrage — image ${KICAD_IMAGE}, timeout job ${JOB_TIMEOUT_MS} ms`);
  await mkdir(ARTIFACTS_DIR, { recursive: true });
  while (!stopped) {
    let job = null;
    try {
      job = await claimJob();
    } catch (e) {
      log(`claim impossible : ${e.message}`);
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      continue;
    }
    if (!job) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      continue;
    }
    log(`job ${job.id} réclamé (projet ${job.project_id})`);
    try {
      await Promise.race([
        processJob(job),
        new Promise((_, reject) => setTimeout(() => reject(new Error(`Timeout après ${JOB_TIMEOUT_MS / 60000} min (doc 07 §4).`)), JOB_TIMEOUT_MS)),
      ]);
    } catch (e) {
      log(`job ${job.id} : échec technique — ${e.message}`);
      try {
        await failJob(job.id, e.message);
      } catch (e2) {
        log(`marquage échec impossible : ${e2.message}`);
      }
    }
  }
  log("arrêt demandé — fermeture du pool");
  await pool.end().catch(() => {});
}

main().catch((e) => {
  console.error("[worker] fatal :", e);
  process.exit(1);
});
