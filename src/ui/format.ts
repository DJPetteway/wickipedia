export { fmtPx, fmtUsd, fmtBps } from '../engine/copy';

export const fmtPct = (x: number, digits = 0) => `${(x * 100).toFixed(digits)}%`;

export const fmtSigned = (x: number, digits = 2) => `${x >= 0 ? '+' : '−'}${Math.abs(x).toFixed(digits)}`;

export const fmtQty = (x: number) => {
  const a = Math.abs(x);
  if (a >= 1e6) return `${(x / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `${(x / 1e3).toFixed(1)}K`;
  if (a >= 10) return x.toFixed(1);
  return x.toFixed(3);
};

export const fmtTime = (ts: number) =>
  new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

export const fmtAge = (ms: number | null) => {
  if (ms === null) return '—';
  if (ms < 1000) return `${Math.max(0, Math.round(ms))}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms / 60_000)}m`;
};

export const fmtHorizon = (sec: number) => (sec < 60 ? `${sec}s` : `${Math.round(sec / 60)}m`);
