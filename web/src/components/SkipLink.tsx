import { useI18n } from '../i18n/i18n';
import type { MessageKey } from '../i18n/en';

interface SkipLinkProps {
  /** Id of the element that receives the focus (it carries `tabIndex={-1}`). */
  target: string;
  label: Extract<MessageKey, 'a11y.skipToScore' | 'a11y.skipToContent'>;
}

/**
 * First stop of the Tab order, visible only while focused. A button rather than a `#fragment` link: the app uses
 * the hash for routing, so a fragment would navigate away.
 */
export function SkipLink({ target, label }: SkipLinkProps) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      className="skip-link"
      onClick={() => document.getElementById(target)?.focus()}
    >
      {t(label)}
    </button>
  );
}
