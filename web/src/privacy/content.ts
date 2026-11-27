import type { LegalInfo } from '../api/account';
import type { Language } from '../i18n/i18n';

// The text of the privacy policy, in both languages (docs/privacy.md). It lives in this lazy chunk, not in the
// i18n catalogs. Numbers (retention) come from the server settings so that the page never contradicts the instance.

export interface Section {
  id: string;
  title: string;
  /** Paragraphs, then an optional list. */
  paragraphs: string[];
  items?: string[];
}

export interface PolicyText {
  title: string;
  intro: string;
  back: string;
  placeholderTitle: string;
  placeholderBody: string;
  operatorLabel: string;
  contactLabel: string;
  /** Text of the link when the contact is the instance's own form. */
  contactFormLabel: string;
  addressLabel: string;
  hostingLabel: string;
  loading: string;
  loadError: string;
  retry: string;
  sections: Section[];
}

function days(language: Language, n: number): string {
  if (language === 'fr') return n === 1 ? '1 jour' : `${n} jours`;
  return n === 1 ? '1 day' : `${n} days`;
}

export function policyText(language: Language, legal: LegalInfo): PolicyText {
  return language === 'fr' ? french(legal) : english(legal);
}

function english(legal: LegalInfo): PolicyText {
  const d = (n: number) => days('en', n);
  return {
    title: 'Privacy policy',
    intro:
      'Polymnia is a free, open source music notation editor. This page explains which personal data this instance stores, why, for how long, and how you control it.',
    back: 'Back to Polymnia',
    placeholderTitle: 'Operator details not configured',
    placeholderBody:
      'This instance has no operator information yet (development mode). A real deployment must set the Legal settings: the application refuses to start without them.',
    operatorLabel: 'Operator',
    contactLabel: 'Contact',
    contactFormLabel: 'Contact form',
    addressLabel: 'Address',
    hostingLabel: 'Hosting',
    loading: 'Loading…',
    loadError: 'The operator details could not be loaded.',
    retry: 'Try again',
    sections: [
      {
        id: 'controller',
        title: '1. Who is responsible',
        paragraphs: [
          'The operator named above runs this instance and decides why and how your data is processed (the "data controller"). The software itself is open source: the people who wrote it do not receive your data unless they also run the instance you use.',
        ],
      },
      {
        id: 'data',
        title: '2. What is stored',
        paragraphs: ['Only what the service needs. No e-mail address is requested or stored.'],
        items: [
          'Your Google account identifier (an opaque number, not your e-mail address), your display name and your avatar address, as given by Google when you sign in.',
          'Your language preference.',
          'Messages you send through the contact form: the text, the topic and, only if you give one, the address to answer you at. Nothing else is stored with a message: no account, no IP address.',
          'The scores you create (title, content, dates) and the share links you create.',
          'Your sessions: a random key (stored hashed) and its dates, so that you stay signed in.',
          'Security logs: the date, the type of event (sign-in, sign-out, export, deletion, too many requests) and your internal user identifier. No name, no e-mail address, no Google identifier, no password (there is none) and no score content.',
        ],
      },
      {
        id: 'cookies',
        title: '3. Cookies and browser storage',
        paragraphs: [
          'Polymnia uses only strictly necessary cookies: the session, the protection against forged requests and the short-lived sign-in checks. They are not used to track you, so no consent banner is needed. There is no analytics, no advertising and no third-party tracker.',
          'Your language and theme choices are kept in your browser (local storage) and are never sent to the server.',
        ],
      },
      {
        id: 'why',
        title: '4. Why and on what legal basis',
        paragraphs: [],
        items: [
          'To run your account and your scores, and to let you sign in: performance of the service you asked for (GDPR article 6(1)(b)).',
          'To keep the service secure and prevent abuse (sessions, security logs, rate limiting): the operator’s legitimate interest (article 6(1)(f)).',
        ],
      },
      {
        id: 'retention',
        title: '5. How long it is kept',
        paragraphs: [],
        items: [
          'Your account, scores and share links: until you delete them, or delete your account.',
          `Sessions: a session ends after ${d(legal.sessionIdleDays)} without use, and never lasts more than ${d(legal.sessionAbsoluteDays)}. Ended sessions are removed.`,
          `Security logs: ${d(legal.logRetentionDays)}.`,
          `Contact messages: ${d(legal.contactRetentionDays)}, then they are deleted.`,
          'Deleting your account removes your data from the database immediately. Backups made by the operator may still hold it until they are replaced in their normal rotation.',
        ],
      },
      {
        id: 'recipients',
        title: '6. Who receives your data',
        paragraphs: [
          'Nobody is sold or given your data. Two parties take part in running the service:',
        ],
        items: [
          'Google signs you in. It tells the instance who you are (identifier, name, avatar); the instance never receives your Google password. Google processes your sign-in under its own privacy policy (policies.google.com/privacy).',
          legal.hostingProvider
            ? `The hosting provider, ${legal.hostingProvider}${legal.hostingCountry ? ` (${legal.hostingCountry})` : ''}, runs the server and the database on behalf of the operator (a processor). Like any host, it may keep technical connection logs.`
            : 'The hosting provider runs the server and the database on behalf of the operator (a processor). Like any host, it may keep technical connection logs.',
        ],
      },
      {
        id: 'rights',
        title: '7. Your rights and how to use them',
        paragraphs: [
          'You can access, correct, delete, export and restrict the use of your data, and object to its processing.',
        ],
        items: [
          'Access and portability: in the account menu, "Export my data" downloads a ZIP archive with a profile file and every score as a JSON file. It is limited to a few requests every ten minutes.',
          'Erasure: in the account menu, "Delete my account" removes your account, scores, share links and sessions at once. You are asked to sign in with Google again first, and to type a confirmation. It cannot be undone.',
          'Correction: your name and avatar come from your Google account. Change them there; they are updated at your next sign-in.',
          'Anything else (restriction, objection, a question): use the contact above. You will get an answer within one month. If it is the contact form, choose the topic "Personal data" and leave an address to answer you at.',
          'You may also lodge a complaint with your data protection authority (for example the CNIL in France).',
        ],
      },
      {
        id: 'security',
        title: '8. Security',
        paragraphs: [
          'Connections use HTTPS. The browser never holds a Google token: the server keeps your session and the browser only holds an opaque cookie. Session keys are stored hashed and the keys that protect cookies are encrypted at rest.',
        ],
      },
    ],
  };
}

