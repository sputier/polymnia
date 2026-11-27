import { Icon } from '../components/Icon';
import { Kbd } from '../components/Kbd';
import { formatKeys } from '../shortcuts/registry';
import { AccountMenu } from '../auth/AccountMenu';
import { LanguageSwitch } from '../components/LanguageSwitch';
import { ModeToggle } from '../components/ModeToggle';
import { SaveStatus, type SaveState } from '../components/SaveStatus';
import { ThemeSwitch } from '../components/ThemeSwitch';
import { useI18n } from '../i18n/i18n';
import { ROUTE_HREF } from '../route/useRoute';
import { ExportMenu, ImportButton, type ExportFormat } from './FileMenu';
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
  onOpenPalette: () => void;
  onToggleFocus: () => void;
  onExport: (format: ExportFormat) => void;
  onImportFile: (file: File) => void;
  onBeforeLeave?: () => boolean;
}

export function TopBar(props: TopBarProps) {
  const { t } = useI18n();
  const advanced = props.mode === 'advanced';

  return (
    <header className="etop">
      <a
        className="btn ghost icon"
        href={ROUTE_HREF.home}
        aria-label={t('editor.back')}
        onClick={(event) => {
          if (props.onBeforeLeave && !props.onBeforeLeave()) event.preventDefault();
        }}
      >
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
        maxLength={200}
        onChange={(event) => props.onTitleChange(event.target.value)}
      />
      <SaveStatus state={props.saveState} />
      <span className="sp" />
      <button
        type="button"
        className="cmdk"
        aria-label={t('cmd.openLabel')}
        aria-haspopup="dialog"
        onClick={props.onOpenPalette}
      >
        <Icon name="search" />
        <span className="l">{t('cmd.open')}</span>
        <Kbd keys="Mod+K" />
      </button>
      <button
        type="button"
        className="btn ghost icon"
        aria-label={t('focus.toggle')}
        title={`${t('focus.toggle')} (${formatKeys('Alt+F').join('+')})`}
        onClick={props.onToggleFocus}
      >
        <Icon name="focus" />
      </button>
      <ModeToggle mode={props.mode} onChange={props.onModeChange} />
      <ImportButton onFile={props.onImportFile} />
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
      <ExportMenu onExport={props.onExport} />
      <ThemeSwitch />
      <LanguageSwitch />
      <AccountMenu />
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
