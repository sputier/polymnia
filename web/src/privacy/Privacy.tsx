import { useCallback, useEffect, useState } from 'react';
import { fetchLegal, type LegalInfo } from '../api/account';
import { LanguageSwitch } from '../components/LanguageSwitch';
import { ThemeSwitch } from '../components/ThemeSwitch';
import { useI18n } from '../i18n/i18n';
import { policyText } from './content';
import './privacy.css';

type Load = { status: 'loading' } | { status: 'error' } | { status: 'ready'; legal: LegalInfo };

/** `#/privacy`: the privacy policy. Public (no session needed); the operator's details come from `GET /api/legal`. */
export default function Privacy() {
  const { language, t } = useI18n();
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetchLegal().then(
      (legal) => {
        if (!cancelled) setLoad({ status: 'ready', legal });
      },
      () => {
        if (!cancelled) setLoad({ status: 'error' });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const retry = useCallback(() => {
    setLoad({ status: 'loading' });
    setAttempt((n) => n + 1);
  }, []);

  useEffect(() => {
    const previous = document.title;
    return () => {
      document.title = previous;
    };
  }, []);

  const text = load.status === 'ready' ? policyText(language, load.legal) : undefined;
  useEffect(() => {
    if (text) document.title = `${text.title} · ${t('app.name')}`;
  }, [text, t]);

  // The static strings of the shell come from the catalog of the first load; the policy text from its own chunk.
  const labels = policyText(language, EMPTY_LEGAL);

  return (
    <div className="privacy">
      <header className="toolbar">
        <a className="brand" href="#/">
          {t('app.name')}
        </a>
        <div className="toolbar-actions">
          <a className="btn" href="#/">
            {labels.back}
          </a>
          <LanguageSwitch />
          <ThemeSwitch />
        </div>
      </header>
      <main className="privacy-main">
        <h1>{labels.title}</h1>
        {load.status === 'loading' && (
          <p role="status" className="muted">
            {labels.loading}
          </p>
        )}
        {load.status === 'error' && (
          <>
            <p role="alert">{labels.loadError}</p>
            <button type="button" className="btn" onClick={retry}>
              {labels.retry}
            </button>
          </>
        )}
        {text && load.status === 'ready' && (
          <>
            <p className="lead">{text.intro}</p>
            <Operator text={text} legal={load.legal} />
            {text.sections.map((section) => (
              <section key={section.id} aria-labelledby={`privacy-${section.id}`}>
                <h2 id={`privacy-${section.id}`}>{section.title}</h2>
                {section.paragraphs.map((p) => (
                  <p key={p}>{p}</p>
                ))}
                {section.items && (
                  <ul>
                    {section.items.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                )}
              </section>
            ))}
          </>
        )}
      </main>
    </div>
  );
}

const EMPTY_LEGAL: LegalInfo = {
  configured: false,
  operatorName: null,
  contact: null,
  contactKind: null,
  address: null,
  hostingProvider: null,
  hostingCountry: null,
  logRetentionDays: 0,
  sessionIdleDays: 0,
  sessionAbsoluteDays: 0,
};

function Operator({ text, legal }: { text: ReturnType<typeof policyText>; legal: LegalInfo }) {
  if (!legal.configured) {
    return (
      <aside className="privacy-card privacy-placeholder" role="note">
        <strong>{text.placeholderTitle}</strong>
        <p>{text.placeholderBody}</p>
      </aside>
    );
  }
  return (
    <aside className="privacy-card" aria-label={text.operatorLabel}>
      <dl>
        <dt>{text.operatorLabel}</dt>
        <dd>{legal.operatorName}</dd>
        <dt>{text.contactLabel}</dt>
        <dd>
          <Contact legal={legal} />
        </dd>
        {legal.address && (
          <>
            <dt>{text.addressLabel}</dt>
            <dd>{legal.address}</dd>
          </>
        )}
        {legal.hostingProvider && (
          <>
            <dt>{text.hostingLabel}</dt>
            <dd>
              {legal.hostingProvider}
              {legal.hostingCountry ? `, ${legal.hostingCountry}` : ''}
            </dd>
          </>
        )}
      </dl>
    </aside>
  );
}

/** The contact is a link only when the server says it is an e-mail address or an https URL (it checks both). */
function Contact({ legal }: { legal: LegalInfo }) {
  const contact = legal.contact ?? '';
  if (legal.contactKind === 'email') return <a href={`mailto:${contact}`}>{contact}</a>;
  if (legal.contactKind === 'url' && /^https:\/\//i.test(contact)) {
    return (
      <a href={contact} rel="noopener noreferrer" target="_blank">
        {contact}
      </a>
    );
  }
  return <>{contact}</>;
}
