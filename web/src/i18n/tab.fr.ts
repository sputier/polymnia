/** Chaînes de la saisie en tablature (fusionnées dans le catalogue français). */
import type { tabEn } from './tab.en';

export const tabFr: Record<keyof typeof tabEn, string> = {
  'notice.tabString': 'Corde {string}.',
  'notice.fretRange': 'Cette case n’existe pas sur cet instrument.',
  'notice.tabOnly': 'Sélectionnez d’abord une portée de tablature.',
  'notice.noOtherString': 'Aucune autre corde ne peut jouer cette note.',
  'notice.autoFingered': 'Doigté automatique rétabli.',
  'notice.tabRestsShown': 'Silences affichés sur cette tablature.',
  'notice.tabRestsHidden': 'Silences masqués sur cette tablature.',
  'shortcut.tabDuration': 'Choisir la durée sur une tablature (les chiffres y sont des cases)',
  'shortcut.tabRest': 'Saisir un silence sur une tablature (0 y est la corde à vide)',
  'shortcut.refretUp': 'Passer la note sur la corde du dessus',
  'shortcut.refretDown': 'Passer la note sur la corde du dessous',
  'command.stringUp': 'Tablature : corde de saisie plus haut',
  'command.stringDown': 'Tablature : corde de saisie plus bas',
  'command.autoFinger': 'Tablature : doigté automatique de la sélection',
  'command.tabRests': 'Tablature : afficher ou masquer les silences de cette portée',
  'instruments.tabRests': 'Afficher les silences sur la tablature',
  'score.noFingering': 'Aucune corde ne peut jouer cette note sur {instrument}',
  'inspector.warnFret': 'Mesure {measure} :',
};
