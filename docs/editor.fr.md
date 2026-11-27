# Éditeur

[English](editor.md) · **Français**

L'éditeur est à l'adresse `#/editor` (routage par hash, sans dépendance de routeur). La page d'accueil y mène.

## Disposition

| Zone | Rôle |
| --- | --- |
| Barre du haut | Lien de retour, bascule des instruments, titre modifiable, état d'enregistrement (`Enregistré`, `Enregistrement…`, `Hors ligne`), bascule Simple/Avancé, Partager et Exporter (maquettes), thème et langue, bascule de l'inspecteur (mode Avancé uniquement) |
| Panneau gauche | Instruments, repliable. En mode Simple, il indique comment accéder au mode Avancé |
| Centre | La partition sur une surface « papier » (provisoire en attendant la gravure) et la bande de rappel des raccourcis |
| Panneau droit | Inspecteur, repliable, **mode Avancé uniquement** |
| Barre d'état | Mode de saisie (`SAISIE` / `SÉLECTION`), durée courante, mesure et temps, niveau d'interface, état d'enregistrement |

Les composants sont dans `web/src/editor/`. La barre d'état reçoit ses valeurs par props (`inputMode`, `duration`, `measure`, `beat`, `saveState`) : les fonctionnalités suivantes n'ont qu'à fournir les vraies valeurs.

### Simple et Avancé

Le choix est stocké dans `localStorage` (`polymnia.uiMode` ; les erreurs sont ignorées). Il migrera vers le profil utilisateur avec les comptes. Le mode Simple masque l'inspecteur et les outils avancés.

### Responsive

- 1100 px et plus : les panneaux sont à côté de la partition.
- Sous 1100 px (jusqu'à 768 px) : les panneaux se superposent à la partition, démarrent fermés, ont un bouton de fermeture et se ferment avec `Échap` ou un clic à l'extérieur. En ouvrir un ferme l'autre.

## Raccourcis clavier

| Raccourci | Action |
| --- | --- |
| `Ctrl+B` (`Cmd+B` sur macOS) | Afficher ou masquer le panneau des instruments |
| `Ctrl+I` (`Cmd+I` sur macOS) | Afficher ou masquer l'inspecteur (Avancé uniquement) |
| `Alt+A` (`Option+A` sur macOS) | Basculer entre Simple et Avancé |
| `Échap` | Fermer le panneau ouvert (écrans étroits) |

Les raccourcis ne se déclenchent pas pendant la saisie dans un champ texte. Les touches de saisie de notes de la bande de rappel (`N`, `1`–`5`, `A`–`G`, flèches, `0`) ne sont qu'un rappel pour l'instant.

### Registre de raccourcis

`web/src/shortcuts/` est l'unique endroit où déclarer les raccourcis, partagé avec la saisie de notes et la palette de commandes.

```ts
useShortcuts([
  { id: 'editor.toggleInstruments', keys: 'Mod+B', labelKey: 'shortcut.toggleInstruments', handler },
]);
```

- `keys` : `Mod` vaut `Cmd` sur macOS et `Ctrl` ailleurs ; aussi `Alt`, `Shift` et une touche (`B`, `Escape`, ...). Les lettres suivent la touche physique, donc `Alt+A` fonctionne sur macOS.
- `handler` peut renvoyer `false` pour ne pas toucher à l'événement (pas de `preventDefault`).
- `allowInInput: true` autorise le déclenchement pendant la saisie dans un champ.
- `shortcuts.list()` renvoie tous les raccourcis (pour la palette de commandes) ; `formatKeys` et `<Kbd>` affichent des libellés adaptés à la plateforme.

## Accessibilité

Repères (`header`, `aside`, `main`, barre d'état), focus visible, `aria-label` sur les boutons-icônes, `aria-expanded` sur les bascules de panneaux, `aria-pressed` sur les bascules, annonces polies uniquement pour le mode de saisie et l'enregistrement (pas pour la position, qui change à chaque note), et `prefers-reduced-motion` respecté.
