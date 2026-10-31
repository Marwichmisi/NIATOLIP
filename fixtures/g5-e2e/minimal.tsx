// Fixture E2E G5 — carte minimale 100 % CMS, SANS nets nommés, SANS vias attendus.
// Pourquoi pas le Graetz (doc 12 §7) : le convertisseur circuit-json-to-kicad
// émet les symboles d'alimentation `Custom:rail_up/down` avec des pins de
// longueur 0,01 mm, que kicad-cli 9.0.9 refuse de charger (« Failed to load
// schematic », exit 3) — aucun job à nets nommés ne peut passer G4-ERC en
// l'état (limitation G4 pré-existante, hors P0-2, voir docs/05 §3).
// Cette carte prouve le pipeline G5 complet (Gerber/BOM/PnP officiel/specs).
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
