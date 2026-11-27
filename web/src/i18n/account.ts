// Messages of the account menu, the data export and the account deletion dialog (docs/privacy.md). Kept in their
// own file and spread into the catalogs, like the library messages. The privacy page itself is a lazy chunk with its own
// text (src/privacy/content.ts), so its long text is not part of the first load.

export const accountEn = {
  'account.menuLabel': 'Account menu',
  'account.privacy': 'Privacy policy',
  'account.export': 'Export my data',
  'account.exporting': 'Preparing your export…',
  'account.exported': 'Your data was downloaded.',
  'account.exportEmpty': 'The export could not be read.',
  'account.errorRateLimited': 'Too many requests. Try again in {n} s.',
  'account.errorGeneric': 'Something went wrong. Please try again.',
  'account.errorOffline': 'You are offline. Try again when you are back online.',
  'account.delete': 'Delete my account',
  'account.deleteTitle': 'Delete your account',
  'account.deleteBody':
    'This permanently deletes your account, all your scores, your share links and your sessions. It cannot be undone.',
  'account.deleteExportHint': 'Want a copy first? Export your data, then come back.',
  'account.deleteWord': 'DELETE',
  'account.deleteConfirmLabel': 'Type {word} to confirm',
  'account.deleteConfirm': 'Delete my account',
  'account.deleting': 'Deleting…',
  'account.reauthTitle': 'Sign in again to continue',
  'account.reauthBody':
    'For your security, deleting an account requires a recent sign-in. Sign in with Google again, then confirm the deletion.',
  'account.reauthButton': 'Sign in again',
  'auth.accountDeleted': 'Your account and all its data were deleted.',
  'auth.privacy': 'Privacy policy',
} as const;

export const accountFr = {
  'account.menuLabel': 'Menu du compte',
  'account.privacy': 'Politique de confidentialité',
  'account.export': 'Exporter mes données',
  'account.exporting': 'Préparation de votre export…',
  'account.exported': 'Vos données ont été téléchargées.',
  'account.exportEmpty': "L'export n'a pas pu être lu.",
  'account.errorRateLimited': 'Trop de requêtes. Réessayez dans {n} s.',
  'account.errorGeneric': "Une erreur s'est produite. Veuillez réessayer.",
  'account.errorOffline': 'Vous êtes hors ligne. Réessayez une fois reconnecté.',
  'account.delete': 'Supprimer mon compte',
  'account.deleteTitle': 'Supprimer votre compte',
  'account.deleteBody':
    'Cela supprime définitivement votre compte, toutes vos partitions, vos liens de partage et vos sessions. Cette action est irréversible.',
  'account.deleteExportHint': "Une copie d'abord ? Exportez vos données, puis revenez.",
  'account.deleteWord': 'SUPPRIMER',
  'account.deleteConfirmLabel': 'Saisissez {word} pour confirmer',
  'account.deleteConfirm': 'Supprimer mon compte',
  'account.deleting': 'Suppression…',
  'account.reauthTitle': 'Reconnectez-vous pour continuer',
  'account.reauthBody':
    'Par sécurité, la suppression du compte exige une connexion récente. Connectez-vous de nouveau avec Google, puis confirmez la suppression.',
  'account.reauthButton': 'Se reconnecter',
  'auth.accountDeleted': 'Votre compte et toutes ses données ont été supprimés.',
  'auth.privacy': 'Politique de confidentialité',
} as const satisfies Record<keyof typeof accountEn, string>;
