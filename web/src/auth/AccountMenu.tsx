import { useI18n } from '../i18n/i18n';
import { useSession } from './session';

/** Display name and sign-out, in the toolbar. Renders nothing for an anonymous visitor. */
export function AccountMenu() {
  const { state, signOut } = useSession();
  const { t } = useI18n();

  if (state.status !== 'signedIn') return null;

  return (
    <div role="group" aria-label={t('auth.account')} className="account">
      {state.user.avatarUrl && (
        <img
          className="avatar"
          src={state.user.avatarUrl}
          alt=""
          width="24"
          height="24"
          referrerPolicy="no-referrer"
        />
      )}
      <span className="account-name">{state.user.displayName}</span>
      <button type="button" className="btn" onClick={() => void signOut()}>
        {t('auth.signOut')}
      </button>
    </div>
  );
}
