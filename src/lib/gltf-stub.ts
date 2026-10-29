// Stub client de `circuit-json-to-gltf` (export STEP/GLB : occt + resvg natifs).
//
// La conversion STEP/GLB tire `occt-import-js` (WASM émulé via `?url`,
// convention Vite incomprise par Turbopack) et `resvg-js` (binaire Node).
// Le M0 n'exporte ni STEP ni GLB (aucun bouton dans l'UI : un seul onglet
// affiché, menu fichier masqué) : ce stub fait passer le build et lève
// une erreur explicite si le chemin est réellement appelé.
export async function convertCircuitJsonTo3D(): Promise<never> {
  throw new Error(
    "Export STEP/3D (circuit-json-to-gltf) non disponible dans la preview M0."
  );
}
