/**
 * Multi-Token Scanner Engine
 *
 * Subscribes to PumpPortal trade streams for multiple tokens (sourced from Nursery),
 * runs the Lowest-Low Dip-Buy algo against each one, and manages paper positions.
 *
 * Architecture:
 *   Nursery tokens → PumpPortal WS subscriptions → Price tick buffers → Algo evaluation → Paper positions
 */

import {
  LowestLowConfig,
  DEFAULT_LOWEST_LOW_CONFIG,
  PriceTick,
  PaperPosition,
  evaluateLowestLow,
  evaluateExits,
} from "./scalperAlgoLowestLow";

// ─── Types ────────────────────────────────────────────────────

export interface TokenState {
  mint: string;
  name: string;
  /** When we started tracking this token (ms) */
  discoveredAt: number;
  /** Rolling price tick buffer */
  ticks: PriceTick[];
  /** Total trade count observed */
  tradeCount: number;
  /** Total buy volume (SOL) */
  buyVolumeSol: number;
  /** Total sell volume (SOL) */
  sellVolumeSol: number;
  /** Latest MC USD */
  lastMcUsd: number;
  /** Latest price in SOL */
  lastPriceSol: number;
  /** Lowest MC seen in lookback window */
  lowestLow: number;
  /** Current algo evaluation reason */
  algoReason: string;
  /** Source tab: zombie | bonding | prebond */
  source: "zombie" | "bonding" | "prebond";
}

export interface ScannerStats {
  tokensTracking: number;
  totalTrades: number;
  openPositions: number;
  closedPositions: number;
  totalPnlUsd: number;
  totalPnlPct: number;
  winnersCount: number;
  losersCount: number;
  isRunning: boolean;
}

export type ScannerEvent =
  | { type: "entry"; position: PaperPosition; reason: string }
  | { type: "exit"; position: PaperPosition; reason: string; pnlPct: number }
  | { type: "token_added"; mint: string; name: string }
  | { type: "token_removed"; mint: string }
  | { type: "status"; message: string };

type EventListener = (event: ScannerEvent) => void;

// ─── Constants ────────────────────────────────────────────────

/** Max ticks to buffer per token (prevent memory bloat) */
const MAX_TICKS_PER_TOKEN = 2000;

/** How often to re-sync with Nursery (ms) */
const NURSERY_SYNC_INTERVAL_MS = 30_000;

/** Max tokens to track simultaneously */
const MAX_TRACKED_TOKENS = 50;

/** PumpPortal WebSocket URL */
const PUMP_PORTAL_WS_URL = "wss://pumpportal.fun/api/data";

// ─── Scanner Engine (singleton) ──────────────────────────────

class MultiTokenScanner {
  private _running = false;
  private _config: LowestLowConfig = { ...DEFAULT_LOWEST_LOW_CONFIG };
  private _tokens: Map<string, TokenState> = new Map();
  private _positions: PaperPosition[] = [];
  private _closedPositions: PaperPosition[] = [];
  private _ws: WebSocket | null = null;
  private _listeners: EventListener[] = [];
  private _nurserySyncTimer: ReturnType<typeof setInterval> | null = null;
  private _subscribedMints: Set<string> = new Set();
  private _totalTradesProcessed = 0;

  // ─── Public API ───────────────────────────────────────────

  get isRunning(): boolean {
    return this._running;
  }

  get config(): LowestLowConfig {
    return this._config;
  }

  get tokens(): Map<string, TokenState> {
    return this._tokens;
  }

  get positions(): PaperPosition[] {
    return this._positions;
  }

  get closedPositions(): PaperPosition[] {
    return this._closedPositions;
  }

  getStats(): ScannerStats {
    const winners = this._closedPositions.filter(
      (p) => p.highWaterMark > p.entryPrice
    );
    const losers = this._closedPositions.filter(
      (p) => p.highWaterMark <= p.entryPrice
    );

    const totalPnlUsd = this._closedPositions.reduce((sum, p) => {
      const exitPrice = p.stopLossPrice; // approximate
      return sum + (exitPrice - p.entryPrice);
    }, 0);

    return {
      tokensTracking: this._tokens.size,
      totalTrades: this._totalTradesProcessed,
      openPositions: this._positions.filter((p) => p.status === "open").length,
      closedPositions: this._closedPositions.length,
      totalPnlUsd,
      totalPnlPct:
        this._closedPositions.length > 0
          ? (winners.length / this._closedPositions.length) * 100
          : 0,
      winnersCount: winners.length,
      losersCount: losers.length,
      isRunning: this._running,
    };
  }

  updateConfig(partial: Partial<LowestLowConfig>): void {
    this._config = { ...this._config, ...partial };
    this._emit({ type: "status", message: "Config updated" });
  }

  addEventListener(listener: EventListener): () => void {
    this._listeners.push(listener);
    return () => {
      this._listeners = this._listeners.filter((l) => l !== listener);
    };
  }

