// Messages of read-only share links: the share dialog and the public viewer (docs/sharing.md). Kept in their own file
// and spread into the catalogs (like library.ts) so parallel work on the editor does not edit the same lines.

export const sharingEn = {
  'shortcut.share': 'Share this score…',
  'share.intro':
    'Anyone with the link can view and play this score, without signing in. They cannot change it.',
  'share.loading': 'Loading…',
  'share.off': 'This score is not shared.',
  'share.create': 'Create link',
  'share.linkLabel': 'Share link',
  'share.copy': 'Copy link',
  'share.copied': 'Link copied.',
  'share.copyFailed': 'Could not copy. The link is selected: press Ctrl+C.',
  'share.created': 'Link created. Copy it now.',
  'share.on': 'Sharing has been on since {when}.',
  'share.hidden':
    'For your safety the full link is only shown when it is created. Create a new link to copy one again.',
  'share.regenerate': 'New link',
  'share.regenerateHint': 'Creating a new link makes the previous one stop working.',
  'share.revoke': 'Stop sharing',
  'share.revoked': 'Sharing stopped. The link no longer works.',
  'share.exportTitle': 'Download a copy',
  'share.error': 'Something went wrong. Try again.',
  'share.errorRate': 'Too many requests. Try again in {n} seconds.',
  'share.errorOffline': 'No connection. Check your network and try again.',
  'viewer.loading': 'Opening the shared score…',
  'viewer.invalid': 'This link is no longer valid.',
  'viewer.invalidHint':
    'The owner may have stopped sharing this score or replaced the link with a new one.',
  'viewer.failed': 'The score could not be loaded.',
  'viewer.rate': 'Too many requests. Try again in a moment.',
  'viewer.corrupt': 'This score cannot be shown.',
  'viewer.madeWith': 'Made with Polymnia',
  'viewer.readOnly': 'Read only',
} as const;

export const sharingFr: Record<keyof typeof sharingEn, string> = {
  'shortcut.share': 'Partager cette partition…',
  'share.intro':
    'Toute personne qui a le lien peut voir et écouter cette partition, sans se connecter. Elle ne peut pas la modifier.',
  'share.loading': 'Chargement…',
  'share.off': 'Cette partition n’est pas partagée.',
  'share.create': 'Créer un lien',
  'share.linkLabel': 'Lien de partage',
  'share.copy': 'Copier le lien',
  'share.copied': 'Lien copié.',
  'share.copyFailed': 'Copie impossible. Le lien est sélectionné : appuyez sur Ctrl+C.',
  'share.created': 'Lien créé. Copiez-le maintenant.',
  'share.on': 'Le partage est actif depuis le {when}.',
  'share.hidden':
    'Par sécurité, le lien complet n’est affiché qu’à sa création. Créez un nouveau lien pour en copier un à nouveau.',
  'share.regenerate': 'Nouveau lien',
  'share.regenerateHint': 'Créer un nouveau lien désactive le précédent.',
  'share.revoke': 'Arrêter le partage',
  'share.revoked': 'Partage arrêté. Le lien ne fonctionne plus.',
  'share.exportTitle': 'Télécharger une copie',
  'share.error': 'Une erreur est survenue. Réessayez.',
  'share.errorRate': 'Trop de requêtes. Réessayez dans {n} secondes.',
  'share.errorOffline': 'Pas de connexion. Vérifiez votre réseau et réessayez.',
  'viewer.loading': 'Ouverture de la partition partagée…',
  'viewer.invalid': 'Ce lien n’est plus valide.',
  'viewer.invalidHint':
    'Son propriétaire a peut-être arrêté de partager cette partition ou remplacé le lien par un nouveau.',
  'viewer.failed': 'La partition n’a pas pu être chargée.',
  'viewer.rate': 'Trop de requêtes. Réessayez dans un instant.',
  'viewer.corrupt': 'Cette partition ne peut pas être affichée.',
  'viewer.madeWith': 'Créé avec Polymnia',
  'viewer.readOnly': 'Lecture seule',
};
