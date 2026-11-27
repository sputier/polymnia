import { Icon } from '../components/Icon';
import { LanguageSwitch } from '../components/LanguageSwitch';
import { ModeToggle } from '../components/ModeToggle';
import { SaveStatus, type SaveState } from '../components/SaveStatus';
import { ThemeSwitch } from '../components/ThemeSwitch';
import { useI18n } from '../i18n/i18n';
import { ROUTE_HREF } from '../route/useRoute';
import type { UiMode } from './uiMode';

interface TopBarProps {
  title: string;
  onTitleChange: (title: string) => void;
  saveState: SaveState;
  mode: UiMode;
  onModeChange: (mode: UiMode) => void;
  leftOpen: boolean;
  onToggleLeft: () => void;
  rightOpen: boolean;
  onToggleRight: () => void;
}

export function TopBar(props: TopBarProps) {
  const { t } = useI18n();
  const advanced = props.mode === 'advanced';

  return (
    <header className="etop">
      <a className="btn ghost icon" href={ROUTE_HREF.home} aria-label={t('editor.back')}>
        <Icon name="back" />
      </a>
      <button
        type="button"
        className="btn ghost icon"
        aria-label={t('instruments.toggle')}
        title={t('instruments.toggle')}
        aria-expanded={props.leftOpen}
        aria-controls="panel-instruments"
        onClick={props.onToggleLeft}
      >
        <Icon name="panelLeft" />
      </button>
      <input
        className="title-in"
        value={props.title}
        placeholder={t('editor.untitled')}
        aria-label={t('editor.titleLabel')}
        spellCheck={false}
        onChange={(event) => props.onTitleChange(event.target.value)}
      />
      <SaveStatus state={props.saveState} />
      <span className="sp" />
      <ModeToggle mode={props.mode} onChange={props.onModeChange} />
      <button
        type="button"
        className="btn"
        aria-disabled="true"
        aria-label={t('editor.share')}
        title={`${t('editor.share')} · ${t('editor.soon')}`}
      >
        <Icon name="share" />
        <span className="lbl">{t('editor.share')}</span>
      </button>
      <button
        type="button"
        className="btn primary"
        aria-disabled="true"
        aria-label={t('editor.export')}
        title={`${t('editor.export')} · ${t('editor.soon')}`}
      >
        <Icon name="download" />
        <span className="lbl">{t('editor.export')}</span>
      </button>
      <ThemeSwitch />
      <LanguageSwitch />
      {advanced && (
        <button
          type="button"
          className="btn ghost icon"
          aria-label={t('inspector.toggle')}
          title={t('inspector.toggle')}
          aria-expanded={props.rightOpen}
          aria-controls="panel-inspector"
          onClick={props.onToggleRight}
        >
          <Icon name="panelRight" />
        </button>
      )}
    </header>
  );
}
