# Données et API — NIATOLIP

> **Statut V2 (2026-10-30) — partiellement supersédé.** Le stockage cible devient le **dossier projet source de vérité** (décision D19, [`15-PLAN-REFONTE-V2.md`](./15-PLAN-REFONTE-V2.md) §6.2) ; les tables `runs`/`component_cache` décrites ici n'existent pas dans le code, et le worker accède directement à la base contrairement à l'ancien contrat (question ouverte doc 15 §10). Ce document décrit l'état actuel tant que la phase P3 n'est pas implémentée. Réécriture prévue en P3.

| Version | 1.0 — 2026-10-29 |
|---|---|
| Dépend de | `01-ARCHITECTURE.md`, `03-AGENT-TOOLS-LOOP.md` |

---

## 1. Modèle de données (minimal MVP)

Base relationnelle (Postgres cible ; SQLite acceptable en prototype local). Les fichiers de projet sont stockés comme **contenus versionnés** (table ou stockage objet), jamais uniquement sur un disque éphémère du serveur web.

| Table | Champs essentiels | Notes |
|---|---|---|
| `users` | `id`, `email`, `created_at` | **Préparée mais non utilisée au prototype** (décision Q2 : pas de compte) ; activée avant le lancement public/hébergé. En mode prototype, l'application tourne en mono-utilisateur local et `user_id` vaut une valeur fixe |
| `projects` | `id`, `user_id`, `name`, `created_at`, `updated_at`, `current_version_id` | |
| `project_versions` | `id`, `project_id`, `version_no`, `label`, `created_from_run_id`, `created_at` | Un point de restauration = une version (doc 03 §5) |
| `project_files` | `version_id`, `path`, `content`, `content_hash` | Snapshot immuable par version ; la « version courante » est éditable via une copie de travail |
| `conversations` | `id`, `project_id`, `created_at` | Une conversation active par projet au MVP |
| `messages` | `id`, `conversation_id`, `role`, `ui_message_json`, `created_at` | Format `UIMessage` AI SDK sérialisé tel quel |
| `runs` | `id`, `project_id`, `conversation_id`, `model_choice`, `model_id`, `status` (running/waiting_approval/completed/failed/cancelled/budget_exceeded), `steps_used`, `tokens_in`, `tokens_out`, `cost_estimate`, `started_at`, `ended_at`, `stop_reason` | Supporte NFR-05/NFR-06 |
| `run_steps` | `id`, `run_id`, `step_no`, `tool_name`, `input_json` (tronqué), `output_summary_json`, `status`, `duration_ms`, `created_at` | Alimente le fil d'exécution UX ; pas de secrets ni de contenus complets |
| `approvals` | `id`, `project_id`, `gate` (H1/H2), `approved`, `job_id?`, `reason?`, `created_at` | **P0-3 (issue #14)** : vérité serveur H1/H2 — l'outil agent enregistre sur approbation explicite, l'export validé exige une H2 postérieure au job |
| `validation_jobs` | `id`, `project_id`, `version_id`, `status`, `kicad_version`, `tscircuit_version`, `erc_report_json`, `drc_report_json`, `created_at`, `finished_at` | Jobs du worker (G4/G5) |
| `artifacts` | `id`, `project_id`, `version_id`, `job_id?`, `kind` (gerber/bom/pnp/kicad/sources/report), `storage_key`, `sha256`, `created_at` | Téléchargement via URL signée ou route authentifiée |
| `component_cache` | `lcsc_id`, `mpn`, `description`, `package`, `stock`, `price`, `is_basic`, `footprint_hint`, `fetched_at` | Cache jlcsearch avec TTL court (stock volatile : 15 min par défaut, revérifié en G5) |

## 2. Règles de versionnement projet

- Chaque écriture de l'agent pendant un run modifie la copie de travail.
- Une version est figée automatiquement quand : G3 passe vert, ou l'utilisateur approuve H1/H2, ou l'utilisateur clique « créer un point de restauration ».
- L'export fabrication référence toujours un `version_id` précis — jamais « l'état courant » implicite.
- Retour arrière : restaurer une version = nouvelle version copiée (historique jamais réécrit).

## 3. API (Next.js routes)

| Route | Méthode | Rôle |
|---|---|---|
| `/api/chat` | POST (streaming) | Run agent (AI SDK `useChat` transport) : corps = messages + `projectId` + `modelChoice` |
| `/api/projects` | GET / POST | Liste et création de projets |
| `/api/projects/:id` | GET / PATCH / DELETE | Détail, renommage, suppression |
| `/api/projects/:id/files` | GET | `fsMap` courant (alimente RunFrame) |
| `/api/projects/:id/versions` | GET / POST | Liste des versions ; création d'un point de restauration |
| `/api/projects/:id/versions/:vid/restore` | POST | Restauration |
| `/api/projects/:id/validate` | POST | Crée un `validation_job` (worker KiCad) pour une version — **P0-3** : `g0g3` recalculé serveur, `409 gates_not_green` si rouge (ni version ni job créés) |
| `/api/projects/:id/approvals` | GET / POST | **P0-3** : vérité serveur H1/H2 (`{ gate: H1|H2, approved, jobId?, reason? }`) — l'export validé exige une H2 postérieure au job |
| `/api/validation-jobs/:id` | GET | Statut + rapports ERC/DRC |
| `/api/projects/:id/export` | POST | Génère le pack fabrication (après H2) ; renvoie les artefacts |
| `/api/artifacts/:id/download` | GET | Téléchargement authentifié d'un artefact |
| `/api/models` | GET | Liste des choix de modèles exposés à l'UI (IDs résolus côté serveur, aucune clé) |

Contrats :

- Au prototype (mono-utilisateur, pas d'auth) : pas de contrôle d'appartenance, l'API n'est exposée qu'en local via Docker Compose. Dès l'activation de l'auth (avant tout hébergement public), toute route doit vérifier que le projet appartient à l'utilisateur — ce contrôle fait partie des critères de sortie du passage en mode hébergé.
- Les erreurs sont renvoyées en JSON structuré `{ error: { code, message } }` ; les erreurs « métier PCB » (gate rouge) ne sont **pas** des erreurs HTTP : ce sont des résultats.
- Le streaming `/api/chat` suit le protocole UI de l'AI SDK ; les résultats des outils exécutés côté client (évaluation, snapshot) transitent par le mécanisme de tool results du flux de conversation.

## 4. Communication avec le worker validation

- File simple au MVP : table `validation_jobs` + poller côté worker (ou file Redis si déjà disponible). Pas de bus d'événements.
- Le worker reçoit : `version_id` + snapshot des fichiers (archive). Il ne lit jamais la base directement.
- Timeout job : 10 min ; au-delà, job en échec technique (relançable).
- Le résultat du job est écrit via une route interne authentifiée par secret partagé (ou signature), jamais exposée publiquement.
- L'agent obtient le résultat par l'outil `getValidationResult` qui lit l'état du job (attente bornée puis rendu de l'état « en cours » à l'utilisateur).

## 5. Persistance des runs et observabilité

- Chaque run conserve : modèle exact, versions d'outils (tscircuit, KiCad), prompt système (version ou hash), étapes et résumés d'outils, coûts.
- Objectif : pouvoir rejouer un échec du corpus de régression à l'identique (doc 08).
- Rétention MVP : tout est conservé tant que le projet existe ; la suppression d'un projet supprime fichiers, messages, runs et artefacts associés.

## 6. Ce qui n'est pas stocké

- Les clés API des fournisseurs (variables d'environnement serveur uniquement).
- Le Circuit JSON complet par défaut : régénérable depuis les sources ; seuls des résumés/statistiques sont persistés (les snapshots image utiles à la revue H2 peuvent être conservés comme artefacts légers).
- Aucune donnée envoyée aux variantes Meta `-contributor` (interdites, D9).
