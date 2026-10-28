import type { ChainId } from '../engine/types';

export { fmtPct, fmtPx, fmtUsd, shortAddr } from '../engine/copy';

export const fmtShare = (x: number, digits = 0) => `${(x * 100).toFixed(digits)}%`;

export const fmtQty = (x: number) => {
  const a = Math.abs(x);
  if (a >= 1e9) return `${(x / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${(x / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `${(x / 1e3).toFixed(1)}K`;
  if (a >= 10) return x.toFixed(1);
  return x.toFixed(3);
};

export const fmtTime = (ts: number) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

export const fmtAge = (ms: number | null) => {
  if (ms === null) return '—';
  if (ms < 1000) return `${Math.max(0, Math.round(ms))}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h`;
  return `${Math.round(ms / 86_400_000)}d`;
};

export const fmtHorizon = (sec: number) => (sec < 60 ? `${sec}s` : sec < 3600 ? `${Math.round(sec / 60)}m` : `${Math.round(sec / 3600)}h`);

/** Block-explorer links. Robinhood Chain has no explorer we can verify, so none is linked. */
export function explorer(chain: ChainId, kind: 'tx' | 'address' | 'token', id: string): string | null {
  if (chain === 'solana') return kind === 'tx' ? `https://solscan.io/tx/${id}` : kind === 'token' ? `https://solscan.io/token/${id}` : `https://solscan.io/account/${id}`;
  if (chain === 'arbitrum') return `https://arbiscan.io/${kind === 'tx' ? 'tx' : kind === 'token' ? 'token' : 'address'}/${id}`;
  return null;
}
