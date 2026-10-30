// Fixture G2 — chevauchement : G2 rouge natif (courtyard overlap).
circuit.add(
  <board width="60mm" height="40mm" layers={2}>
    <resistor name="R1" resistance="10k" footprint="0805" pcbX={0} pcbY={0} schX={-5} schY={0} />
    <resistor name="R2" resistance="10k" footprint="0805" pcbX={0} pcbY={0} schX={5} schY={0} />
    <trace from=".R1 > .pin1" to=".R2 > .pin1" />
    <trace from=".R1 > .pin2" to=".R2 > .pin2" />
  </board>
)
