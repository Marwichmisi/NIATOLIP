// Fixture E2E G5 — carte minimale 100 % CMS, SANS nets nommés, SANS vias attendus.
// Historique P0-6 #28 : ce board servait de board d'évitement tant que le
// convertisseur émettait `(power global)` (rejeté par kicad-cli 9.0.9 —
// rationnel dans `normalizeKicadSchPower`, worker/src/g5.js). Depuis la
// normalisation worker, la preuve E2E porte sur le Graetz à nets nommés
// (scripts/g5-e2e.ts). Cette carte reste un smoke-test pipeline G5.
circuit.add(
  <board width="20mm" height="20mm" layers={2}>
    <resistor
      name="R1"
      resistance="1k"
      footprint="0603"
      pcbX={-3}
      pcbY={0}
      schX={-4}
      schY={0}
    />
    <led
      name="D1"
      footprint="0603"
      pcbX={3}
      pcbY={0}
      schX={4}
      schY={0}
    />
    <trace from=".R1 > .pin2" to=".D1 > .anode" />
    <trace from=".R1 > .pin1" to=".D1 > .cathode" />
  </board>
)
