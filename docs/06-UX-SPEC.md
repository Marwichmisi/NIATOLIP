# Spécification UX — interface agent + preview

| Version | 1.0 — 2026-10-29 |
|---|---|
| Référence visuelle | Maquette fournie par le porteur : panneau « Agent IA + chat » à gauche, « Interface de preview de la carte après modification » à droite. |

---

## 1. Layout

```
┌──────────────────────┬────────────────────────────────────────┐
│ AGENT                │ PREVIEW                                │
│                      │ [PCB | Schéma | 3D | BOM | Validation] │
│ Plan / étapes        │                                        │
│ (fil d'exécution)    │         Rendu de la carte              │
│                      │                                        │
│ Messages             │                                        │
│                      │                                        │
│ ┌──────────────────┐ │ État : ● Checks OK  ● DRC OK  v12      │
│ │ chat…            │ │                                        │
│ └──────────────────┘ │                                        │
└──────────────────────┴────────────────────────────────────────┘
```

- Desktop d'abord ; le panneau agent fait ~360–420 px, la preview prend le reste.
- La preview n'est jamais masquée par une modale pendant un run : l'utilisateur doit voir la carte évoluer.
- Mobile : usage en consultation uniquement (chat + image) — la conception complète n'est pas un objectif MVP mobile.

## 2. Panneau Agent

### 2.1 Fil d'exécution (au-dessus des messages)

Chaque étape du run s'affiche comme une ligne compacte et horodatée :

```
✓ Plan proposé                          → [Approuver] [Modifier]
✓ Recherche composants (8 résultats)
✓ Écriture main.tsx
✓ Évaluation — 0 erreur
✓ Check netlist — OK
✓ Check placement — OK
⟳ Routage…
```

- États : en attente, en cours (spinner), succès, échec (rouge, dépliable pour voir le détail technique), annulé — rendus avec icônes Lucide (`Loader2` animé, `Check`, `X`, `Circle`) et `Badge` shadcn, jamais par la seule couleur.
- Les appels d'outils sont **visibles mais résumés** : nom lisible (« Recherche de composants »), jamais de JSON brut par défaut ; le détail brut est accessible en dépliant (`Collapsible`).
- Un bouton d'arrêt visible pendant tout le run (FR-13) : icône `Square` seule, tooltip « Arrêter le run », `aria-label` équivalent (voir §7).

### 2.2 Gates humaines

| Gate | Présentation |
|---|---|
| H1 — Plan | Carte de plan dans le chat : objectif, composants principaux avec références pressenties, dimensions, couches, estimation de coût des composants. Boutons : **Approuver**, **Demander une modification** (focus remis dans le chat) |
| H2 — Design final | Vue revue : image PCB, tableau BOM (référence, LCSC, stock, prix), état des gates G0–G5, limites connues. Boutons : **Approuver et exporter**, **Demander une modification** |

Aucune gate ne se valide par simple envoi d'un message ambigu : l'approbation est un clic explicite (mécanisme `toolApproval` de l'AI SDK pour l'export).

### 2.3 Chat

- Zone de saisie (`Textarea` shadcn, envoi par Entrée) et bouton d'envoi **iconographique** : icône `ArrowUp` (ou `SendHorizontal`) seule dans un `Button` rond, tooltip « Envoyer ». Pendant un run, ce bouton est remplacé par le bouton d'arrêt (icône `Square`). Pièces jointes hors MVP.
- Messages de l'agent : courts, factuels, avec liens vers les étapes du fil d'exécution quand c'est pertinent.
- Sélecteur de modèle discret en haut du panneau (`Select` shadcn) : **Meta — Spark (rapide) / Meta — Wonder (approfondi) / OpenAI**. Le changement ne prend effet qu'au run suivant et est journalisé.
- Indicateur de progression du run : étapes consommées sur 50 (`Progress` ou compteur discret) et coût estimé, avec état d'alerte à 80 % du budget coût.

## 3. Panneau Preview

### 3.1 Onglets

| Onglet | Contenu |
|---|---|
| PCB | Rendu PCB tscircuit (RunFrame) — onglet par défaut |
| Schéma | Rendu schématique |
| 3D | Vue 3D quand disponible |
| BOM | Tableau des composants : designator, valeur/référence, package, LCSC, stock, prix |
| Validation | État des gates G0–G5, rapport DRC/ERC (après job worker), warnings, rapport téléchargeable |

### 3.2 Comportements

- Toute modification de fichier par l'agent déclenche la réévaluation et le rafraîchissement de l'onglet actif (cible < 3 s, NFR-02).
- En cas d'erreur d'évaluation : l'onglet conserve le **dernier rendu valide** avec un bandeau « modifications en erreur — voir l'étape en cours », plutôt qu'un écran vide.
- Bandeau d'état permanent sous la preview : version courante (`v12`), état des checks, lien « télécharger le code / le projet KiCad » (toujours disponible, même non validé).
- Zoom/pan : ceux fournis par RunFrame ; ne pas réimplémenter au MVP.

## 4. États globaux et cas limites

