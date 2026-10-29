# Architecture technique — NIATOLIP

| Version | 1.0 — 2026-10-29 |
|---|---|
| Décisions sources | `README.md` D1–D9, PRD `00-PRD.md` |

---

## 1. Vue d'ensemble

```
┌──────────────────────────────────────────────────────────────┐
│ Navigateur                                                    │
│  ┌────────────────────┐   ┌───────────────────────────────┐  │
│  │ Panneau Agent      │   │ Panneau Preview               │  │
│  │ - useChat (AI SDK) │   │ - @tscircuit/runframe         │  │
│  │ - étapes / outils  │   │   onglets PCB/Schéma/3D/BOM   │  │
│  │ - gates H1 / H2    │   │ - erreurs d'exécution         │  │
│  └─────────┬──────────┘   └──────────────▲────────────────┘  │
│            │ streaming                    │ fsMap (fichiers)   │
│            │                     ┌────────┴────────────────┐  │
│            │                     │ @tscircuit/eval         │  │
│            │                     │ WebWorker (isolé)       │  │
│            │                     │ → Circuit JSON + erreurs│  │
│            │                     └─────────────────────────┘  │
└────────────┼─────────────────────────────────────────────────┘
             │ HTTPS / streaming
┌────────────▼─────────────────────────────────────────────────┐
│ Serveur applicatif (Next.js)                                  │
│  - /api/chat : ToolLoopAgent (AI SDK)                         │
│  - Abstraction modèle : Meta Model API | OpenAI               │
│  - Outils agent (Zod) : fichiers, composants, checks, exports │
│  - Persistance : projets, versions, runs, artefacts           │
└───────┬──────────────────┬───────────────────┬───────────────┘
        │                  │                   │
        ▼                  ▼                   ▼
┌───────────────┐ ┌─────────────────┐ ┌────────────────────────┐
│ Base de       │ │ APIs externes   │ │ Worker validation      │
│ données +     │ │ - Meta Model API│ │ (conteneur séparé)     │
│ stockage      │ │ - OpenAI        │ │ - export KiCad         │
│ fichiers      │ │ - jlcsearch     │ │ - kicad-cli ERC/DRC    │
│               │ │   (JLCPCB)      │ │ - génération Gerber/   │
│               │ │                 │ │   BOM/PnP finaux       │
└───────────────┘ └─────────────────┘ └────────────────────────┘
```

## 2. Principes directeurs

1. **Une seule source de vérité par projet : le code tscircuit** (fichiers du projet). Circuit JSON, KiCad et Gerber sont des artefacts dérivés, régénérables.
2. **Le navigateur exécute, le serveur orchestre.** L'évaluation tscircuit tourne dans le WebWorker du navigateur (rapide, isolé, gratuit). L'agent tourne côté serveur (clés API protégées).
3. **Les outils métier d'abord, MCP ensuite.** Les capacités sont des fonctions typées appelées par l'agent ; un serveur MCP pourra les réexposer plus tard sans réécriture.
4. **Aucune validation lourde sur le serverless.** KiCad n'existe pas dans un runtime serverless classique : la gate finale vit dans un worker conteneurisé avec file d'attente.
5. **Tout run est rejouable.** Entrées, modèle, versions d'outils et résultats sont journalisés (NFR-05).

## 3. Composants

### 3.1 Frontend (Next.js, React)

| Élément | Responsabilité |
|---|---|
| Panneau Agent | `useChat` de `@ai-sdk/react`, rendu des `parts` (texte, appels d'outils, approbations), boutons de gate H1/H2, bouton d'arrêt iconographique. UI construite avec **shadcn/ui** (Radix + Tailwind) et icônes **Lucide** — voir doc 06 §7 |
| Panneau Preview | `RunFrame` de `@tscircuit/runframe` avec `fsMap` = fichiers courants du projet ; onglets PCB/Schéma/3D/BOM ; affichage des erreurs remontées par `onError` / événements |
| État fichiers | Le frontend détient le `fsMap` courant ; chaque écriture de l'agent (reçue via le flux d'outils) met à jour le `fsMap` et déclenche la réévaluation |
| Évaluation | `@tscircuit/eval` (`createCircuitWebWorker`) dans le panneau preview ; le résultat (Circuit JSON + erreurs) est renvoyé au serveur comme contexte d'outil à l'étape suivante |

