import { LANGUAGES, loadCatalog, useI18n } from '../i18n/i18n';

export function LanguageSwitch() {
  const { t, language, setLanguage } = useI18n();

  return (
    <div role="group" aria-label={t('language.label')} className="segmented">
      {LANGUAGES.map((code) => (
        <button
          key={code}
          type="button"
          className="btn"
          lang={code}
          aria-pressed={language === code}
          // Warm the other catalog as soon as the pointer or the focus gets there: the switch is then instant.
          onPointerEnter={() => void loadCatalog(code).catch(() => undefined)}
          onFocus={() => void loadCatalog(code).catch(() => undefined)}
          onClick={() => void setLanguage(code)}
        >
          {code.toUpperCase()}
          <span className="visually-hidden"> {t(`language.${code}`)}</span>
        </button>
      ))}
    </div>
  );
}
