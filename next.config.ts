import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // circuit-json-to-altium est publié en sources TS (pas de dist).
  transpilePackages: ["circuit-json-to-altium"],
  // @tscircuit/eval en require() natif côté serveur : bundlé, le
  // CircuitRunner lève "Cannot read properties of undefined" (issue #4).
  // Le client (WebWorker via blob URL) reste bundlé normalement.
  serverExternalPackages: ["@tscircuit/eval", "@tscircuit/core"],
  // Turbopack stable (Next 16) : `experimental.turbo` est ignoré.
  turbopack: {
    resolveAlias: {
      // resvg-js natif (fs + binaires .node) : voir resvg-stub.ts.
      "@resvg/resvg-js": "./src/lib/resvg-stub.ts",
      // occt WASM + resvg via gltf : voir gltf-stub.ts.
      "circuit-json-to-gltf": "./src/lib/gltf-stub.ts",
      // paquet npm vide (pas de dist) : voir altium-stub.ts.
      "altiumts": "./src/lib/altium-stub.ts",
    },
  },
};

export default nextConfig;