Point d'attention : le modèle ne doit jamais recevoir le Circuit JSON complet (trop volumineux). Il reçoit des résumés (netlist lisible, liste d'erreurs, métriques) — voir doc 03.

Alternative preview : iframe `runframe` hébergée (protocole `postMessage`) si l'intégration React pose problème. Décision par défaut : **intégration React directe**, iframe en repli.

### 3.2 Serveur applicatif (Next.js API routes)

| Route / module | Responsabilité |
|---|---|
| `/api/chat` | Point d'entrée agent : `ToolLoopAgent` ou `streamText` avec `stopWhen`, outils, streaming UI (`toUIMessageStream`), approbations d'outils |
| `lib/models.ts` | Abstraction provider Meta/OpenAI (doc 02) — seul endroit qui connaît les clés et les IDs de modèles |
| `lib/tools/*` | Implémentation des outils agent (doc 03) |
| `lib/projects.ts` | CRUD projets, versions de fichiers, snapshots |
| `lib/runs.ts` | Journalisation des runs/étapes/appels d'outils, budgets, annulation |
| `/api/exports/*` | Création d'un job d'export, statut, téléchargement du pack |
| Worker validation | Job asynchrone : export KiCad → `kicad-cli` ERC/DRC → exports fabrication → rapport |

### 3.3 Worker validation (conteneur) — où vit `kicad-cli`

**Réponse courte : `kicad-cli` ne vit jamais sur le PC de l'utilisateur.** C'est un binaire en ligne de commande fourni avec KiCad ; il est installé **uniquement dans l'image Docker du worker**, côté serveur. L'utilisateur final n'installe ni KiCad, ni Docker, ni Node — il ouvre une URL.

- Image Docker épinglée : KiCad (`kicad-cli`) + Node/tscircuit CLI + scripts d'export.
- Entrée : snapshot des fichiers du projet (version précise).
- Sorties : rapport ERC/DRC JSON, Gerber.zip, BOM.csv, PnP.csv, projet KiCad, statut de gate G4/G5 (doc 05).
- Exécution **asynchrone avec file d'attente** : l'agent demande l'export, le run se met en attente du résultat, l'utilisateur voit la progression.
- Déploiement (décision Q1) : le worker est un **service du `docker-compose.yml` du projet**, au même titre que le web et la base. En phase hébergée ultérieure, la même composition sera déployée sur notre infrastructure (VPS ou plateforme de conteneurs) ; E2B/Daytona ne sont réévalués que si le volume de jobs l'exige.

Pourquoi Docker est le bon choix ici :

| Critère | Docker (retenu) | Installation native KiCad chez l'utilisateur ou sur le serveur |
|---|---|---|
| Friction utilisateur | Nulle en mode hébergé : zéro installation | Inacceptable : demander d'installer KiCad contredit le produit « tout-en-un » |
| Reproductibilité | Version KiCad épinglée dans l'image ; même DRC partout | Versions différentes selon les machines → DRC non reproductibles |
| Sécurité | Conteneur isolé, sans réseau sortant, quotas CPU/RAM (les fichiers traités sont non fiables) | Le binaire tournerait avec les droits du serveur applicatif |
| Une seule commande | Oui en auto-hébergement : `docker compose up` (voir §3.4) | Non : dépendances système à gérer à la main |

À noter : KiCad n'est **pas** embarqué dans l'image Next.js (image lourde, cycle de vie différent). Le worker est un service séparé, scalable indépendamment.

