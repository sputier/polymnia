import type { ContactTopic } from '../api/contact';
import type { Language } from '../i18n/i18n';

// The text of the contact page, in both languages. It lives in this lazy chunk, not in the i18n catalogs, so the
// first load does not grow (docs/contact.md).

export interface ContactText {
  title: string;
  back: string;
  intro: string;
  topicLabel: string;
  topics: Record<ContactTopic, string>;
  messageLabel: string;
  counter: (used: number, max: number) => string;
  replyToLabel: string;
  replyToHint: string;
  websiteLabel: string;
  send: string;
  sending: string;
  sentTitle: string;
  sentBody: string;
  another: string;
  reportNote: string;
  reportPrefix: string;
  errors: {
    required: string;
    tooLong: string;
    characters: string;
    replyTo: string;
    rate: (seconds: number | undefined) => string;
    offline: string;
    generic: string;
  };
}

export function contactText(language: Language): ContactText {
  return language === 'fr' ? french : english;
}

const english: ContactText = {
  title: 'Contact',
  back: 'Back to Polymnia',
  intro:
    'Write to the person who runs this instance: a question, a request about your personal data, or a report about a shared page. No e-mail address is published and none is needed.',
  topicLabel: 'Topic',
  topics: {
    'personal-data': 'Personal data (access, deletion, objection)',
    question: 'A question',
    report: 'Report a shared page',
    other: 'Something else',
  },
  messageLabel: 'Message',
  counter: (used, max) => `${used} / ${max}`,
  replyToLabel: 'Your e-mail address (optional)',
  replyToHint:
    'Only so that you can be answered. It is used for nothing else and deleted with the message. Without it, there is no way to reply.',
  websiteLabel: 'Leave this field empty',
  send: 'Send message',
  sending: 'Sending…',
  sentTitle: 'Message sent',
  sentBody: 'Thank you. The operator will read it. If you gave an address, the answer goes there.',
  another: 'Write another message',
  reportNote:
    'The link of the page you are reporting is in the message below, so that it can be looked at. You can edit or remove it.',
  reportPrefix: 'Reported page:',
  errors: {
    required: 'Write a message.',
    tooLong: 'The message is too long.',
    characters: 'The message contains characters that cannot be sent.',
    replyTo: 'This is not a valid e-mail address (one plain address, like name@example.com).',
    rate: (seconds) =>
      seconds === undefined
        ? 'Too many messages. Try again later.'
        : `Too many messages. Try again in ${seconds} seconds.`,
    offline: 'No connection. Check your network and try again.',
    generic: 'The message could not be sent. Try again.',
  },
};

const french: ContactText = {
  title: 'Contact',
  back: 'Retour à Polymnia',
  intro:
    "Écrivez à la personne qui fait fonctionner cette instance : une question, une demande sur vos données personnelles ou le signalement d'une page partagée. Aucune adresse e-mail n'est publiée et il n'en faut aucune.",
  topicLabel: 'Sujet',
  topics: {
    'personal-data': 'Données personnelles (accès, suppression, opposition)',
    question: 'Une question',
    report: 'Signaler une page partagée',
    other: 'Autre chose',
  },
  messageLabel: 'Message',
  counter: (used, max) => `${used} / ${max}`,
  replyToLabel: 'Votre adresse e-mail (facultatif)',
  replyToHint:
    "Uniquement pour qu'on puisse vous répondre. Elle ne sert à rien d'autre et est supprimée avec le message. Sans elle, il n'y a aucun moyen de répondre.",
  websiteLabel: 'Laissez ce champ vide',
  send: 'Envoyer le message',
  sending: 'Envoi…',
  sentTitle: 'Message envoyé',
  sentBody:
    "Merci. L'exploitant le lira. Si vous avez donné une adresse, la réponse y sera envoyée.",
  another: 'Écrire un autre message',
  reportNote:
    "Le lien de la page signalée est dans le message ci-dessous, pour qu'on puisse la consulter. Vous pouvez le modifier ou le retirer.",
  reportPrefix: 'Page signalée :',
  errors: {
    required: 'Écrivez un message.',
    tooLong: 'Le message est trop long.',
    characters: 'Le message contient des caractères qui ne peuvent pas être envoyés.',
    replyTo:
      "Ce n'est pas une adresse e-mail valide (une seule adresse simple, comme nom@exemple.fr).",
    rate: (seconds) =>
      seconds === undefined
        ? 'Trop de messages. Réessayez plus tard.'
        : `Trop de messages. Réessayez dans ${seconds} secondes.`,
    offline: 'Pas de connexion. Vérifiez votre réseau et réessayez.',
    generic: "Le message n'a pas pu être envoyé. Réessayez.",
  },
};
