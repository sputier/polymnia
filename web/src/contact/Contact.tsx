import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import {
  CONTACT_MAX_LENGTH,
  CONTACT_TOPICS,
  ContactError,
  fetchFormToken,
  sendContact,
  type ContactTopic,
} from '../api/contact';
import { isNetworkError } from '../api/scores';
import { LanguageSwitch } from '../components/LanguageSwitch';
import { ThemeSwitch } from '../components/ThemeSwitch';
import { useI18n } from '../i18n/i18n';
import { contactText, type ContactText } from './text';
import './contact.css';

/** What the address bar asks for: `#/contact?topic=report&page=<share token>` (the "Report this page" link). */
export function readPrefill(
  hash: string,
  origin: string,
): { topic: ContactTopic | undefined; pageUrl: string | undefined } {
  const query = hash.split('?')[1] ?? '';
  const params = new URLSearchParams(query);
  const topic = params.get('topic');
  const page = params.get('page');
  return {
    topic: (CONTACT_TOPICS as readonly string[]).includes(topic ?? '')
      ? (topic as ContactTopic)
      : undefined,
    // Only a well-formed share token becomes a link (same shape as the route), never free text from the URL.
    pageUrl: page && /^[A-Za-z0-9_-]{1,128}$/.test(page) ? `${origin}/#/s/${page}` : undefined,
  };
}

type Status =
  | { kind: 'editing' }
  | { kind: 'sending' }
  | { kind: 'sent' }
  | { kind: 'error'; message: string; fields: readonly string[] };

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function describe(error: unknown, text: ContactText): { message: string; fields: string[] } {
  if (error instanceof ContactError) {
    if (error.status === 429) return { message: text.errors.rate(error.retryAfter), fields: [] };
    if (error.status === 400 && error.fields.length > 0) {
      if (error.fields.includes('replyTo'))
        return { message: text.errors.replyTo, fields: ['replyTo'] };
      if (error.fields.includes('message'))
        return { message: text.errors.characters, fields: ['message'] };
    }
    return { message: text.errors.generic, fields: [] };
  }
  return { message: isNetworkError(error) ? text.errors.offline : text.errors.generic, fields: [] };
}

