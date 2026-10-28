import { useEffect, useRef } from 'react';
import { LESSONS, type LessonId } from '../content';
import { WickDiagram } from './Candles';

function renderEm(text: string) {
  // tiny *emphasis* support for lesson copy
  return text.split(/(\*[^*]+\*)/g).map((p, i) => (p.startsWith('*') && p.endsWith('*') ? <em key={i}>{p.slice(1, -1)}</em> : p));
}

export function WickSchool({ open, focus, onClose, onPick }: { open: boolean; focus: LessonId | null; onClose: () => void; onPick: (id: LessonId) => void }) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  useEffect(() => {
    if (!open || !focus) return;
    // Scroll only the lesson pane — scrollIntoView would also scroll the dialog and hide its header.
    const el = document.getElementById(`lesson-${focus}`);
    const pane = el?.parentElement;
    if (el && pane) pane.scrollTop = el.offsetTop; // pane is position:relative, so offsetTop is pane-relative
  }, [open, focus]);

  return (
    <dialog ref={ref} className="school" aria-labelledby="school-h" onClose={onClose} onCancel={onClose}>
      <header className="school-h">
        <div>
          <h2 id="school-h">Wick School</h2>
          <p className="muted">How to read an order book in 13 short lessons. No hopium.</p>
        </div>
        <button type="button" className="btn" onClick={onClose} autoFocus>
          Close
        </button>
      </header>
      <div className="school-body">
        <nav aria-label="Lessons" className="school-nav">
          <ol>
            {LESSONS.map((l) => (
              <li key={l.id}>
                <button type="button" aria-current={focus === l.id ? 'true' : undefined} onClick={() => onPick(l.id)}>
                  {l.title}
                </button>
              </li>
            ))}
          </ol>
        </nav>
        <div className="school-lessons">
          {LESSONS.map((l) => (
            <article key={l.id} id={`lesson-${l.id}`} className={`lesson ${focus === l.id ? 'focus' : ''}`}>
              <h3>{l.title}</h3>
              <p className="tldr">{l.tldr}</p>
              {l.candle && <WickDiagram />}
              {l.body.map((b, i) => (
                <p key={i}>{renderEm(b)}</p>
              ))}
            </article>
          ))}
          <p className="disclaimer">
            Wickipedia describes what the order book is doing. It is not financial advice, and nothing here guarantees a move. Order books can be spoofed,
            pulled and refilled in milliseconds.
          </p>
        </div>
      </div>
    </dialog>
  );
}
