// Fixture G1 — pin mustBeConnected orpheline : G0+G1 rouges natifs.
circuit.add(
  <board width="60mm" height="40mm" layers={2}>
    <chip
      name="U1"
      footprint="soic8"
      pcbX={0}
      pcbY={0}
      schX={0}
      schY={0}
      pinLabels={{ pin1: "A", pin2: "B" }}
      pinAttributes={{ A: { mustBeConnected: true } }}
    />
    <resistor name="R1" resistance="10k" footprint="0805" pcbX={20} pcbY={0} schX={8} schY={0} />
    <trace from=".U1 > .B" to=".R1 > .pin1" />
    <trace from=".R1 > .pin2" to="net.GND" />
  </board>
)
