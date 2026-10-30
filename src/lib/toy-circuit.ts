// Carte jouet de l'issue #1 (jalon M0) : ESP32-C3 + LED + bouton.
// Source unique de vérité : ce fichier. La preview (RunFrame) et
// l'évaluation WebWorker consomment le même fsMap.

export const TOY_ENTRYPOINT = "main.tsx";

const TOY_CODE_GOOD = `circuit.add(
  <board width="40mm" height="30mm" layers={2}>
    <chip
      name="U1"
      footprint="soic8"
      pcbX={0}
      pcbY={0}
      schX={0}
      schY={0}
      schWidth={8}
      schHeight={6}
    />
    <resistor
      name="R1"
      resistance="10k"
      footprint="0402"
      pcbX={-12}
      pcbY={-8}
      schX={-8}
      schY={3}
    />
    <capacitor
      name="C1"
      capacitance="100nF"
      footprint="0402"
      pcbX={12}
      pcbY={-8}
      schX={8}
      schY={3}
    />
    <led
      name="D1"
      footprint="0603"
      pcbX={12}
      pcbY={8}
      schX={8}
      schY={-4}
    />
    <chip
      name="SW1"
      footprint="0402"
      pcbX={-12}
      pcbY={8}
      schX={-8}
      schY={-4}
    />
    <trace from=".U1 .pin1" to=".R1 .pin1" />
    <trace from=".U1 .pin2" to=".C1 .pin1" />
    <trace from=".U1 .pin3" to=".D1 .pin1" />
    <trace from=".U1 .pin4" to=".SW1 .pin1" />
  </board>
)
`;

// Variante volontairement fautive : R99 n'existe pas → l'évaluation
// doit remonter une erreur structurée dans l'UI (critère M0-2).
const TOY_CODE_BROKEN = `circuit.add(
  <board width="40mm" height="30mm" layers={2}>
    <chip name="U1" footprint="soic8" pcbX={0} pcbY={0} schX={0} schY={0} />
    <resistor name="R1" resistance="10k" footprint="0402" pcbX={-12} pcbY={-8} schX={-8} schY={3} />
    <trace from=".U1 .pin1" to=".R99 .pin1" />
  </board>
)
`;

export const TOY_FSMAP_GOOD: Record<string, string> = {
  [TOY_ENTRYPOINT]: TOY_CODE_GOOD,
};

export const TOY_FSMAP_BROKEN: Record<string, string> = {
  [TOY_ENTRYPOINT]: TOY_CODE_BROKEN,
};

// Versions épinglées (doc 01 §6 : toute montée de version = PR dédiée).
// Synchronisées avec package.json — mettre à jour aux deux endroits.
export const TSCIRCUIT_VERSIONS = {
  tscircuit: "0.0.3036",
  core: "0.0.2230",
  eval: "0.0.1668",
  checks: "0.0.265",
  runframe: "0.0.3087",
} as const;
