// Stub client de `altiumts` (lecture/écriture binaire Altium).
//
// Le paquet `altiumts@0.0.59` publié sur npm est vide (pas de dist) et la
// compilation depuis GitHub sort du périmètre M0. L'export Altium n'est
// exposé nulle part dans l'UI M0 (menu fichier masqué, un seul onglet) :
// ce stub fait passer le build et lève une erreur explicite si le chemin
// est réellement appelé. Liste exhaustive des noms importés par
// `circuit-json-to-altium` — tout ajout upstream doit être répercuté ici.

function unavailable(name: string): never {
  throw new Error(`Altium (altiumts.${name}) non disponible dans la preview M0.`);
}

export class AltiumSchDoc {
  constructor() {
    unavailable("AltiumSchDoc");
  }
}

export type AltiumRecord = unknown;
export type AltiumSchematicEmbeddedImageInput = unknown;

export function parseAltiumFile(): never {
  unavailable("parseAltiumFile");
}

export function parseAltiumPcbDoc(): never {
  unavailable("parseAltiumPcbDoc");
}

export function parseAltiumBinaryPcbDoc(): never {
  unavailable("parseAltiumBinaryPcbDoc");
}

export function parseAltiumSchDoc(): never {
  unavailable("parseAltiumSchDoc");
}

export function parseAltiumPrjPcb(): never {
  unavailable("parseAltiumPrjPcb");
}

export function sanitizeAltiumFieldText(): never {
  unavailable("sanitizeAltiumFieldText");
}

export function serializeAltiumPcbDocToBinary(): never {
  unavailable("serializeAltiumPcbDocToBinary");
}

export function serializeAltiumSchDocToBinary(): never {
  unavailable("serializeAltiumSchDocToBinary");
}
