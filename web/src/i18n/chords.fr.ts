/** Chaînes des accords et des diagrammes (fusionnées dans le catalogue français). */
import type { chordsEn } from './chords.en';

export const chordsFr: Record<keyof typeof chordsEn, string> = {
  'shortcut.chordEntry': 'Saisir un accord',
  'chord.entryLabel': 'Accord, mesure {measure}, temps {beat}',
  'chord.entryHint':
    'Espace passe au temps suivant, Tab à la mesure suivante, Entrée valide, Échap ferme. Un champ vide supprime l’accord.',
  'chord.entryPlaceholder': 'Lam7',
  'chord.entryInvalid': 'Ce n’est pas un accord',
  'chord.entryPreview': 'Affiché {chord}',
  'notice.chordInvalid': 'Accord non reconnu : {text}',
  'notice.chordSet': 'Accord {chord}.',
  'notice.chordRemoved': 'Accord supprimé.',
  'notice.chordNone': 'Aucun accord ici.',
  'notice.chordTransposed': 'Accords transposés de {semitones} demi-tons.',
  'notice.chordDiagramOn': 'Diagramme affiché pour {chord}.',
  'notice.chordDiagramOff': 'Diagramme masqué pour {chord}.',
  'command.chordTransposeUp': 'Accords : transposer les symboles d’un demi-ton vers le haut',
  'command.chordTransposeDown': 'Accords : transposer les symboles d’un demi-ton vers le bas',
  'command.chordDiagram': 'Accords : afficher ou masquer le diagramme de l’accord au curseur',
  'command.chordDelete': 'Accords : supprimer l’accord au curseur',
  'instruments.chordDiagrams': 'Diagrammes de manche',
  'instruments.chordDiagramsNone': 'Aucun',
  'instruments.chordDiagramsFirst': 'À la première apparition de chaque accord',
  'instruments.chordDiagramsAll': 'Pour chaque accord',
  'instruments.chordCapoShapes': 'Avec un capodastre, afficher aussi la forme à jouer, ex. D (C)',
  'mixer.chords': 'Accords',
  'mixer.chordsOff': 'Muets',
  'mixer.chordsBlock': 'Accords plaqués',
  'mixer.chordsStrum': 'Arpégés (strum)',
  'score.chordAria': 'Accord {chord}',
};
