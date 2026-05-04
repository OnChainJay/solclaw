/**
 * Multi-Token Scanner Dashboard
 * Shows tracked tokens, algo signals, and paper positions.
 */

import { useState, useEffect, useCallback } from "react";
import {
  multiTokenScanner,
  TokenState,
  ScannerEvent,
  ScannerStats,
} from "@/lib/multiTokenScanner";
import { PaperPosition } from "@/lib/scalperAlgoLowestLow";

export function ScannerPanel() {
  const [stats, setStats] = useState<ScannerStats>(multiTokenScanner.getStats());
  const [tokens, setTokens] = useState<TokenState[]>([]);
  const [positions, setPositions] = useState<PaperPosition[]>([]);
  const [closedPositions, setClosedPositions] = useState<PaperPosition[]>([]);
  const [eventLog, setEventLog] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<"tokens" | "positions" | "log">("tokens");

  // Refresh state periodically
  useEffect(() => {
    const interval = setInterval(() => {
      setStats(multiTokenScanner.getStats());
      setTokens(Array.from(multiTokenScanner.tokens.values()));
      setPositions([...multiTokenScanner.positions]);
      setClosedPositions([...multiTokenScanner.closedPositions]);
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  // Listen for scanner events
  useEffect(() => {
    const unsubscribe = multiTokenScanner.addEventListener((event: ScannerEvent) => {
      const timestamp = new Date().toLocaleTimeString();
      let msg = "";

      switch (event.type) {
        case "entry":
          msg = `🟢 BUY ${event.position.mint.slice(0, 8)}... @ $${event.position.entryPrice.toFixed(0)} — ${event.reason}`;
          break;
        case "exit":
          msg = `🔴 SELL ${event.position.mint.slice(0, 8)}... PnL: ${event.pnlPct.toFixed(1)}% — ${event.reason}`;
          break;
        case "token_added":
          msg = `➕ Tracking ${event.name} (${event.mint.slice(0, 8)}...)`;
          break;
        case "token_removed":
          msg = `➖ Removed ${event.mint.slice(0, 8)}...`;
          break;
        case "status":
          msg = `ℹ️ ${event.message}`;
          break;
      }

      setEventLog((prev) => [`[${timestamp}] ${msg}`, ...prev].slice(0, 100));
    });

    return unsubscribe;
  }, []);

  const handleToggle = useCallback(() => {
    if (multiTokenScanner.isRunning) {
      multiTokenScanner.stop();
    } else {
      multiTokenScanner.start();
    }
    setStats(multiTokenScanner.getStats());
  }, []);

  return (
    <div className="flex flex-col h-full text-xs font-mono">
      {/* Header + Controls */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/10">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold">🎯 Multi-Token Scanner</span>
          <span
            className={`w-2 h-2 rounded-full ${stats.isRunning ? "bg-green-400 animate-pulse" : "bg-red-400"}`}
          />
        </div>
        <button
          onClick={handleToggle}
          className={`px-3 py-1 rounded text-xs font-bold ${
            stats.isRunning
              ? "bg-red-500/20 text-red-300 hover:bg-red-500/30"
              : "bg-green-500/20 text-green-300 hover:bg-green-500/30"
          }`}
        >
          {stats.isRunning ? "⏹ Stop" : "▶ Start"}
        </button>
      </div>

      {/* Stats Bar */}
      <div className="grid grid-cols-4 gap-1 px-3 py-2 bg-white/5 border-b border-white/10">
        <StatBox label="Tracking" value={String(stats.tokensTracking)} />
        <StatBox label="Open" value={String(stats.openPositions)} color="text-yellow-300" />
        <StatBox label="Closed" value={String(stats.closedPositions)} />
        <StatBox
          label="Win %"
          value={stats.closedPositions > 0 ? `${stats.totalPnlPct.toFixed(0)}%` : "—"}
          color={stats.totalPnlPct >= 50 ? "text-green-300" : "text-red-300"}
        />
      </div>

      {/* Tab Switcher */}
      <div className="flex border-b border-white/10">
        {(["tokens", "positions", "log"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex-1 py-1.5 text-center text-xs uppercase tracking-wide ${
              activeTab === tab
                ? "bg-white/10 text-white border-b-2 border-cyan-400"
                : "text-white/50 hover:text-white/80"
            }`}
          >
            {tab === "tokens" && `📡 Tokens (${stats.tokensTracking})`}
            {tab === "positions" && `💰 Positions (${stats.openPositions})`}
            {tab === "log" && `📋 Log`}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === "tokens" && <TokensList tokens={tokens} />}
        {activeTab === "positions" && (
          <PositionsList open={positions} closed={closedPositions} />
        )}
        {activeTab === "log" && <EventLog entries={eventLog} />}
      </div>
    </div>
  );
}

// ─── Sub-components ─────────────────────────────────────────

function StatBox({
  label,
  value,
  color = "text-white",
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div className="text-center">
      <div className="text-white/40 text-[10px]">{label}</div>
      <div className={`font-bold ${color}`}>{value}</div>
    </div>
  );
}

function TokensList({ tokens }: { tokens: TokenState[] }) {
  if (tokens.length === 0) {
    return (
      <div className="p-4 text-center text-white/40">
        No tokens tracked yet. Start the scanner to pull from Nursery.
      </div>
    );
  }

  return (
    <div className="divide-y divide-white/5">
      {tokens.map((t) => (
        <div key={t.mint} className="px-3 py-2 hover:bg-white/5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <SourceBadge source={t.source} />
              <span className="text-white/90 font-medium">
                {t.name || t.mint.slice(0, 8)}
              </span>
            </div>
            <span className="text-white/60">
              {t.lastMcUsd > 0 ? `$${formatMc(t.lastMcUsd)}` : "—"}
            </span>
          </div>
          <div className="flex items-center justify-between mt-1 text-[10px] text-white/40">
            <span>
              Trades: {t.tradeCount} │ Vol: {(t.buyVolumeSol + t.sellVolumeSol).toFixed(2)} SOL
            </span>
            <span className={getReasonColor(t.algoReason)}>
              {t.algoReason.slice(0, 40)}
            </span>
          </div>
          {/* Lowest low indicator */}
          {t.lowestLow < Infinity && t.lastMcUsd > 0 && (
            <div className="mt-1 h-1 bg-white/10 rounded overflow-hidden">
              <div
                className="h-full bg-cyan-400/60 rounded"
                style={{
                  width: `${Math.min(100, (t.lowestLow / t.lastMcUsd) * 100)}%`,
                }}
              />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function PositionsList({
  open,
  closed,
}: {
  open: PaperPosition[];
  closed: PaperPosition[];
}) {
  return (
    <div>
      {open.length > 0 && (
        <div className="px-3 py-2">
          <div className="text-white/50 text-[10px] uppercase mb-1">Open Positions</div>
          {open
            .filter((p) => p.status === "open")
            .map((p, i) => (
              <div key={i} className="flex justify-between py-1 border-b border-white/5">
                <span className="text-green-300">{p.mint.slice(0, 8)}...</span>
                <span className="text-white/60">
                  Entry: ${p.entryPrice.toFixed(0)} │ Stop: ${p.stopLossPrice.toFixed(0)}
                </span>
              </div>
            ))}
        </div>
      )}
      {closed.length > 0 && (
        <div className="px-3 py-2">
          <div className="text-white/50 text-[10px] uppercase mb-1">
            Closed ({closed.length})
          </div>
          {closed.slice(0, 20).map((p, i) => {
            const pnl = ((p.stopLossPrice - p.entryPrice) / p.entryPrice) * 100;
            return (
              <div key={i} className="flex justify-between py-1 border-b border-white/5">
                <span className="text-white/60">{p.mint.slice(0, 8)}...</span>
                <span className={pnl >= 0 ? "text-green-300" : "text-red-300"}>
                  {pnl >= 0 ? "+" : ""}
                  {pnl.toFixed(1)}%
                </span>
              </div>
            );
          })}
        </div>
      )}
      {open.length === 0 && closed.length === 0 && (
        <div className="p-4 text-center text-white/40">No positions yet.</div>
      )}
    </div>
  );
}

function EventLog({ entries }: { entries: string[] }) {
  if (entries.length === 0) {
    return <div className="p-4 text-center text-white/40">No events yet.</div>;
  }

  return (
    <div className="px-2 py-1">
      {entries.map((entry, i) => (
        <div key={i} className="py-0.5 text-[10px] text-white/60 leading-relaxed">
          {entry}
        </div>
      ))}
    </div>
  );
}

function SourceBadge({ source }: { source: string }) {
  const styles: Record<string, string> = {
    zombie: "bg-purple-500/20 text-purple-300",
    bonding: "bg-yellow-500/20 text-yellow-300",
    prebond: "bg-orange-500/20 text-orange-300",
  };

  const icons: Record<string, string> = {
    zombie: "💀",
    bonding: "🎯",
    prebond: "🔥",
  };

  return (
    <span className={`px-1.5 py-0.5 rounded text-[9px] ${styles[source] || ""}`}>
      {icons[source] || ""} {source}
    </span>
  );
}

function getReasonColor(reason: string): string {
  if (reason.includes("lowest low") || reason.includes("BUY")) return "text-green-400";
  if (reason.includes("Waiting") || reason.includes("young")) return "text-white/30";
  if (reason.includes("above")) return "text-yellow-400/60";
  return "text-white/40";
}

function formatMc(usd: number): string {
  if (usd >= 1_000_000) return `${(usd / 1_000_000).toFixed(2)}M`;
  if (usd >= 1_000) return `${(usd / 1_000).toFixed(1)}K`;
  return usd.toFixed(0);
}
