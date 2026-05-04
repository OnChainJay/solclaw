import { useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Tooltip } from "@/components/Tooltip";
import * as nursery from "@/lib/nurseryEngine";
import type { BondedToken, NurserySnapshot, PreBondToken } from "@/lib/nurseryEngine";
import { useNurseryBridge } from "@/lib/nurseryBridge";

// ── Formatters ────────────────────────────────────────────────────────────────

function fmtSol(sol: number): string {
  if (sol <= 0) return "–";
  if (sol >= 1000) return `${(sol / 1000).toFixed(1)}k◎`;
  if (sol >= 1) return `${sol.toFixed(1)}◎`;
  return `${sol.toFixed(3)}◎`;
}
function fmtUsd(usd: number): string {
  if (usd <= 0) return "–";
  if (usd >= 1_000_000) return `$${(usd / 1_000_000).toFixed(2)}M`;
  if (usd >= 1_000) return `$${(usd / 1_000).toFixed(1)}k`;
  return `$${usd.toFixed(0)}`;
}
function fmtAge(ms: number): string {
  const s = (Date.now() - ms) / 1000;
  if (s < 60) return `${Math.round(s)}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${(s / 3600).toFixed(1)}h`;
  return `${(s / 86400).toFixed(1)}d`;
}
function fmtRefresh(ms: number): string {
  if (ms === 0) return "–";
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  return `${Math.round(s / 60)}m ago`;
}
function scoreBar(score: number): string {
  const filled = Math.min(5, Math.round(Math.min(score, 10) / 2));
  return "●".repeat(filled) + "○".repeat(5 - filled);
}

// ── Pre-bond row ──────────────────────────────────────────────────────────────

