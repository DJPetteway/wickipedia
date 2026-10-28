import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { LessonId } from '../content';

export const LessonContext = createContext<(id: LessonId) => void>(() => undefined);

export function LearnButton({ lesson, label }: { lesson: LessonId; label: string }) {
  const open = useContext(LessonContext);
  return (
    <button type="button" className="learn" onClick={() => open(lesson)} aria-label={`Explain: ${label}`} title={`What is ${label}?`}>
      ?
    </button>
  );
}

export function Panel({
  title,
  lesson,
  kicker,
  children,
  className = '',
  id,
}: {
  title: string;
  lesson?: LessonId;
  kicker?: ReactNode;
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  const hid = id ? `${id}-h` : undefined;
  return (
    <section className={`panel ${className}`} aria-labelledby={hid} id={id}>
      <header className="panel-h">
        <h2 id={hid}>
          {title}
          {lesson && <LearnButton lesson={lesson} label={title} />}
        </h2>
        {kicker && <div className="panel-k">{kicker}</div>}
      </header>
      {children}
    </section>
  );
}

/** Tiny line sparkline with a zero baseline when the series crosses zero. */
export function Sparkline({
  data,
  width = 160,
  height = 36,
  label,
  className = '',
}: {
  data: number[];
  width?: number;
  height?: number;
  label: string;
  className?: string;
}) {
  if (data.length < 2) return <div className="spark-empty" style={{ width, height }} aria-label={`${label}: collecting`} />;
  let lo = Math.min(...data);
  let hi = Math.max(...data);
  if (hi === lo) {
    hi += 1;
    lo -= 1;
  }
  const x = (i: number) => (i / (data.length - 1)) * width;
  const y = (v: number) => height - 2 - ((v - lo) / (hi - lo)) * (height - 4);
  const d = data.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const zero = lo < 0 && hi > 0 ? y(0) : null;
  const last = data[data.length - 1];
  return (
    <svg className={`spark ${className}`} width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${label}, latest ${last.toFixed(2)}`}>
      {zero !== null && <line x1={0} x2={width} y1={zero} y2={zero} className="spark-zero" />}
      <path d={d} className="spark-line" />
      <circle cx={x(data.length - 1)} cy={y(last)} r={2.5} className="spark-dot" />
    </svg>
  );
}

/** Diverging bar centred on zero, value in [−1, 1]. Direction is also spelled out in text. */
export function DivergingBar({ value, label, detail }: { value: number; label: string; detail?: string }) {
  const v = Math.max(-1, Math.min(1, value));
  const pct = Math.abs(v) * 50;
  const side = v >= 0 ? 'bid' : 'ask';
  return (
    <div className="dbar" role="meter" aria-valuemin={-100} aria-valuemax={100} aria-valuenow={Math.round(v * 100)} aria-label={`${label}: ${Math.round(v * 100)}% ${v >= 0 ? 'bid-heavy' : 'ask-heavy'}`}>
      <span className="dbar-label">{label}</span>
      <span className="dbar-track">
        <span className="dbar-mid" />
        <span className={`dbar-fill ${side}`} style={v >= 0 ? { left: '50%', width: `${pct}%` } : { right: '50%', width: `${pct}%` }} />
      </span>
      <span className={`dbar-val ${Math.abs(v) < 0.05 ? '' : side}`}>
        {Math.abs(v) < 0.05 ? 'even' : `${v > 0 ? '▲' : '▼'} ${Math.abs(v * 100).toFixed(0)}%`}
      </span>
      {detail && <span className="dbar-detail">{detail}</span>}
    </div>
  );
}

/**
 * Measures an element's width so SVG charts can draw at true pixel size (no
 * stretched text). Returns a callback ref, so it also works for containers
 * that only mount once data arrives.
 */
export function useWidth<T extends HTMLElement>(fallback = 640) {
  const [w, setW] = useState(fallback);
  const ro = useRef<ResizeObserver | null>(null);
  const ref = useCallback((el: T | null) => {
    ro.current?.disconnect();
    ro.current = null;
    if (!el || typeof ResizeObserver === 'undefined') return;
    ro.current = new ResizeObserver(([e]) => setW(Math.max(200, Math.round(e.contentRect.width))));
    ro.current.observe(el);
  }, []);
  useEffect(() => () => ro.current?.disconnect(), []);
  return [ref, w] as const;
}
