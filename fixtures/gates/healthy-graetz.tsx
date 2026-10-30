// Fixture saine — cas de référence doc 12 §7 : nets nommés, une trace par
// pin vers le net. L'autorouteur choisit les points de piquage.
circuit.add(
  <board width="80mm" height="60mm" layers={2}>
    <net name="VRECT" />
    <net name="VCC" />
    <net name="GND" />
    <chip name="BR1" footprint="soic4" pcbX={-25} pcbY={0} schX={-12} schY={0} pinLabels={{ pin1: "pos", pin2: "neg" }} />
    <capacitor name="C1" capacitance="1000uF" footprint="radial0805" pcbX={-5} pcbY={10} schX={-4} schY={6} />
    <chip
      name="U1"
      footprint="sot223"
      pcbX={15}
      pcbY={0}
      schX={6}
      schY={0}
      pinLabels={{ pin1: "VIN", pin2: "GND", pin3: "VOUT" }}
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
