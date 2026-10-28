import { useEffect, useRef, useState } from 'react';
import type { Oracle } from '../../engine/oracle';

/**
 * A real-looking magic 8-ball. The answer floats up in the window and the
 * ball gives a little shake whenever the answer changes. The evidence behind
 * the answer is kept for screen readers and the hover title, not shown.
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
    <section className={`ball-wrap tone-${oracle.tone}`} aria-label="Magic 8-ball" title={oracle.detail}>
      <div className="ball" key={`b${shake}`}>
        <div className="ball-shine" aria-hidden="true" />
        <div className="ball-window">
          <div className="ball-tri" aria-hidden="true" />
          <p key={shake} className="ball-answer" aria-live="polite" aria-atomic="true">
            {oracle.answer}
          </p>
        </div>
      </div>
      <p className="sr-only" aria-live="polite">
        {oracle.detail}
      </p>
      <div className="ball-shadow" aria-hidden="true" />
    </section>
  );
}