### 3.4 Modes de lancement — « une seule commande »

| Mode | Pour qui | Commande / action | Ce qui tourne |
|---|---|---|---|
| **B — Auto-hébergé / développement (construit en premier, décision Q1)** | Nous, contributeurs, clients on-premise, premiers testeurs | `docker compose up --build` à la racine du dépôt (prérequis unique : Docker installé) | Services `web` (Next.js), `worker` (KiCad + tscircuit CLI), `db` (Postgres), volumes pour projets/artefacts |
| **A — Hébergé (phase ultérieure)** | Les utilisateurs finaux | Ouvrir l'URL du produit | Rien chez l'utilisateur ; la même composition Docker tourne sur notre infrastructure |

Le fichier `docker-compose.yml` (à créer au M1) est la seule procédure d'installation documentée du mode B. Aucune étape « installez KiCad puis… » ne doit exister dans la documentation utilisateur ou développeur. Le mode A ne demande aucun développement spécifique au-delà du déploiement de cette même composition et de l'ajout de l'auth (décision Q2).

### 3.5 Données

Voir `07-DATA-API.md`. Résumé : Postgres (projets, messages, runs) + stockage objet ou disque pour fichiers/artefacts. Pour le tout premier prototype local, SQLite + dossier `projects/` sont acceptables, à condition de ne pas coder contre cette hypothèse.

## 4. Flux principal d'un run

```
Utilisateur envoie un message
  → /api/chat reçoit l'historique + l'état projet (version fichiers)
  → ToolLoopAgent démarre (modèle choisi, budget)
      boucle :
        modèle → appel(s) d'outil
        outil exécuté (serveur ou demandé au client : eval/snapshot)
        résultat structuré → réinjecté au modèle
      jusqu'à : réponse finale | gate humaine | budget épuisé | annulation
  → le flux UI met à jour chat + fsMap → preview se réévalue
  → le run est journalisé (étapes, coûts, résultats de checks)
```

Les outils « client » (évaluation WebWorker, snapshot d'image) sont exécutés côté navigateur et leur résultat est renvoyé au serveur dans le flux de conversation. C'est ce qui évite de devoir exécuter tscircuit côté serveur à chaque itération.

## 5. Sécurité (résumé — détails doc 09)

- Clés Meta/OpenAI : variables d'environnement serveur uniquement.
- Code tscircuit de l'utilisateur : exécuté uniquement dans le WebWorker/iframe isolée, jamais par `eval` sur le thread principal, jamais côté serveur sans bac à sable.
- Le worker KiCad traite des fichiers non fiables : conteneur sans accès réseau sortant par défaut, quotas CPU/RAM/temps.
- Actions sensibles derrière approbation AI SDK (`toolApproval`) : export fabrication final — et aucun outil d'achat n'existe.

## 6. Environnements et versionnement

| Élément | Règle |
|---|---|
| tscircuit et ses packages (`core`, `eval`, `runframe`, CLI) | Versions **épinglées** dans le lockfile ; montée de version = PR dédiée + corpus de régression vert |
| KiCad du worker | Version épinglée dans l'image Docker ; notée dans chaque rapport de validation |
| Modèles IA | IDs configurables par variables d'environnement (doc 02), jamais codés en dur dans les composants |
| Prompts système | Versionnés dans le dépôt (`lib/prompts/`), toute modification est une PR relue |

## 7. Ce que l'architecture exclut volontairement (MVP)

- Pas de microservices : un Next.js + un worker suffisent.
- Pas de LangGraph : la boucle AI SDK couvre le besoin (réévaluer si runs longs/reprise deviennent un problème — critère dans doc 09).
- Pas de WebContainers : incompatible avec la toolchain native (KiCad) et licence commerciale en production.
- Pas d'exécution tscircuit systématique côté serveur : redondante avec le WebWorker, réservée au worker d'export.
