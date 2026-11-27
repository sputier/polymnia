export const en = {
  'app.name': 'Polymnia',
  'app.tagline': 'Compose music in your browser.',
  'home.status': 'The editor is coming soon.',
  'theme.toggleToDark': 'Switch to dark theme',
  'theme.toggleToLight': 'Switch to light theme',
  'theme.light': 'Light',
  'theme.dark': 'Dark',
  'language.label': 'Language',
  'language.en': 'English',
  'language.fr': 'Français',
} as const;

export type MessageKey = keyof typeof en;
export type Messages = Record<MessageKey, string>;
