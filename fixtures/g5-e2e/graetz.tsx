// Fixture E2E G4/G5 — Graetz COMPLET pour ERC KiCad (P0-6 #28).
// Dérivée de fixtures/gates/healthy-graetz.tsx (référence G0–G3 doc 12 §7,
// INCHANGÉE) + 3 compléments EXCLUSIVEMENT ERC/DRC, sans changer la topologie :
// - BR1.pos providesPower (le + du pont alimente VRECT) + U1.VOUT providesPower
//   + U1.GND providesGround (pinAttributes) : chaque net de puissance a une
//   source → les pins rail `power_in` du convertisseur sont drivées
//   (fini les `power_pin_not_driven`). Le convertisseur mappe provides_power
//   vers des pins `power_out` KiCad (getKicadPinElectricalType).
// - BR1 pin3/pin4 + U1 pin4 (tab) en doNotConnect : entrées AC et tab non
//   câblées SUR CE BOARD DE PREUVE (la référence G0–G3 les laisse flotter) ;
//   marqueur `no_connect` explicite au lieu de flottant implicite — à relier
//   selon datasheet pour un vrai produit (pont AC + tab thermique).
// - Topologie, valeurs, placements : identiques à la référence.
// - WS3 (hole_clearance, P0-6 #28) : l'autorouteur sous-respecte par endroits
//   la marge obstacle 0,2 mm requise (repli interne 0,15 — bug upstream, les
//   checks natifs `@tscircuit/checks` sont aveugles aux trous de via :
//   `getHoleGeometries` ne voit que `pcb_hole`, jamais `pcb_via`). Le board
//   passe donc en 90×70 mm (contre 80×60 pour la référence G0–G3) pour aérer
//   le routage ; `traceClearance` n'a eu aucun effet mesuré et n'est pas utilisé.
circuit.add(
  <board width="90mm" height="70mm" layers={2}>
    <net name="VRECT" />
    <net name="VCC" />
    <net name="GND" />
    <chip
      name="BR1"
      footprint="soic4"
      pcbX={-25}
      pcbY={0}
      schX={-12}
      schY={0}
      pinLabels={{ pin1: "pos", pin2: "neg" }}
      pinAttributes={{
        pos: { providesPower: true },
        pin3: { doNotConnect: true },
        pin4: { doNotConnect: true },
      }}
    />
    <capacitor name="C1" capacitance="1000uF" footprint="radial0805" pcbX={-5} pcbY={10} schX={-4} schY={6} />
    <chip
      name="U1"
      footprint="sot223"
      pcbX={15}
      pcbY={0}
      schX={6}
      schY={0}
      pinLabels={{ pin1: "VIN", pin2: "GND", pin3: "VOUT" }}
      pinAttributes={{
        VOUT: { providesPower: true },
        GND: { providesGround: true },
        pin4: { doNotConnect: true },
      }}
    />
    <resistor name="RLED" resistance="1k" footprint="0603" pcbX={30} pcbY={10} schX={14} schY={6} />
    <led name="D1" footprint="0603" pcbX={30} pcbY={-10} schX={14} schY={-6} />
    <trace from=".BR1 > .pos" to="net.VRECT" />
    <trace from=".C1 > .pos" to="net.VRECT" />
    <trace from=".U1 > .VIN" to="net.VRECT" />
    <trace from=".BR1 > .neg" to="net.GND" />
    <trace from=".C1 > .neg" to="net.GND" />
    <trace from=".U1 > .GND" to="net.GND" />
    <trace from=".U1 > .VOUT" to="net.VCC" />
    <trace from=".RLED > .pin1" to="net.VCC" />
    <trace from=".RLED > .pin2" to=".D1 > .anode" />
    <trace from=".D1 > .cathode" to="net.GND" />
  </board>
)