  // ─── Lifecycle ────────────────────────────────────────────

  start(): void {
    if (this._running) return;
    this._running = true;

    this._emit({ type: "status", message: "Scanner starting..." });

    // Connect to PumpPortal WebSocket
    this._connectWebSocket();

    // Sync with Nursery immediately, then periodically
    this._syncFromNursery();
    this._nurserySyncTimer = setInterval(() => {
      this._syncFromNursery();
    }, NURSERY_SYNC_INTERVAL_MS);

    this._emit({ type: "status", message: "Scanner running" });
  }

  stop(): void {
    this._running = false;

    if (this._nurserySyncTimer) {
      clearInterval(this._nurserySyncTimer);
      this._nurserySyncTimer = null;
    }

    if (this._ws) {
      this._ws.close();
      this._ws = null;
    }

    this._subscribedMints.clear();
    this._emit({ type: "status", message: "Scanner stopped" });
  }

  /** Manually add a token to track */
  addToken(mint: string, name: string, source: "zombie" | "bonding" | "prebond"): void {
    if (this._tokens.has(mint)) return;
    if (this._tokens.size >= MAX_TRACKED_TOKENS) {
      this._emit({
        type: "status",
        message: `Max tokens (${MAX_TRACKED_TOKENS}) reached, cannot add ${mint.slice(0, 8)}`,
      });
      return;
    }

    const state: TokenState = {
      mint,
      name,
      discoveredAt: Date.now(),
      ticks: [],
      tradeCount: 0,
      buyVolumeSol: 0,
      sellVolumeSol: 0,
      lastMcUsd: 0,
      lastPriceSol: 0,
      lowestLow: Infinity,
      algoReason: "Waiting for data...",
      source,
    };

    this._tokens.set(mint, state);
    this._subscribeToToken(mint);
    this._emit({ type: "token_added", mint, name });
  }

  /** Remove a token from tracking */
  removeToken(mint: string): void {
    this._tokens.delete(mint);
    this._unsubscribeFromToken(mint);
    this._emit({ type: "token_removed", mint });
  }

  // ─── WebSocket ────────────────────────────────────────────

  private _connectWebSocket(): void {
    if (this._ws?.readyState === WebSocket.OPEN) return;

    try {
      this._ws = new WebSocket(PUMP_PORTAL_WS_URL);

      this._ws.onopen = () => {
        this._emit({ type: "status", message: "PumpPortal WS connected" });
        // Re-subscribe to all tracked tokens
        for (const mint of this._tokens.keys()) {
          this._subscribeToToken(mint);
        }
      };

      this._ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          this._handleTradeMessage(data);
        } catch {
          // ignore parse errors
        }
      };

      this._ws.onclose = () => {
        this._subscribedMints.clear();
        if (this._running) {
          this._emit({ type: "status", message: "WS disconnected, reconnecting in 3s..." });
          setTimeout(() => this._connectWebSocket(), 3000);
        }
      };

