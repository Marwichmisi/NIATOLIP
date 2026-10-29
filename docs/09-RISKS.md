# Risques, sécurité et conformité — NIATOLIP

| Version | 1.0 — 2026-10-29 |
|---|---|
| Revue | À relire à chaque porte de jalon (M0–M3). Tout risque qui se réalise devient un incident documenté + une mesure dans le doc concerné. |

---

## 1. Risques produit et techniques

| # | Risque | Probabilité / impact | Mitigation |
|---|---|---|---|
| R-01 | Le placement/routage automatique plafonne : cartes « DRC propres » mais médiocres ou non routées au-delà d'une faible complexité | Élevée / Élevé | Périmètre étroit D7 ; placement avant routage (G2) ; templates vérifiés ; revue visuelle ; mesurer sur le corpus plutôt que promettre |
| R-02 | Hallucination de composants : MPN, pinout ou footprint inventés → carte morte | Élevée / Élevé | Recherche catalogue obligatoire (outil + règle doc 04) ; validation Zod ; interdiction d'inventer un LCSC ; revue H2 |
| R-03 | tscircuit pré-1.0 : changements cassants fréquents | Élevée / Moyen | Versions épinglées ; corpus de régression avant toute montée de version ; pas de dépendance à des API non documentées |
| R-04 | Qualité d'agent insuffisante d'un modèle (tool calling en mode `auto` seul chez Meta) | Moyenne / Élevé | Benchmark M0 avant produit ; choix du modèle par l'utilisateur entre Meta et OpenAI, **figé pendant tout le run** (aucune bascule en cours de route) ; l'agent compense par des changements de stratégie technique, pas par un changement de modèle |
| R-05 | `muse-wonder-1.0` est en preview : disponibilité et comportement peuvent changer | Moyenne / Moyen | Jamais l'unique modèle ; Spark 1.3 par défaut ; IDs par configuration |
| R-06 | Coûts de modèle qui dérivent sur des boucles de correction longues | Moyenne / Moyen | Budgets par run (étapes + coût), prompt caching, résumés bornés, métriques par carte du corpus |
| R-07 | Concurrence établie (Flux, CELUS, EasyEDA + agents) sur le même discours | Élevée / Moyen | Différenciation doc PRD §3 : fiabilité étroite, fabricabilité JLCPCB, export KiCad, blocs vérifiés |
| R-08 | Les utilisateurs demandent hors périmètre (RF, puissance, DDR) et perdent confiance après un échec | Élevée / Moyen | Refus propre et tôt (`reportOutOfScope`), périmètre affiché dans le produit, pas de génération « pour essayer » |

## 2. Sécurité applicative

| Sujet | Mesure |
|---|---|
| Clés API (Meta, OpenAI, stockage) | Serveur uniquement, variables d'environnement, jamais renvoyées au client ; `/api/models` n'expose que des libellés |
| Code utilisateur (tscircuit) | Exécution uniquement en WebWorker/iframe isolée côté navigateur ; côté worker, conteneur dédié |
| Worker KiCad | Traite des fichiers non fiables : conteneur sans réseau sortant par défaut, quotas CPU/RAM/temps, image épinglée, aucun accès à la base applicative |
| Outils de l'agent | Écritures limitées au projet courant (chemins validés, extensions autorisées) ; aucun outil shell générique au MVP ; aucun outil d'achat/paiement |
| Export fabrication | Derrière `toolApproval: 'user-approval'` ; l'export ne déclenche **aucune** commande chez un fabricant |
| Injections via contenus tiers | Les contenus datasheets/catalogues sont des données, pas des instructions : ils ne doivent jamais modifier les règles de l'agent (les traiter comme texte non fiable dans les prompts) |
| Journalisation | Les `run_steps` contiennent des résumés, pas de clés ni de contenus sensibles complets ; accès aux runs réservé au propriétaire du projet |

## 3. Confidentialité et conformité

| Sujet | Règle |
|---|---|
| Données de conception chez Meta | Mode **Standard** uniquement (les contenus ne sont pas utilisés pour l'entraînement). Variantes `-contributor` interdites par configuration — liste blanche d'IDs de modèles autorisés côté serveur |
| Transparence utilisateur | L'interface indique le fournisseur/modèle utilisé pour chaque run ; les rapports de validation citent modèle et versions d'outils |
| Données personnelles | Minimum nécessaire (email de compte) ; suppression de projet = suppression associée des fichiers, messages, runs et artefacts |
| Propriété des designs | Les designs appartiennent à l'utilisateur ; ne pas réutiliser les projets utilisateurs pour entraîner ou constituer le catalogue sans accord explicite |
| Responsabilité fabrication | Le produit fournit des fichiers et des rapports, pas une garantie de fonctionnement. Formulation imposée dans l'UI et le rapport : « validé automatiquement, à revoir par l'utilisateur, première fabrication = prototype » |
| Domaines réglementés | Médical/automobile/aéronautique/secteur : hors périmètre, refusés proprement (D8). Le produit ne doit pas être présenté comme un outil de certification |

## 4. Risques fournisseurs

| Fournisseur | Risque | Parade |
|---|---|---|
| Meta Model API | Changements de preview, plafonds de débit Meta par compte (3 000 requêtes/min et 4M tokens/min par modèle — voir explication doc 02 §1), zones géographiques restreintes selon la politique Meta | Backoff + `Retry-After` ; second fournisseur OpenAI ; IDs configurables |
| OpenAI | Évolution rapide des noms de modèles et des tarifs | Aucun ID codé en dur ; choix figé par configuration après benchmark |
| jlcsearch / JLCPCB | Source de données non contractuelle ; stock/prix volatils ; API LCSC limitée | Cache à TTL court ; revérification en G5 ; date de vérification affichée dans la BOM ; ne jamais promettre un prix |
| tscircuit / écosystème | Projet jeune, cadence de publication élevée | Épinglage strict + corpus (cf. R-03) |

## 5. Critères de réévaluation des choix structurants

Ouvrir un ADR (et mettre à jour ces documents) si l'un de ces événements survient :

- La boucle AI SDK ne suffit plus : runs devant survivre à une fermeture navigateur de plusieurs heures, approbations différées multi-jours, ou parallélisation massive de sous-agents → réévaluer LangGraph/Mastra.
- Le benchmark montre un gain net de la **Responses API** Meta sur Chat Completions pour nos outils → provider Meta dédié.
- Le routage tscircuit échoue de façon reproductible sur le corpus alors que le placement est bon → évaluer Freerouting en moteur alternatif.
- Une part significative des utilisateurs demande l'exécution sans navigateur ouvert → exécution tscircuit serveur sous bac à sable (type E2B/Daytona ou worker dédié).
- Un fournisseur de modèles change ses conditions d'utilisation des données → revue immédiate de la section 3.