| Situation | Comportement attendu |
|---|---|
| Premier message, aucun fichier | Preview vide avec message « L'agent va créer la carte ici » |
| Modèle lent / étape longue | Fil d'exécution en état « en cours » avec durée écoulée ; jamais d'écran figé sans signal |
| Plafond de 50 étapes atteint | Run arrêté proprement, état sauvegardé, message dans le chat : « Itération terminée (50 étapes). Le projet est sauvegardé à l'étape X. » + bouton **Continuer l'itération** (icône `Play` / `RotateCw`) qui lance une nouvelle itération du même projet, même modèle, en un clic — jamais de relance automatique |
| Demande hors périmètre | Message clair de l'agent (`reportOutOfScope`) + alternative proposée ; pas de génération « pour essayer » |
| Échec du job KiCad (worker) | Gate G4 marquée en échec technique (distinct d'un échec DRC) avec bouton Relancer |
| Composant devenu indisponible entre génération et export | Signalé en G5 et dans la BOM avant H2, avec proposition de remplacement par l'agent |
| Fermeture/réouverture du projet | Restauration fichiers + historique + dernière version validée (FR-12) |

## 5. Ton et micro-copy

- L'agent parle en langage d'atelier clair : « Je place le capteur près du bord », pas de jargon inutile sans explication.
- Toute affirmation de réussite cite sa preuve : « Routage vérifié : 0 net non connecté ».
- Les limites sont dites simplement : « Je ne peux pas vérifier le comportement analogique de ce filtre ; le DRC est propre. »
- Aucune formulation de garantie (« carte garantie fonctionnelle » interdite dans l'UI).

## 6. Accessibilité et qualité (minimum MVP)

- Contraste suffisant sur les états succès/échec (ne pas coder l'état par la seule couleur : icônes `Check` / `X` / `Loader2`).
- Navigation clavier du chat et des boutons de gate.
- Les images de snapshot générées pour le modèle ne remplacent pas le rendu interactif pour l'utilisateur.

## 7. Direction artistique validée (prototype, 2026-10-29)

| Choix | Valeur |
|---|---|
| Univers | SaaS moderne sombre type Linear/Vercel/Bolt — explicitement **pas** l'UI verte « outil électronique » classique ni de police fantaisiste |
| Couleur d'accent | **Orange/ambre vif** (`--primary` oklch ≈ 0.70 0.18 52) ; le vert n'est utilisé que comme couleur d'état « succès », jamais comme identité |
| Thèmes | **Sombre + clair**, bascule par l'utilisateur (sombre par défaut) |
| Typographie | **Space Grotesk** pour les titres/logo (caractère, sans excentricité), **Inter** pour le texte, **JetBrains Mono** uniquement pour les données techniques (références, versions) |
| Densité | Intermédiaire : base aérée, détail technique dépliable (étapes, résultats d'outils) |
| Premier livrable | Écran principal complet (agent + preview) avec données simulées réalistes |

## 8. Design system — shadcn/ui + icônes Lucide (décision D10)

### 8.1 Base

- Composants **shadcn/ui** (générés dans le projet, basés sur Radix + Tailwind) : `Button`, `Textarea`, `Select`, `Tabs`, `Card`, `Badge`, `Tooltip`, `Collapsible`, `ScrollArea`, `Progress`, `Skeleton`, `AlertDialog`, `Sheet`, `Separator`, et notifications `sonner`.
- Icônes : **Lucide** uniquement (`lucide-react`). Aucune autre bibliothèque d'icônes, aucun emoji d'interface.
- Thème : variables CSS shadcn, mode sombre à prévoir dès la structure (pas forcément livré au MVP).

### 8.2 Règle icônes vs texte

Les actions **évidentes et fréquentes** sont iconographiques seules (avec `Tooltip` au survol et `aria-label` pour l'accessibilité). Les actions **ambiguës, engageantes ou rares** gardent une icône + un libellé court.

| Action | Rendu | Icône Lucide |
|---|---|---|
| Envoyer le message | Icône seule (bouton rond) | `ArrowUp` |
| Arrêter le run | Icône seule (remplace l'envoi pendant le run) | `Square` |
| Continuer l'itération (après 50 étapes) | Icône + « Continuer » | `Play` |
| Approuver le plan / le design (gates) | Icône + libellé court (« Approuver ») | `Check` |
| Demander une modification | Icône + libellé court | `Pencil` (ou focus chat) |
| Exporter / télécharger un artefact | Icône seule dans les listes, icône + libellé sur l'action principale | `Download` |
| Relancer un job en échec | Icône seule + tooltip | `RotateCw` |
| Créer un point de restauration | Icône seule + tooltip | `Bookmark` / `History` |
| Supprimer un projet | Icône seule, confirmation `AlertDialog` obligatoire | `Trash2` |
| Onglets preview | Icône + libellé court (PCB, Schéma, 3D, BOM, Validation) | `CircuitBoard`, `DraftingCompass`/`Network`, `Box`, `List`, `ShieldCheck` |
| États de checks | Icône d'état, jamais de texte « OK/ERREUR » seul | `Check`, `X`, `Loader2`, `CircleAlert` |

### 8.3 Interdictions

- Aucun bouton « Envoyer », « Stop », « OK » en texte seul pour les actions du tableau ci-dessus.
- Aucune icône sans signification évidente sans tooltip.
- Aucun mélange d'icônes Lucide avec des caractères Unicode décoratifs (✓/✕/⟳) dans l'interface livrée — ces caractères ne servent que dans la documentation.
