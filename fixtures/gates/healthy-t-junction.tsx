// Fixture saine — jonction en T (doc 12 §2) : l'ancien G1/G3 maison la
// punissait à tort ; le natif doit être G0–G3 vert.
circuit.add(
  <board width="60mm" height="40mm" layers={2}>
    <resistor name="R1" resistance="10k" footprint="0805" pcbX={-20} pcbY={0} schX={-8} schY={0} />
    <resistor name="R2" resistance="10k" footprint="0805" pcbX={20} pcbY={0} schX={8} schY={0} />
    <resistor name="R3" resistance="10k" footprint="0805" pcbX={0} pcbY={15} schX={0} schY={8} />
    <trace from=".R1 > .pin2" to=".R2 > .pin1" />
    <trace from=".R1 > .pin2" to=".R3 > .pin1" />
  </board>
)
