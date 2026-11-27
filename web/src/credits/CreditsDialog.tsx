import { Dialog } from '../editor/commands/Dialog';
import { useI18n } from '../i18n/i18n';
import { CC_BY_4, CREDITS_TEXT, NOTICES_URL, SAMPLE_CREDITS } from './content';
import './credits.css';

/**
 * "About and credits": every sample set with its author, license and link, and the attribution that CC BY 4.0
 * requires. A lazy chunk (its text is not in the i18n catalogs), opened from the toolbar and the command palette.
 */
export default function CreditsDialog({ onClose }: { onClose: () => void }) {
  const { language } = useI18n();
  const text = CREDITS_TEXT[language];

  return (
    <Dialog className="dlg-form dlg-credits" labelledBy="credits-title" onClose={onClose}>
      <div className="dlg-body">
        <h2 id="credits-title">{text.title}</h2>
        <p>{text.intro}</p>
        <table className="credits-table">
          <thead>
            <tr>
              <th scope="col">{text.columns.instrument}</th>
              <th scope="col">{text.columns.recording}</th>
              <th scope="col">{text.columns.author}</th>
              <th scope="col">{text.columns.license}</th>
            </tr>
          </thead>
          <tbody>
            {SAMPLE_CREDITS.map((credit) => (
              <tr key={credit.id} data-set={credit.id}>
                <th scope="row">{credit.instrument[language]}</th>
                <td>
                  <a href={credit.source} target="_blank" rel="noopener noreferrer">
                    {credit.work}
                  </a>
                </td>
                <td>{credit.author}</td>
                <td>
                  <a href={credit.license.url} target="_blank" rel="noopener noreferrer">
                    {credit.license.name}
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <section className="credits-attribution" aria-labelledby="credits-attribution-title">
          <h3 id="credits-attribution-title">{text.attributionTitle}</h3>
          <p lang="en">
            {text.attribution} (
            <a href={CC_BY_4.url} target="_blank" rel="noopener noreferrer">
              {CC_BY_4.name}
            </a>
            )
          </p>
          <p className="muted">{text.changes}</p>
          <p className="muted">{text.noEndorsement}</p>
        </section>
        <p className="muted">
          {text.license}{' '}
          <a href={NOTICES_URL} target="_blank" rel="noopener noreferrer">
            {text.licenseLink}
          </a>
        </p>
        <div className="dlg-actions">
          <button type="button" className="btn primary" data-autofocus onClick={onClose}>
            {text.close}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
