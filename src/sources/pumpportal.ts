import { curvePriceSol, pumpProgress, pumpSolToGraduate } from '../engine/amm';
import type { BondingCurveState, Swap } from '../engine/types';
import { defaultWs, type WsFactory, type WsLike } from './net';

/**
 * PumpPortal free real-time data WebSocket for pump.fun
 * (https://pumpportal.fun/data-api/real-time). One connection per client is
 * requested by the provider, so everything shares this hub.
 */
export const PUMPPORTAL_WS = 'wss://pumpportal.fun/api/data';

export interface PumpTradeMsg {
  signature: string;
  mint: string;
  traderPublicKey?: string;
  txType: 'buy' | 'sell' | 'create' | 'migrate' | string;
  tokenAmount?: number;
  solAmount?: number;
  vTokensInBondingCurve?: number;
  vSolInBondingCurve?: number;
  marketCapSol?: number;
  name?: string;
  symbol?: string;
  uri?: string;
  pool?: string;
}

export interface NewLaunch {
  mint: string;
  name: string;
  symbol: string;
  ts: number;
  marketCapSol: number | null;
  initialBuySol: number | null;
}

/** Turn a curve trade into a normalized swap + curve state. Needs SOL/USD. */
export function parsePumpTrade(m: PumpTradeMsg, solUsd: number, receivedAt: number): { swap: Swap | null; curve: BondingCurveState | null } {
  let curve: BondingCurveState | null = null;
  if (typeof m.vSolInBondingCurve === 'number' && typeof m.vTokensInBondingCurve === 'number') {
    curve = {
      vSol: m.vSolInBondingCurve,
      vTokens: m.vTokensInBondingCurve,
      solUsd,
      progress: pumpProgress(m.vTokensInBondingCurve),
      solToGraduate: pumpSolToGraduate(m.vSolInBondingCurve),
      graduated: false,
    };
  }
  if ((m.txType !== 'buy' && m.txType !== 'sell') || !m.tokenAmount || !m.solAmount) return { swap: null, curve };
  const priceSol = m.solAmount / m.tokenAmount;
  return {
    swap: {
      id: m.signature,
      // PumpPortal messages carry no block time; receive time is within a second or two.
      ts: receivedAt,
      priceUsd: priceSol * solUsd,
      baseAmount: m.tokenAmount,
      usd: m.solAmount * solUsd,
      side: m.txType,
      wallet: m.traderPublicKey,
    },
    curve,
  };
}

/** Curve price in USD from the post-trade virtual reserves. */
export const curvePriceUsd = (c: BondingCurveState) => (c.solUsd ? curvePriceSol(c.vSol, c.vTokens) * c.solUsd : null);

type Listener = (m: PumpTradeMsg) => void;

export class PumpPortalHub {
  private ws: WsLike | null = null;
  private tokenKeys = new Map<string, number>();
  private newTokenSubs = 0;
  private migrationSubs = 0;
  private listeners = new Set<Listener>();
  private statusListeners = new Set<(s: 'open' | 'closed', detail?: string) => void>();
  private retry = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private url = PUMPPORTAL_WS,
    private makeWs: WsFactory = defaultWs,
  ) {}

  setUrl(url: string): void {
    if (url === this.url) return;
    this.url = url;
    this.ws?.close();
  }

  on(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  onStatus(l: (s: 'open' | 'closed', detail?: string) => void): () => void {
    this.statusListeners.add(l);
    return () => this.statusListeners.delete(l);
  }

  get isOpen(): boolean {
    return this.ws?.readyState === 1;
  }

  subscribeToken(mint: string): () => void {
    this.tokenKeys.set(mint, (this.tokenKeys.get(mint) ?? 0) + 1);
    this.ensure();
    if (this.isOpen) this.send({ method: 'subscribeTokenTrade', keys: [mint] });
    return () => {
      const n = (this.tokenKeys.get(mint) ?? 1) - 1;
      if (n > 0) this.tokenKeys.set(mint, n);
      else {
        this.tokenKeys.delete(mint);
        if (this.isOpen) this.send({ method: 'unsubscribeTokenTrade', keys: [mint] });
      }
      this.maybeClose();
    };
  }

  subscribeNewTokens(): () => void {
    this.newTokenSubs++;
    this.ensure();
    if (this.isOpen && this.newTokenSubs === 1) this.send({ method: 'subscribeNewToken' });
    return () => {
      this.newTokenSubs--;
      if (this.newTokenSubs === 0 && this.isOpen) this.send({ method: 'unsubscribeNewToken' });
      this.maybeClose();
    };
  }

  subscribeMigrations(): () => void {
    this.migrationSubs++;
    this.ensure();
    if (this.isOpen && this.migrationSubs === 1) this.send({ method: 'subscribeMigration' });
    return () => {
      this.migrationSubs--;
      this.maybeClose();
    };
  }

  private send(o: unknown) {
    this.ws?.send(JSON.stringify(o));
  }

  private ensure(): void {
    if (this.ws || this.timer) return;
    let ws: WsLike;
    try {
      ws = this.makeWs(this.url);
    } catch (e) {
      this.emitStatus('closed', String(e));
      this.schedule();
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      if (this.newTokenSubs > 0) this.send({ method: 'subscribeNewToken' });
      if (this.migrationSubs > 0) this.send({ method: 'subscribeMigration' });
      if (this.tokenKeys.size) this.send({ method: 'subscribeTokenTrade', keys: [...this.tokenKeys.keys()] });
      this.emitStatus('open');
    };
    ws.onmessage = (ev) => {
      let m: PumpTradeMsg & { message?: string; errors?: unknown };
      try {
        m = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      if (!m || !m.mint) return; // subscription acks etc.
      for (const l of this.listeners) l(m);
    };
    ws.onerror = () => undefined;
    ws.onclose = (ev) => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.emitStatus('closed', ev?.reason || (ev?.code ? `code ${ev.code}` : undefined));
      if (this.wanted) this.schedule();
    };
  }

  private get wanted(): boolean {
    return this.tokenKeys.size > 0 || this.newTokenSubs > 0 || this.migrationSubs > 0;
  }

  private maybeClose(): void {
    if (this.wanted) return;
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onclose = null;
      ws.close();
    }
  }

  private schedule(): void {
    const delay = Math.min(30_000, 1000 * 2 ** this.retry++);
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.wanted) this.ensure();
    }, delay);
  }

  private emitStatus(s: 'open' | 'closed', detail?: string) {
    for (const l of this.statusListeners) l(s, detail);
  }
}

let hub: PumpPortalHub | null = null;
export function pumpHub(url?: string, makeWs?: WsFactory): PumpPortalHub {
  if (!hub) hub = new PumpPortalHub(url, makeWs);
  else if (url) hub.setUrl(url);
  return hub;
}
