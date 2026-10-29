# WebGPU et NIATOLIP — guide d'activation

> Pourquoi ce document : les viewers PCB et 3D de tscircuit exigent WebGPU. Sans adaptateur WebGPU, l'onglet PCB/3D ne peut pas rendre (message « No WebGPU adapter available »). Ce guide explique comment l'activer — et ce qui reste utilisable sans lui.

## 1. Ce qui exige WebGPU, ce qui s'en passe

| Fonction | WebGPU requis ? | Sans WebGPU |
|---|---|---|
| Onglet PCB (viewer tscircuit) | **Oui** (`@tscircuit/pcb-viewer` lève `No WebGPU adapter available` sinon) | Fallback automatique : aperçu PCB **statique** (SVG via `circuit-to-svg`) |
| Onglet 3D (viewer tscircuit) | **Oui** | Message d'indisponibilité (pas d'équivalent statique en M0) |
| Onglet Schéma | Non (rendu SVG) | Fonctionne normalement |
| Onglet BOM, Validation, évaluation WebWorker | Non | Fonctionnent normalement |

Le schéma, la BOM et la validation restent donc utilisables sur n'importe quelle machine. L'évaluation du circuit (WebWorker `@tscircuit/eval`, ~18 Mo mis en cache au premier chargement) ne dépend pas du GPU.

## 2. Vérifier l'état actuel

1. Ouvrir `chrome://gpu`, chercher **WebGPU** : `Hardware accelerated` = tout est bon.
2. Test de confirmation : [webgpu.github.io/webgpu-samples](https://webgpu.github.io/webgpu-samples/) — si les démos 3D s'affichent, WebGPU fonctionne.
3. Prérequis : Chrome **≥ 113** sur Windows/macOS/ChromeOS (voir `chrome://version`). Sur ces OS, WebGPU est actif par défaut dès que l'accélération matérielle l'est.

## 3. Activer l'accélération matérielle (tous OS)

`chrome://settings/system` → activer **« Utiliser l'accélération graphique lorsqu'elle est disponible »** → **Relancer** Chrome. Sans elle, WebGPU est coupé dans tous les cas.

## 4. Cas particulier Linux

WebGPU est actif par défaut depuis Chrome 113, mais certaines configurations (pilotes, GPU blocklist) exigent un forçage manuel via `chrome://flags` (puis **Relaunch**) :

| Flag | Valeur | Rôle |
|---|---|---|
| `#enable-unsafe-webgpu` | **Enabled** | Lève le blocage WebGPU (plateformes non supportées, GPU blocklisté). Donne au minimum l'adaptateur logiciel SwiftShader |
| `#enable-vulkan` | **Enabled** | Backend Vulkan, indispensable sous Linux (WebGPU s'appuie sur Vulkan) |
| `#ignore-gpu-blocklist` | **Enabled** | Si `chrome://gpu` indique un blocage matériel (« disabled via blocklist ») |
| `#force-high-performance-gpu` | Selon cas | Force le GPU discret (dGPU) quand il n'apparaît pas dans la liste des adaptateurs |

Cas NVIDIA hybride (laptop) : lancer Chrome avec offload explicite, par exemple :
```bash
__NV_PRIME_RENDER_OFFLOAD=1 __GLX_VENDOR_LIBRARY_NAME=nvidia google-chrome --user-data-dir="$HOME/.chrome-webgpu"
```

## 5. Aucun GPU (VM, bureau distant, CI)

WebGPU logiciel via SwiftShader — fonctionnel mais plus lent (acceptable pour nos cartes jouet 2 couches) :
```bash
google-chrome --enable-unsafe-swiftshader
```
Équivalent entreprise (parc géré) : stratégie `EnableUnsafeSwiftShader`.

## 6. Dépannage

| Symptôme | Cause probable | Action |
|---|---|---|
| `No WebGPU adapter available` dans l'onglet PCB/3D | Pas d'adaptateur (GPU absent, désactivé ou blocklisté) | §3, puis §4 (Linux) ou §5 (sans GPU) |
| `WebGPU has been disabled via blocklist` dans `chrome://gpu` | GPU explicitement blocklisté | `#enable-unsafe-webgpu` et/ou `#ignore-gpu-blocklist` |
| Démo webgpu-samples noire, mais `chrome://gpu` OK | Pilote/flags incohérents | Vérifier `#enable-vulkan` (Linux), relancer, tester en navigation privée (sans extensions) |
| Erreurs `easyeda.com … blocked by CORS` dans la console | Moteur de pièces tscircuit cherchant des footprints depuis `localhost` | **Non bloquant** : l'évaluation aboutit quand même. Sera proxifié côté serveur au jalon M1 |
| Lent au premier chargement (~18 Mo) | Téléchargement du worker `@tscircuit/eval` | Normal une seule fois (mis en cache ensuite) ; rechargement forcé (Ctrl+Maj+R) contourne le cache |

Note : `http://localhost:3000` est un [contexte sécurisé](https://developer.chrome.com/docs/web-platform/webgpu/troubleshooting-tips) — WebGPU y est autorisé comme en `https`.

## Sources (vérifiées octobre 2026)

- [WebGPU troubleshooting — Chrome for Developers](https://developer.chrome.com/docs/web-platform/webgpu/troubleshooting-tips) (accélération, versions minimales, flags `enable-unsafe-webgpu`/`enable-vulkan`, contextes sécurisés)
- `chrome://flags` : `#enable-unsafe-webgpu`, `#enable-vulkan`, `#ignore-gpu-blocklist`
- Stratégie entreprise [`EnableUnsafeSwiftShader`](https://chromeenterprise.google/policies/enable-unsafe-swift-shader)
- Vérifié localement : Chrome 156, viewer tscircuit exigeant WebGPU (`pcb-viewer` lève sans adaptateur), schéma/BOM/validation indépendants du GPU
