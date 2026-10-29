// Stub client de `@resvg/resvg-js` (rendu PNG natif, binaire Node).
//
// Contexte : `circuit-json-to-gltf` embarque deux implémentations de
// `svgToPngDataUrl` — une Node (`svg-to-png-XFKMCXOE.js`, via resvg-js
// natif) et une navigateur (`svg-to-png-browser-*.js`, via resvg-wasm,
// chargée en premier avec repli). Turbopack veut résoudre les deux :
// la variante Node exige `fs` et des binaires `.node`, impossibles
// dans le bundle navigateur.
//
// Le M0 n'utilise aucun export PNG (la capture visuelle arrive avec la
// boucle agent, issue #4) : ce stub fait passer le build et lève une
// erreur explicite si le chemin Node est réellement appelé.
export class Resvg {
  constructor() {
    throw new Error(
      "Export PNG natif (resvg-js) non disponible dans le navigateur — hors périmètre M0."
    );
  }
}
