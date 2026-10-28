import { useEffect, useRef, useState } from 'react';
import type { Oracle } from '../../engine/oracle';

/**
 * The magic-8-ball window. The answer "floats up" whenever it changes; the
 * evidence line updates in place every tick.
 */
export function EightBall({ oracle }: { oracle: Oracle }) {
  const [shake, setShake] = useState(0);
  const last = useRef(oracle.key);
  useEffect(() => {
    if (last.current !== oracle.key) {
      last.current = oracle.key;
      setShake((n) => n + 1);
    }
  }, [oracle.key]);

  return (
    <section className={`eight glass tone-${oracle.tone}`} aria-labelledby="eight-h">
      <div className="eight-ball" aria-hidden="true">
        <span>8</span>
      </div>
      <div className="eight-body">
        <h2 id="eight-h" className="sr-only">
          What the chain says
        </h2>
        <div className="eight-window" aria-live="polite" aria-atomic="true">
          <p key={shake} className="eight-answer">
            {oracle.answer}
          </p>
        </div>
        <p className="eight-detail">{oracle.detail}</p>
        {oracle.odds && <p className="eight-odds">{oracle.odds}</p>}
      </div>
    </section>
  );
}