function PrebondRow({ token, showProgress, onOpen }: {
  token: PreBondToken; showProgress: boolean; onOpen: (mint: string) => void;
}) {
  const GRAD_SOL = 79;
  const pct = Math.min(100, Math.max(0, Math.round((token.marketCapSol / GRAD_SOL) * 100)));
  const total = token.buys5m + token.sells5m;
  const bp = total > 0 ? Math.round((token.buys5m / total) * 100) : null;
  const bpColor = bp !== null && bp >= 65 ? "text-emerald-400" : bp !== null && bp < 40 ? "text-red-400/70" : "text-[var(--color-fg-dim)]";

  return (
    <button
      type="button"
      onClick={() => onOpen(token.mint)}
      className="group w-full border-b border-[var(--color-border-subtle)] px-3 py-2.5 text-left text-[11.5px] hover:bg-white/[0.04] transition-colors"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 flex-1 flex items-center gap-1.5 truncate">
          <span className="font-semibold text-[var(--color-fg)] shrink-0">{token.symbol}</span>
          <span className="truncate text-[10.5px] text-[var(--color-fg-dim)]">{token.name}</span>
        </div>
        <div className="shrink-0 flex items-center gap-2 text-[10px]">
          {bp !== null && (
            <Tooltip text={`${bp}% of trades in the last 5 min were buys`} side="left">
              <span className={bpColor}>{bp}%▲</span>
            </Tooltip>
          )}
          {token.maxSingleBuySol >= 0.3 && (
            <Tooltip text={`Largest single buy seen: ${fmtSol(token.maxSingleBuySol)} — potential whale`} side="left">
              <span className="text-amber-400/80">🐋{fmtSol(token.maxSingleBuySol)}</span>
            </Tooltip>
          )}
          <Tooltip text="Time since this token was first spotted" side="left">
            <span className="text-[var(--color-fg-dim)]">{fmtAge(token.firstSeenMs)}</span>
          </Tooltip>
        </div>
      </div>

      {showProgress && (
        <div className="mt-1.5 flex items-center gap-2">
          <Tooltip
            text={`Bonding curve progress — ${pct}% to graduation ($69k MC). At 100% the token migrates to Raydium.`}
            side="bottom"
            className="flex-1"
          >
            <div className="w-full h-[3px] rounded-full bg-white/10 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${pct >= 95 ? "bg-emerald-400" : "bg-[color-mix(in_srgb,#2EA8FF_65%,transparent)]"}`}
                style={{ width: `${pct}%` }}
              />
            </div>
          </Tooltip>
          <span className={`shrink-0 text-[10px] font-mono ${pct >= 95 ? "text-emerald-400" : "text-[var(--color-fg-dim)]"}`}>
            {pct}%
          </span>
          <Tooltip text="Current bonding-curve market cap in SOL" side="left">
            <span className="shrink-0 text-[10px] text-[var(--color-fg-dim)]">{fmtSol(token.marketCapSol)}</span>
          </Tooltip>
        </div>
      )}

      {!showProgress && (
        <div className="mt-0.5 flex items-center gap-2 text-[10px] text-[var(--color-fg-dim)]">
          <Tooltip text="Market cap on the bonding curve" side="right">
            <span>{fmtSol(token.marketCapSol)}</span>
          </Tooltip>
          {token.vol5mSol > 0 && (
            <Tooltip text="Total SOL volume traded in the last 5 minutes" side="right">
              <span>{fmtSol(token.vol5mSol)} vol</span>
            </Tooltip>
          )}
        </div>
      )}
    </button>
  );
}

// ── Bonded row ────────────────────────────────────────────────────────────────

function BondedRow({ token, showScore, onOpen }: {
  token: BondedToken; showScore: boolean; onOpen: (mint: string) => void;
}) {
  const hasData = token.lastUpdatedMs > 0;
  const score = token.revivalScore;

  return (
    <button
      type="button"
      onClick={() => onOpen(token.mint)}
      className="group w-full border-b border-[var(--color-border-subtle)] px-3 py-2.5 text-left text-[11.5px] hover:bg-white/[0.04] transition-colors"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 flex-1 flex items-center gap-1.5 truncate">
          <span className="font-semibold text-[var(--color-fg)] shrink-0">{token.symbol}</span>
          <span className="truncate text-[10.5px] text-[var(--color-fg-dim)]">{token.name}</span>
        </div>
        <div className="shrink-0 flex items-center gap-2 text-[10px]">
          {showScore && score > 0 && (
            <Tooltip
              text={`Revival score ${score.toFixed(1)} — combines volume acceleration, buy pressure, price recovery room, and how long ago it bonded`}
              side="left"
            >
              <span className={`font-mono ${score >= 6 ? "text-emerald-400" : score >= 3 ? "text-amber-400" : "text-[var(--color-fg-dim)]/40"}`}>
                {scoreBar(score)}
              </span>
            </Tooltip>
          )}
          <Tooltip text="Time since this token graduated to Raydium" side="left">
            <span className="text-[var(--color-fg-dim)]">{fmtAge(token.bondedMs)}</span>
          </Tooltip>
        </div>
      </div>

      <div className="mt-0.5 flex items-center gap-3 text-[10px] text-[var(--color-fg-dim)]">
        {hasData ? (
          <>
            <Tooltip text="Current market cap on Raydium (from DexScreener)" side="right">
              <span>{fmtUsd(token.marketCapUsd)}</span>
            </Tooltip>
            <Tooltip text="Total USD volume traded in the last hour" side="right">
              <span>V {fmtUsd(token.vol1h)}</span>
            </Tooltip>
            {token.buys1h + token.sells1h > 0 && (
              <Tooltip text={`${token.buys1h} buys vs ${token.sells1h} sells in the last hour`} side="right">
                <span>{Math.round((token.buys1h / (token.buys1h + token.sells1h)) * 100)}%▲</span>
              </Tooltip>
            )}
            <Tooltip text="Price change in the last hour" side="right">
              <span className={token.priceChange1h >= 0 ? "text-emerald-400/80" : "text-red-400/70"}>
                {token.priceChange1h >= 0 ? "+" : ""}{token.priceChange1h.toFixed(1)}%
              </span>
            </Tooltip>
          </>
        ) : (
          <Tooltip text="DexScreener data updates every ~2 minutes. First load may take up to 30 s." side="right">
            <span className="italic text-[var(--color-fg-dim)]/30">loading…</span>
          </Tooltip>
        )}
      </div>
    </button>
  );
}

// ── Empty states ──────────────────────────────────────────────────────────────

function EmptyListening({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-14 text-center px-6">
      <p className="text-[11.5px] text-[var(--color-fg-dim)]">{label}</p>
      <p className="text-[10px] text-[var(--color-fg-dim)]/40">Fills in as the session runs.</p>
    </div>
  );
}

function EmptyOlder() {
  return (
    <div className="flex flex-col gap-4 px-5 py-10">
      <p className="text-[12px] font-semibold text-[var(--color-fg)]">
        Keep the Nursery open — coins appear automatically.
      </p>
      <div className="space-y-2 text-[11px] text-[var(--color-fg-dim)] leading-relaxed">
        <p>
          <span className="text-[var(--color-fg)]">What this tab shows:</span> tokens that graduated
          to Raydium more than 2 days ago but still have a market cap above $9k. These are your
          zombie revival candidates — coins that dumped after launch and may be waking back up.
        </p>
        <p>
          <span className="text-[var(--color-fg)]">Why it's empty right now:</span> we scan
          DexScreener every 2 minutes to check current market caps. The first pass takes ~30 s to
          complete. Once it runs, tokens above $9k will appear here ranked by revival score.
        </p>
        <p>
          <span className="text-[var(--color-fg)]">Limitations:</span> we track up to 600 graduated
          tokens across 30 days. Tokens with zero liquidity or MC below $9k are hidden — they're
          essentially dead. Keeping the tab open lets us catch new revivals in real time.
        </p>
      </div>
      <div className="rounded-lg border border-[var(--color-border-subtle)] bg-white/[0.03] px-4 py-3 text-[10.5px] text-[var(--color-fg-dim)]">
        💡 Revival score = <span className="text-[var(--color-fg)]">vol acceleration</span> ×{" "}
        <span className="text-[var(--color-fg)]">buy pressure</span> ×{" "}
        <span className="text-[var(--color-fg)]">price recovery room</span> ×{" "}
        <span className="text-[var(--color-fg)]">age factor</span>. High score = fresh volume on a beaten-down coin.
      </div>
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

type Tab = "new" | "grad" | "bonded" | "old";

const TABS: { id: Tab; label: string; tip: string }[] = [
  { id: "new",    label: "New Launches",       tip: "All pre-bond tokens from pump.fun, newest first. These haven't graduated yet." },
  { id: "grad",   label: "Not So New",         tip: "Pre-bond tokens sorted by how close they are to graduating ($69k MC). Top = about to migrate to Raydium." },
  { id: "bonded", label: "A Little Old",       tip: "Tokens that graduated to Raydium in the last 2 days, newest first." },
  { id: "old",    label: "Older",              tip: "Graduated tokens 2–30 days old with MC above $9k. Sorted by revival score — best zombie candidates at the top." },
];

export function NurseryPanel({ onOpenToken }: { onOpenToken?: (mint: string) => void }) {
  const [tab, setTab] = useState<Tab>("new");
  const [snap, setSnap] = useState<NurserySnapshot>(() => nursery.getSnapshot());

  useEffect(() => {
    nursery.start();
    const id = setInterval(() => setSnap(nursery.getSnapshot()), 4_000);
    return () => clearInterval(id);
  }, []);

  // ── Bridge: expose token lists to the multi-token scanner ──────────────────
  const zombieForBridge = useMemo(
    () => snap.oldPairsList.map((t) => ({ mint: t.mint, name: t.name || t.symbol })),
    [snap.oldPairsList]
  );
  const bondingForBridge = useMemo(
    () => snap.graduatingList.map((t) => ({ mint: t.mint, name: t.name || t.symbol })),
    [snap.graduatingList]
  );
  const prebondForBridge = useMemo(
    () => snap.newPairsList.map((t) => ({ mint: t.mint, name: t.name || t.symbol })),
    [snap.newPairsList]
  );
  useNurseryBridge(zombieForBridge, bondingForBridge, prebondForBridge);
  // ──────────────────────────────────────────────────────────────────────────────

  const { stats } = snap;
  function openToken(mint: string) { onOpenToken?.(mint); }

  const counts: Record<Tab, number> = {
    new:    snap.newPairsList.length,
    grad:   snap.graduatingList.length,
    bonded: snap.bondedList.length,
    old:    snap.oldPairsList.length,
  };

  return (
    <div className="flex h-full min-h-0 flex-col" style={{ background: "var(--color-bg-editor)" }}>

      {/* Header */}
      <div className="shrink-0 border-b border-[var(--color-border-subtle)] px-4 py-3">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="unt-section-title">Nursery</h2>
          <Tooltip text={`DexScreener last refreshed ${fmtRefresh(stats.bondedLastRefreshMs)}. Updates every 2 min.`} side="left">
            <span className="flex items-center gap-1 text-[10px] text-[var(--color-fg-dim)] cursor-default">
              <RefreshCw className="size-2.5" strokeWidth={2} />
              {fmtRefresh(stats.bondedLastRefreshMs)}
            </span>
          </Tooltip>
        </div>
        <div className="mt-0.5 flex items-center gap-3 text-[10px] text-[var(--color-fg-dim)]">
          <Tooltip text="Pre-bond tokens currently tracked via PumpPortal WebSocket" side="right">
            <span className="cursor-default">{stats.trackedPrebond} bonding</span>
          </Tooltip>
          <Tooltip text="Graduated tokens tracked across all time windows" side="right">
            <span className="cursor-default">{stats.trackedBonded} graduated</span>
          </Tooltip>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex shrink-0 overflow-x-auto border-b border-[var(--color-border-subtle)]" style={{ scrollbarWidth: "none" }}>
        {TABS.map(t => (
          <Tooltip key={t.id} text={t.tip} side="bottom" delay={600}>
            <button
              type="button"
              onClick={() => setTab(t.id)}
              className={
                "shrink-0 border-b-2 px-3 py-2 text-[11px] font-semibold transition-colors whitespace-nowrap " +
                (tab === t.id
                  ? "border-[color-mix(in_srgb,#2EA8FF_60%,transparent)] text-[#e8f4ff]"
                  : "border-transparent text-[var(--color-fg-dim)] hover:text-[var(--color-fg)]")
              }
            >
              {t.label}
              {counts[t.id] > 0 && (
                <span className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[9px] tabular-nums ${tab === t.id ? "bg-[color-mix(in_srgb,#2EA8FF_20%,transparent)] text-[#2EA8FF]" : "bg-white/8 text-[var(--color-fg-dim)]/60"}`}>
                  {counts[t.id]}
                </span>
              )}
            </button>
          </Tooltip>
        ))}
      </div>

      {/* List */}
      <div className="min-h-0 flex-1 overflow-y-auto" style={{ scrollbarWidth: "thin" }}>
        {tab === "new" && (
          snap.newPairsList.length === 0
            ? <EmptyListening label="Listening for new launches via PumpPortal stream…" />
            : snap.newPairsList.map(t => <PrebondRow key={t.mint} token={t} showProgress={false} onOpen={openToken} />)
        )}
        {tab === "grad" && (
          snap.graduatingList.length === 0
            ? <EmptyListening label="Watching for tokens filling the bonding curve…" />
            : snap.graduatingList.map(t => <PrebondRow key={t.mint} token={t} showProgress={true} onOpen={openToken} />)
        )}
        {tab === "bonded" && (
          snap.bondedList.length === 0
            ? <EmptyListening label="Loading recently graduated coins — appears within 15 s." />
            : snap.bondedList.map(t => <BondedRow key={t.mint} token={t} showScore={false} onOpen={openToken} />)
        )}
        {tab === "old" && (
          snap.oldPairsList.length === 0
            ? <EmptyOlder />
            : snap.oldPairsList.map(t => <BondedRow key={t.mint} token={t} showScore={true} onOpen={openToken} />)
        )}
      </div>
    </div>
  );
}