function french(legal: LegalInfo): PolicyText {
  const d = (n: number) => days('fr', n);
  return {
    title: 'Politique de confidentialité',
    intro:
      'Polymnia est un éditeur de partitions libre et gratuit. Cette page explique quelles données personnelles cette instance conserve, pourquoi, combien de temps, et comment vous les maîtrisez.',
    back: 'Retour à Polymnia',
    placeholderTitle: "Informations de l'exploitant non renseignées",
    placeholderBody:
      "Cette instance n'a pas encore d'informations d'exploitant (mode développement). Un vrai déploiement doit renseigner les paramètres Legal : l'application refuse de démarrer sans eux.",
    operatorLabel: 'Exploitant',
    contactLabel: 'Contact',
    contactFormLabel: 'Formulaire de contact',
    addressLabel: 'Adresse',
    hostingLabel: 'Hébergement',
    loading: 'Chargement…',
    loadError: "Les informations de l'exploitant n'ont pas pu être chargées.",
    retry: 'Réessayer',
    sections: [
      {
        id: 'controller',
        title: '1. Qui est responsable',
        paragraphs: [
          "L'exploitant indiqué ci-dessus fait fonctionner cette instance et décide pourquoi et comment vos données sont traitées (le « responsable de traitement »). Le logiciel est libre : ses auteurs ne reçoivent pas vos données, sauf s'ils exploitent aussi l'instance que vous utilisez.",
        ],
      },
      {
        id: 'data',
        title: '2. Ce qui est conservé',
        paragraphs: [
          "Uniquement ce dont le service a besoin. Aucune adresse e-mail n'est demandée ni conservée.",
        ],
        items: [
          "L'identifiant de votre compte Google (un numéro opaque, pas votre adresse e-mail), votre nom affiché et l'adresse de votre avatar, tels que Google les transmet à la connexion.",
          'Votre préférence de langue.',
          "Les messages envoyés par le formulaire de contact : le texte, le sujet et, seulement si vous en donnez une, l'adresse où vous répondre. Rien d'autre n'est conservé avec un message : ni compte, ni adresse IP.",
          'Les partitions que vous créez (titre, contenu, dates) et les liens de partage que vous créez.',
          'Vos sessions : une clé aléatoire (conservée sous forme hachée) et ses dates, pour que vous restiez connecté.',
          "Des journaux de sécurité : la date, le type d'événement (connexion, déconnexion, export, suppression, trop de requêtes) et votre identifiant interne. Ni nom, ni e-mail, ni identifiant Google, ni mot de passe (il n'y en a pas), ni contenu de partition.",
        ],
      },
      {
        id: 'cookies',
        title: '3. Cookies et stockage du navigateur',
        paragraphs: [
          "Polymnia n'utilise que des cookies strictement nécessaires : la session, la protection contre les requêtes falsifiées et les vérifications de connexion de courte durée. Ils ne servent pas à vous suivre : aucun bandeau de consentement n'est nécessaire. Il n'y a ni statistiques, ni publicité, ni traceur tiers.",
          'Vos choix de langue et de thème sont gardés dans votre navigateur (stockage local) et ne sont jamais envoyés au serveur.',
        ],
      },
      {
        id: 'why',
        title: '4. Pourquoi, et sur quelle base légale',
        paragraphs: [],
        items: [
          'Pour gérer votre compte et vos partitions et vous permettre de vous connecter : exécution du service que vous avez demandé (RGPD, article 6, paragraphe 1, point b).',
          "Pour garder le service sûr et prévenir les abus (sessions, journaux de sécurité, limitation de débit) : intérêt légitime de l'exploitant (article 6, paragraphe 1, point f).",
        ],
      },
      {
        id: 'retention',
        title: '5. Combien de temps',
        paragraphs: [],
        items: [
          "Votre compte, vos partitions et vos liens de partage : jusqu'à ce que vous les supprimiez, ou que vous supprimiez votre compte.",
          `Sessions : une session prend fin après ${d(legal.sessionIdleDays)} sans utilisation, et ne dure jamais plus de ${d(legal.sessionAbsoluteDays)}. Les sessions terminées sont supprimées.`,
          `Journaux de sécurité : ${d(legal.logRetentionDays)}.`,
          `Messages du formulaire de contact : ${d(legal.contactRetentionDays)}, puis ils sont supprimés.`,
          "La suppression de votre compte retire immédiatement vos données de la base. Les sauvegardes de l'exploitant peuvent encore les contenir jusqu'à leur remplacement par la rotation normale.",
        ],
      },
      {
        id: 'recipients',
        title: '6. Qui reçoit vos données',
        paragraphs: [
          'Vos données ne sont ni vendues ni cédées. Deux acteurs participent au fonctionnement du service :',
        ],
        items: [
          "Google vous connecte. Il indique à l'instance qui vous êtes (identifiant, nom, avatar) ; l'instance ne reçoit jamais votre mot de passe Google. Google traite votre connexion selon sa propre politique de confidentialité (policies.google.com/privacy).",
          legal.hostingProvider
            ? `L'hébergeur, ${legal.hostingProvider}${legal.hostingCountry ? ` (${legal.hostingCountry})` : ''}, fait fonctionner le serveur et la base de données pour le compte de l'exploitant (un sous-traitant). Comme tout hébergeur, il peut conserver des journaux techniques de connexion.`
            : "L'hébergeur fait fonctionner le serveur et la base de données pour le compte de l'exploitant (un sous-traitant). Comme tout hébergeur, il peut conserver des journaux techniques de connexion.",
        ],
      },
      {
        id: 'rights',
        title: '7. Vos droits et comment les exercer',
        paragraphs: [
          "Vous pouvez accéder à vos données, les corriger, les supprimer, les exporter, en limiter l'usage et vous opposer à leur traitement.",
        ],
        items: [
          'Accès et portabilité : dans le menu du compte, « Exporter mes données » télécharge une archive ZIP avec un fichier de profil et chaque partition en JSON. Le nombre de demandes est limité à quelques-unes toutes les dix minutes.',
          "Effacement : dans le menu du compte, « Supprimer mon compte » supprime d'un coup votre compte, vos partitions, vos liens de partage et vos sessions. On vous demande d'abord de vous reconnecter avec Google puis de saisir une confirmation. C'est irréversible.",
          'Rectification : votre nom et votre avatar viennent de votre compte Google. Modifiez-les là-bas ; ils sont mis à jour à votre prochaine connexion.',
          'Tout le reste (limitation, opposition, une question) : utilisez le contact indiqué ci-dessus. Vous recevrez une réponse sous un mois. Si c’est le formulaire de contact, choisissez le sujet « Données personnelles » et laissez une adresse où vous répondre.',
          'Vous pouvez aussi introduire une réclamation auprès de votre autorité de protection des données (par exemple la CNIL en France).',
        ],
      },
      {
        id: 'security',
        title: '8. Sécurité',
        paragraphs: [
          "Les connexions utilisent HTTPS. Le navigateur ne détient jamais de jeton Google : le serveur garde votre session et le navigateur ne conserve qu'un cookie opaque. Les clés de session sont conservées hachées et les clés qui protègent les cookies sont chiffrées au repos.",
        ],
      },
    ],
  };
}