/** `#/contact`: the contact form. Public, no session needed; no e-mail address is shown (docs/contact.md). */
export function Contact() {
  const { language, t } = useI18n();
  const text = contactText(language);
  const [prefill] = useState(() => readPrefill(window.location.hash, window.location.origin));
  const [topic, setTopic] = useState<ContactTopic>(prefill.topic ?? 'question');
  const [message, setMessage] = useState(() =>
    prefill.pageUrl ? `${contactText(language).reportPrefix} ${prefill.pageUrl}\n\n` : '',
  );
  const [replyTo, setReplyTo] = useState('');
  const [website, setWebsite] = useState('');
  const [status, setStatus] = useState<Status>({ kind: 'editing' });
  const token = useRef<Promise<string> | null>(null);

  // The form token is fetched as the page opens, so the server's minimum filling time has passed by the time the
  // visitor has written something. A new one is fetched after each use or failure.
  const getToken = useCallback((fresh = false) => {
    if (fresh || token.current === null) {
      const pending = fetchFormToken().then((t2) => t2.token);
      pending.catch(() => {
        if (token.current === pending) token.current = null;
      });
      token.current = pending;
    }
    return token.current;
  }, []);
  useEffect(() => {
    getToken().catch(() => undefined);
  }, [getToken]);

  useEffect(() => {
    const previous = document.title;
    document.title = `${text.title} · ${t('app.name')}`;
    return () => {
      document.title = previous;
    };
  }, [text.title, t]);

  const used = message.length;
  const tooLong = used > CONTACT_MAX_LENGTH;
  const canSend = message.trim().length > 0 && !tooLong && status.kind !== 'sending';

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!canSend) return;
    setStatus({ kind: 'sending' });
    const fields = { topic, message, replyTo, website };
    try {
      try {
        await sendContact(await getToken(), fields);
      } catch (error) {
        // An expired or too fresh token: fetch another, let the minimum time pass, send once more.
        if (!(
          error instanceof ContactError &&
          error.status === 400 &&
          error.code === 'contact-token'
        )) {
          throw error;
        }
        const fresh = await getToken(true);
        await sleep(2200);
        await sendContact(fresh, fields);
      }
      token.current = null;
      setStatus({ kind: 'sent' });
    } catch (error) {
      token.current = null;
      getToken().catch(() => undefined);
      setStatus({ kind: 'error', ...describe(error, text) });
    }
  };

  const reset = () => {
    setMessage('');
    setReplyTo('');
    setWebsite('');
    setTopic('question');
    setStatus({ kind: 'editing' });
    getToken().catch(() => undefined);
  };

  const invalid = (field: string) => status.kind === 'error' && status.fields.includes(field);

  return (
    <div className="contact">
      <header className="toolbar">
        <a className="brand" href="#/">
          {t('app.name')}
        </a>
        <div className="toolbar-actions">
          <a className="btn" href="#/">
            {text.back}
          </a>
          <LanguageSwitch />
          <ThemeSwitch />
        </div>
      </header>
      <main className="contact-main">
        <h1>{text.title}</h1>
        {status.kind === 'sent' ? (
          <section role="status" aria-labelledby="contact-sent">
            <h2 id="contact-sent">{text.sentTitle}</h2>
            <p>{text.sentBody}</p>
            <button type="button" className="btn" onClick={reset}>
              {text.another}
            </button>
          </section>
        ) : (
          <form onSubmit={(e) => void submit(e)} noValidate>
            <p className="lead">{text.intro}</p>
            <div className="field">
              <label htmlFor="contact-topic">{text.topicLabel}</label>
              <select
                id="contact-topic"
                value={topic}
                onChange={(e) => setTopic(e.target.value as ContactTopic)}
              >
                {CONTACT_TOPICS.map((value) => (
                  <option key={value} value={value}>
                    {text.topics[value]}
                  </option>
                ))}
              </select>
            </div>
            {prefill.pageUrl && topic === 'report' && (
              <p className="hint muted">{text.reportNote}</p>
            )}
            <div className="field">
              <label htmlFor="contact-message">{text.messageLabel}</label>
              <textarea
                id="contact-message"
                value={message}
                rows={8}
                required
                aria-invalid={tooLong || invalid('message')}
                aria-describedby="contact-counter"
                onChange={(e) => setMessage(e.target.value)}
              />
              <span id="contact-counter" className={tooLong ? 'contact-over' : 'muted'}>
                {text.counter(used, CONTACT_MAX_LENGTH)}
              </span>
            </div>
            <div className="field">
              <label htmlFor="contact-reply-to">{text.replyToLabel}</label>
              <input
                id="contact-reply-to"
                type="email"
                inputMode="email"
                autoComplete="email"
                maxLength={254}
                value={replyTo}
                aria-invalid={invalid('replyTo')}
                aria-describedby="contact-reply-hint"
                onChange={(e) => setReplyTo(e.target.value)}
              />
              <span id="contact-reply-hint" className="hint muted">
                {text.replyToHint}
              </span>
            </div>
            {/* The honeypot: out of sight and of the keyboard path, so only a robot fills it. */}
            <div className="contact-hp" aria-hidden="true">
              <label>
                {text.websiteLabel}
                <input
                  type="text"
                  name="website"
                  tabIndex={-1}
                  autoComplete="off"
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                />
              </label>
            </div>
            {status.kind === 'error' && (
              <p role="alert" className="contact-error">
                {status.message}
              </p>
            )}
            <div>
              <button type="submit" className="btn primary" disabled={!canSend}>
                {status.kind === 'sending' ? text.sending : text.send}
              </button>
            </div>
          </form>
        )}
      </main>
    </div>
  );
}
