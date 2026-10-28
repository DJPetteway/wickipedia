import type { Article } from '../../engine/article';

/** The read, written up like an encyclopedia entry. */
export function ArticleCard({ a }: { a: Article }) {
  return (
    <article className={`wiki tone-${a.tone}`} aria-labelledby="wiki-title">
      <header className="wiki-head">
        <h1 id="wiki-title">{a.title}</h1>
        <p className="wiki-from">From Wickipedia, the free market encyclopedia</p>
        <p className="wiki-sub">{a.subtitle}</p>
      </header>

      {a.hatnote && (
        <p className="wiki-hatnote" role="status">
          {a.hatnote}
        </p>
      )}

      <div className="wiki-body">
        {a.infobox.length > 0 && (
          <table className="wiki-infobox">
            <caption>{a.title}</caption>
            <tbody>
              {a.infobox.map((r) => (
                <tr key={r.label}>
                  <th scope="row">{r.label}</th>
                  <td>{r.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <section aria-labelledby="wiki-read">
          <h2 id="wiki-read">Read</h2>
          <div className="wiki-verdict" aria-live="polite" aria-atomic="true">
            <span key={a.key} className="verdict-chip">
              {a.verdict}
            </span>
          </div>
          <p className="wiki-lede">
            {a.lede}
            <sup>
              <a href="#wiki-refs">[1]</a>
            </sup>
          </p>
        </section>

        {a.checks.length > 0 && (
          <section aria-labelledby="wiki-verify">
            <h2 id="wiki-verify">Verification</h2>
            <ul className="wiki-checks">
              {a.checks.map((c) => (
                <li key={c.id} className={c.pass === null ? 'unk' : c.pass ? 'ok' : 'no'}>
                  <span className="mark" aria-label={c.pass === null ? 'unknown' : c.pass ? 'pass' : 'fail'}>
                    {c.pass === null ? '–' : c.pass ? '✓' : '✗'}
                  </span>
                  <span>
                    <strong>{c.label}.</strong> {c.detail}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="wiki-refs" id="wiki-refs" aria-label="References">
          <ol>
            {a.citations.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ol>
        </section>
      </div>
    </article>
  );
}