      this._ws.onerror = () => {
        this._ws?.close();
      };
    } catch (e) {
      this._emit({ type: "status", message: `WS connect error: ${e}` });
      if (this._running) {
        setTimeout(() => this._connectWebSocket(), 5000);
      }
    }
  }

  private _subscribeToToken(mint: string): void {
    if (!this._ws || this._ws.readyState !== WebSocket.OPEN) return;
    if (this._subscribedMints.has(mint)) return;

    this._ws.send(
      JSON.stringify({
        method: "subscribeTokenTrade",
        keys: [mint],
      })
    );
    this._subscribedMints.add(mint);
  }

  private _unsubscribeFromToken(mint: string): void {
    if (!this._ws || this._ws.readyState !== WebSocket.OPEN) return;

    this._ws.send(
      JSON.stringify({
        method: "unsubscribeTokenTrade",
        keys: [mint],
      })
    );
    this._subscribedMints.delete(mint);
  }

  // ─── Trade Processing ─────────────────────────────────────

  private _handleTradeMessage(data: any): void {
    // PumpPortal trade message format:
    // { mint, txType: "buy"|"sell", solAmount, tokenAmount, marketCapSol, ... }
    const mint: string = data.mint;
    if (!mint || !this._tokens.has(mint)) return;

    const state = this._tokens.get(mint)!;
    const now = Date.now();
    const isBuy = data.txType === "buy";
    const solAmount = Number(data.solAmount) || 0;
    const mcUsd = Number(data.marketCapSol) * this._getSolPriceUsd(); // approximate
    const priceSol = Number(data.marketCapSol) || 0;

    // Update state
    state.tradeCount++;
    state.lastMcUsd = mcUsd;
    state.lastPriceSol = priceSol;
    this._totalTradesProcessed++;

    if (isBuy) {
      state.buyVolumeSol += solAmount;
    } else {
      state.sellVolumeSol += solAmount;
    }

    // Buffer tick
    const tick: PriceTick = {
      timestamp: now,
      priceSol,
      mcUsd,
    };
    state.ticks.push(tick);

    // Prune old ticks
    if (state.ticks.length > MAX_TICKS_PER_TOKEN) {
      state.ticks = state.ticks.slice(-MAX_TICKS_PER_TOKEN);
    }

    // Update lowest low (within lookback window)
    const cutoff = now - this._config.lookbackWindowMs;
    const windowTicks = state.ticks.filter((t) => t.timestamp >= cutoff);
    if (windowTicks.length > 0) {
      state.lowestLow = Math.min(...windowTicks.map((t) => t.mcUsd));
    }

    // ─── Run algo evaluation ────────────────────────────────
    this._evaluateEntry(state);
    this._evaluateExits(state);
  }

  private _evaluateEntry(state: TokenState): void {
    const result = evaluateLowestLow(
      this._config,
      state.ticks,
      this._positions,
      state.mint,
      state.tradeCount,
      state.discoveredAt
    );

    state.algoReason = result.reason;

    if (result.signal === "buy" && result.targetPrice) {
      this._openPaperPosition(state, result.targetPrice, result.reason);
    }
  }

  private _evaluateExits(state: TokenState): void {
    const currentPrices = new Map<string, number>();
    for (const [mint, ts] of this._tokens) {
      if (ts.lastMcUsd > 0) {
        currentPrices.set(mint, ts.lastMcUsd);
      }
    }

    const exits = evaluateExits(this._config, this._positions, currentPrices);

    for (const exit of exits) {
      this._closePaperPosition(exit.mint, exit.reason);
    }
  }

  // ─── Paper Positions ──────────────────────────────────────

  private _openPaperPosition(state: TokenState, mcUsd: number, reason: string): void {
    const stopLossPrice = mcUsd * (1 - this._config.stopLossPct);

    const position: PaperPosition = {
      mint: state.mint,
      entryPrice: mcUsd,
      entryPriceSol: state.lastPriceSol,
      entryTime: Date.now(),
      bidSizeSol: this._config.bidSizeSol,
      stopLossPrice,
      highWaterMark: mcUsd,
      status: "open",
    };

    this._positions.push(position);
    this._emit({ type: "entry", position, reason });
  }

  private _closePaperPosition(mint: string, reason: string): void {
    const idx = this._positions.findIndex(
      (p) => p.mint === mint && p.status === "open"
    );
    if (idx === -1) return;

    const position = this._positions[idx];
    position.status = "stopped";

    // Calculate PnL
    const tokenState = this._tokens.get(mint);
    const exitPrice = tokenState?.lastMcUsd ?? position.stopLossPrice;
    const pnlPct = ((exitPrice - position.entryPrice) / position.entryPrice) * 100;

    // Move to closed
    this._positions.splice(idx, 1);
    this._closedPositions.push(position);

    this._emit({ type: "exit", position, reason, pnlPct });
  }

  // ─── Nursery Integration ──────────────────────────────────

  private _syncFromNursery(): void {
    // Import nursery engine dynamically to avoid circular deps
    // The nursery engine exposes its token lists
    try {
      // Access the nursery engine's exported data
      // nurseryEngine is a module singleton — we read its public state
      const nurseryData = (window as any).__nurseryTokens;
      if (!nurseryData) {
        this._emit({ type: "status", message: "Nursery not loaded yet" });
        return;
      }

      const { zombie = [], bonding = [], prebond = [] } = nurseryData;

      // Add new tokens from nursery (up to limit)
      const allNursery = [
        ...zombie.map((t: any) => ({ ...t, source: "zombie" as const })),
        ...bonding.map((t: any) => ({ ...t, source: "bonding" as const })),
        ...prebond.map((t: any) => ({ ...t, source: "prebond" as const })),
      ];

      let added = 0;
      for (const token of allNursery) {
        if (this._tokens.size >= MAX_TRACKED_TOKENS) break;
        if (!this._tokens.has(token.mint)) {
          this.addToken(token.mint, token.name || token.mint.slice(0, 8), token.source);
          added++;
        }
      }

      if (added > 0) {
        this._emit({
          type: "status",
          message: `Synced ${added} new tokens from Nursery (total: ${this._tokens.size})`,
        });
      }
    } catch {
      // Nursery not available yet — that's fine
    }
  }

  // ─── Helpers ──────────────────────────────────────────────

  private _getSolPriceUsd(): number {
    // Rough SOL/USD — in production, fetch from a price feed
    // For paper trading, a reasonable estimate is fine
    return 145; // Update periodically or fetch from CoinGecko
  }

  private _emit(event: ScannerEvent): void {
    for (const listener of this._listeners) {
      try {
        listener(event);
      } catch {
        // don't let listener errors crash the scanner
      }
    }
  }
}

// ─── Module Singleton ───────────────────────────────────────

export const multiTokenScanner = new MultiTokenScanner();
