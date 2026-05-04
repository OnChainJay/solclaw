import { useEffect, useMemo, useState, type ReactNode } from "react";
// useState is used by BounceZonesEditor and ZoneRow below
import { BotTradesBook } from "@/components/BotTradesBook";
import { InlineToolbarPicker } from "@/components/InlineToolbarPicker";
import { StreamHealthBanner } from "@/components/StreamHealthBanner";
import { Tooltip } from "@/components/Tooltip";
import { useApp, type TradingMode, type UserBounceZone } from "@/context/AppContext";
import { BUILTIN_SCALPER_PRESET_ID } from "@/lib/algorithmPresets";
import {
  appendPumpPortalTradingWalletHint,
  getEffectivePumpPortalApiKey,
  getPumpPortalTradingWalletPubkey,
} from "@/lib/pumpPortalConfig";
import { SCALPER_PAPER_CONFIG } from "@/lib/scalperPaperConfig";
import { formatUsdCompact, formatSol } from "@/lib/formatUsd";
import {
  isBotTradeChain,
  type BotTradeRow,
  type BotTradeRowTape,
  type ScalperPaperSnapshot,
} from "@/lib/scalperPaperEngine";
import { SetupPanel } from "@/components/SetupPanel";
import { WorkspacePanel } from "@/components/WorkspacePanel";
import { PerformancePanel } from "@/components/PerformancePanel";
import { TrainingDataPanel } from "@/components/TrainingDataPanel";
import { ScannerPanel } from "@/components/ScannerPanel";
import { usePumpPortalConfigRevision } from "@/hooks/usePumpPortalConfigRevision";

/** Empty BotTradesBook copy follows engine phase — exit wording only once you're in a trade. */
function botTradesBookEmptyHint(snapshot: ScalperPaperSnapshot | null | undefined, cfg?: { catalystMinSol: number; takeProfitPct: number; minOrderBookSellSolForStop: number }): string {
  const minBuy = cfg?.catalystMinSol ?? SCALPER_PAPER_CONFIG.catalystMinSol;
  const tp = cfg?.takeProfitPct ?? SCALPER_PAPER_CONFIG.takeProfitPct;
  const stopSol = cfg?.minOrderBookSellSolForStop ?? SCALPER_PAPER_CONFIG.minOrderBookSellSolForStop;

  if (!snapshot) {
    return "No closed trades yet. When you finish a trade, it shows up here.";
  }

  if (snapshot.status === "watching") {
    return `No closed trades yet. Watching for a dip — after that the next ${minBuy}+ SOL buy triggers entry.`;
  }

  if (snapshot.status === "nearing") {
    return `No closed trades yet. Price is pulling back toward a bounce zone. Not armed yet — full dip + zone alignment needed before we arm and wait for a catalyst buy.`;
  }

  if (snapshot.status === "dip") {
    return `No closed trades yet. Price is dipped but bounce zones aren't aligned yet (or we're still scanning). When alignment hits we arm; then the next ${minBuy}+ SOL buy fires the entry.`;
  }

  if (snapshot.status === "arming") {
    return `No closed trades yet. Armed — dip + zones locked in. The next ${minBuy}+ SOL buy on tape should trigger entry immediately after that print.`;
  }

  return `No closed trades yet. You're in a trade right now. Finished trades show here after we sell for +${tp}% profit, or after someone sells at least ${stopSol} SOL (that counts as our stop).`;
}

export function DashboardSidebar() {
  const { sidebarMode } = useApp();
  if (sidebarMode === "analytics") return <AnalyticsPanel />;
  if (sidebarMode === "code") return <WorkspacePanel />;
  if (sidebarMode === "performance") return <div className="p-4"><PerformancePanel /></div>;
  if (sidebarMode === "training") return <div className="p-4"><TrainingDataPanel /></div>;
  if (sidebarMode === "scanner") return <ScannerPanel />;
  return <SetupPanel />;
}

function AnalyticsPanel() {
  const {
    selectedAlgoId,
    setSelectedAlgoId,
    userAlgos,
    chartAnalytics,
    tradingMode,
    setTradingMode,
    algoSessionActive,
    setAlgoSessionActive,
    setTradingHalted,
    hardStopTrading,
    scalperLiveBuySol,
    setScalperLiveBuySol,
    scalperUserConfig,
    requestManualSell,
  } = useApp();

  const pumpCfgRev = usePumpPortalConfigRevision();
  const tradingWalletPk = useMemo(() => getPumpPortalTradingWalletPubkey(), [pumpCfgRev]);

  const [tradingNotice, setTradingNotice] = useState<string | null>(null);
  useEffect(() => {
    if (!tradingNotice) return;
    const tick = window.setTimeout(() => setTradingNotice(null), 5200);
    return () => window.clearTimeout(tick);
  }, [tradingNotice]);

  useEffect(() => {
    if (!algoSessionActive) return;
    if (selectedAlgoId !== BUILTIN_SCALPER_PRESET_ID) {
      setAlgoSessionActive(false);
    }
  }, [algoSessionActive, selectedAlgoId, setAlgoSessionActive]);

  const presetGroups = useMemo(() => {
    const builtin = {
      heading: "Built-in",
      items: [{ value: BUILTIN_SCALPER_PRESET_ID, label: "Order-book scalper (built-in)" }],
    };
    if (userAlgos.length === 0) return [builtin];
    return [
      builtin,
      { heading: "Your algos", items: userAlgos.map((a) => ({ value: a.id, label: a.name })) },
    ];
  }, [userAlgos]);

  const selectedUser = userAlgos.find((a) => a.id === selectedAlgoId);
  const canRunBundledScalper = selectedAlgoId === BUILTIN_SCALPER_PRESET_ID;
  const scalperEngineActive =
    algoSessionActive &&
    (tradingMode === "paper" || tradingMode === "real") &&
    selectedAlgoId === BUILTIN_SCALPER_PRESET_ID;

  const presetPickerDisplay = scalperEngineActive
    ? tradingMode === "real"
      ? "Running · real money"
      : "Running · practice"
    : undefined;

  const userAlgoDescription = selectedUser?.description?.trim() ? selectedUser.description : null;

  const sessionStripError =
    tradingMode === "real" && algoSessionActive && chartAnalytics.livePumpPortalLastErr;

  return (
    <div
      className="flex h-full min-w-0 flex-col overflow-hidden"
      style={{ background: "var(--color-bg-sideBar)" }}
    >
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden unt-panel-inner">
        <section className="unt-section-card space-y-4">
          <div>
            <h2 className="unt-section-title">Algo trading</h2>
            <p className="unt-help-text mt-2">
              Pick a bot below and hit Start. Need something custom? Ask chat.
            </p>
          </div>
          <div className="space-y-3 border-t border-[var(--color-border-subtle)] pt-4">
            <label className="unt-field-label" htmlFor="ca-preset-trigger">
              Preset
            </label>
            <InlineToolbarPicker
              id="ca-preset"
              value={selectedAlgoId ?? ""}
              onChange={(v) => setSelectedAlgoId(v === "" ? null : v)}
              groups={presetGroups}
              displayValue={presetPickerDisplay}
              placeholder="Choose an algo…"
              aria-label="Algorithm preset"
            />

            {chartAnalytics.mint ? (
              <div className="mt-3">
                <StreamHealthBanner
                  mint={chartAnalytics.mint}
                  orderBookConn={chartAnalytics.orderBookConn}
                  orderBookError={chartAnalytics.orderBookError}
                  orderBookLastTradeAt={chartAnalytics.orderBookLastTradeAt}
                />
              </div>
            ) : null}

            {selectedAlgoId === BUILTIN_SCALPER_PRESET_ID ? (
              <div className="mt-3">
                <ScalperPaperPanel
                  snapshot={chartAnalytics.paperScalper}
                  mint={chartAnalytics.mint}
                  orderBookConn={chartAnalytics.orderBookConn}
                  paperSessionActive={
                    algoSessionActive && (tradingMode === "paper" || tradingMode === "real")
                  }
                  tradingMode={tradingMode}

                  liveChainTrades={chartAnalytics.realBotTrades}
                />
              </div>
            ) : selectedAlgoId != null ? (
              <div className="mt-3 space-y-2 border-t border-[var(--color-border-subtle)] pt-3">
                <h3 className="unt-section-overline">Algo details</h3>
                {userAlgoDescription ? (
                  <p className="unt-body-text text-[var(--color-fg-muted)]">{userAlgoDescription}</p>
                ) : (
                  <p className="unt-help-text">No description on this preset yet — you can add one when saving from chat.</p>
                )}
              </div>
            ) : (
              <p className="unt-help-text mt-3 border-t border-[var(--color-border-subtle)] pt-3">
                Choose a preset to see what it does.
              </p>
            )}
          </div>

          <div
            className={
              "space-y-2 border-t border-[var(--color-border-subtle)] pt-4 " +
              (sessionStripError
                ? "rounded-lg bg-[color-mix(in_srgb,red_8%,transparent)] p-3 ring-1 ring-red-500/30"
                : tradingMode === "real" && algoSessionActive
                  ? "rounded-lg bg-[color-mix(in_srgb,#f59e0b_7%,transparent)] p-3 ring-1 ring-amber-500/25"
                  : "")
            }
          >
            {canRunBundledScalper ? (
              <div className="space-y-2 pb-1">
                <Tooltip text="How much SOL each buy uses in Real mode (real money). Locked while a session is running." side="right">
                  <label className="unt-field-label cursor-default" htmlFor="scalper-live-entry-sol">
                    Live entry size (SOL)
                  </label>
                </Tooltip>
                <input
                  id="scalper-live-entry-sol"
                  type="number"
                  inputMode="decimal"
                  min={0.001}
                  max={25}
                  step={0.001}
                  value={scalperLiveBuySol}
                  onChange={(e) => setScalperLiveBuySol(Number(e.target.value))}
                  disabled={algoSessionActive}
                  title={algoSessionActive ? "Stop the session to change live entry size" : undefined}
                  className="unt-input h-9 w-full max-w-[11rem] font-mono text-[13px] tabular-nums"
                />
                <p className="unt-help-text break-all font-mono text-[11px] text-[var(--color-fg-muted)]">
                  Trading wallet : {tradingWalletPk ?? "—"}
                </p>
              </div>
            ) : null}
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="unt-section-overline mb-0">Trading session</h3>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Tooltip text="Paper = practice, no real money. Real = real buys and sells using your wallet and PumpPortal." side="top">
              <select
                id="trading-mode-select"
                value={tradingMode}
                onChange={(e) => setTradingMode(e.target.value === "real" ? "real" : "paper")}
                aria-label="Trading mode"
                className={
                  "unt-select-trading shrink-0 " +
                  (tradingMode === "real"
                    ? sessionStripError
                      ? "border-red-500/40 text-red-100/95"
                      : "border-amber-500/35 text-amber-50/95"
                    : "")
                }
                disabled={algoSessionActive}
                title={algoSessionActive ? "Stop the session to change mode" : undefined}
              >
                <option value="paper">Paper trading</option>
                <option value="real">Real trading</option>
              </select>
              </Tooltip>
              {algoSessionActive ? (
                <span
                  className={
                    "min-w-0 text-[13px] font-semibold " +
                    (tradingMode === "real"
                      ? sessionStripError
                        ? "text-red-100/90"
                        : "text-amber-100/90"
                      : "text-teal-200/90")
                  }
                >
                  {tradingMode === "real" ? "Real trading live" : "Paper trading live"}
                </span>
              ) : null}
              <Tooltip
                text={
                  algoSessionActive
                    ? "Stop the current trading session immediately"
                    : !canRunBundledScalper
                      ? "Pick the built-in scalper first"
                      : !chartAnalytics.mint
                        ? "Paste a token CA in the Chart tab first"
                        : tradingMode === "real"
                          ? "Start live trading — uses your PumpPortal wallet"
                          : "Start paper trading — no real money used"
                }
                side="top"
              >
              <button
                type="button"
                className="unt-btn-primary shrink-0 px-4 py-2 text-[13px] font-medium"
                disabled={!algoSessionActive && (!canRunBundledScalper || !chartAnalytics.mint)}
                onClick={() => {
                  if (algoSessionActive) {
                    hardStopTrading();
                    return;
                  }
                  if (!canRunBundledScalper || !chartAnalytics.mint) return;
                  if (tradingMode === "real" && !getEffectivePumpPortalApiKey().trim()) {
                    setTradingNotice(
                      appendPumpPortalTradingWalletHint(
                        "PumpPortal API key missing — add it in Setup.",
                      ),
                    );
                    return;
                  }
                  setTradingHalted(false);
                  setAlgoSessionActive(true);
                }}
              >
                {algoSessionActive ? "Stop" : "Start"}
              </button>
              </Tooltip>
              {/* Sell All — emergency exit when real money is deployed */}
              {algoSessionActive &&
                tradingMode === "real" &&
                chartAnalytics.paperScalper?.status === "in_trade" ? (
                <Tooltip text="Immediately sell 100 % of your position on-chain, then stop the session." side="top">
                  <button
                    type="button"
                    className="shrink-0 rounded-md border border-rose-500/60 bg-rose-600/20 px-3 py-2 text-[12px] font-semibold text-rose-200 transition-all hover:border-rose-400/70 hover:bg-rose-600/35 active:scale-95"
                    onClick={() => requestManualSell()}
                  >
                    Sell All
                  </button>
                </Tooltip>
              ) : null}
            </div>
            {tradingNotice ? (
              <p className="unt-help-text whitespace-pre-wrap font-medium text-amber-400/90">{tradingNotice}</p>
            ) : (
              <p className="unt-help-text">
                {!chartAnalytics.mint
                  ? "Paste a token CA in Chart to enable Start."
                  : tradingMode === "real"
                    ? "Real mode needs a funded PumpPortal wallet in Setup."
                    : "Paper mode — no real money used."}
              </p>
            )}
            {!algoSessionActive && !canRunBundledScalper && selectedAlgoId != null ? (
              <p className="unt-help-text">
                Pick <strong className="font-semibold text-[var(--color-fg-muted)]">Order-book scalper (built-in)</strong> above to run this.
              </p>
            ) : null}
          </div>

          <div className="space-y-2 border-t border-[var(--color-border-subtle)] pt-4">
            <h3 className="unt-section-overline">Live bot trades</h3>
            {!algoSessionActive ? (
              <p className="unt-help-text">
                Pick the built-in scalper, put a coin on Chart, then tap Start — trades show here.
              </p>
            ) : selectedAlgoId !== BUILTIN_SCALPER_PRESET_ID ? (
              <p className="unt-help-text">
                Pick the built-in scalper above, then tap <strong className="font-semibold text-[var(--color-fg-muted)]">Start</strong>.
              </p>
            ) : !chartAnalytics.mint ? (
              <p className="unt-help-text">
                Paste your coin on the Chart tab first — we need to see trades rolling in.
              </p>
            ) : chartAnalytics.orderBookConn !== "open" ? (
              <p className="unt-help-text">
                Live feed isn&apos;t ready ({chartAnalytics.orderBookConn}). Keep your Chart tab open with this coin.
              </p>
            ) : tradingMode === "real" ? (
              <>
                {chartAnalytics.livePumpPortalLastErr ? (
                  <p className="unt-help-text whitespace-pre-wrap font-medium text-red-400/92">
                    {chartAnalytics.livePumpPortalLastErr}
                  </p>
                ) : null}
                {chartAnalytics.livePumpPortalLastSig ? (
                  <p className="unt-help-text break-all font-mono text-[11px] text-emerald-400/85">
                    Last Lightning tx: {chartAnalytics.livePumpPortalLastSig}
                  </p>
                ) : null}
                <p className="unt-help-text">
                  Real mode sends trades through PumpPortal. Buys use {scalperLiveBuySol} SOL (see Live entry size above). Sells use the same exit rules as paper.
                </p>
                <BotTradesBook
                  rows={chartAnalytics.realBotTrades}
                  emptyHint="No on-chain round-trips logged yet. After a sell confirms, we parse buy+sell txs via RPC (Setup wallet secret required)."
                />
              </>
            ) : (
              <BotTradesBook
                rows={chartAnalytics.paperScalper?.botTrades ?? []}
                emptyHint={botTradesBookEmptyHint(chartAnalytics.paperScalper, scalperUserConfig)}
                paperMode
              />
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

/** Titled section card for strategy settings. */
function SettingsCard({ label, tip, accent, locked, liveSession, headerRight, children }: {
  label: string;
  tip: string;
  accent?: "sky";
  locked?: boolean;
  liveSession?: boolean;
  headerRight?: ReactNode;
  children: ReactNode;
}) {
  const accentColor = accent === "sky" ? "#38bdf8" : "#2EA8FF";
  return (
    <div
      className="overflow-hidden rounded-lg border"
      style={{
        background: "var(--color-bg-editor)",
        borderColor: `color-mix(in srgb, ${accentColor} 18%, var(--color-border-subtle))`,
      }}
    >
      {/* Header strip */}
      <div
        className="flex items-center gap-2 border-b px-3 py-2"
        style={{
          borderColor: `color-mix(in srgb, ${accentColor} 15%, var(--color-border-subtle))`,
          background: `color-mix(in srgb, ${accentColor} 6%, transparent)`,
        }}
      >
        <div
          className="h-3 w-0.5 shrink-0 rounded-full"
          style={{ background: `color-mix(in srgb, ${accentColor} 70%, transparent)` }}
        />
        <span className="text-[11px] font-semibold tracking-wide" style={{ color: `color-mix(in srgb, ${accentColor} 85%, var(--color-fg))` }}>
          {label}
        </span>
        <HelpTip text={tip} />
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {locked ? (
            <span className="text-[9px] text-[var(--color-fg-dim)]">stop session to edit</span>
          ) : null}
          {liveSession ? (
            <span className="text-[9px] font-medium" style={{ color: "#22d3ee" }}>● live</span>
          ) : null}
          {headerRight}
        </div>
      </div>
      {/* Body */}
      <div className="px-3 py-2.5">
        {children}
      </div>
    </div>
  );
}

/** Small inline help icon — shows tooltip on hover. */
function HelpTip({ text }: { text: string }) {
  return (
    <Tooltip text={text} side="right">
      <span className="cursor-help select-none rounded-full border border-[var(--color-border-subtle)] px-1.5 py-px text-[9px] font-medium text-[var(--color-fg-dim)] hover:border-[color-mix(in_srgb,#2EA8FF_35%,transparent)] hover:text-[var(--color-fg-muted)]">
        ?
      </span>
    </Tooltip>
  );
}

/** One labeled number input knob. */
function Knob({ label, value, min, max, step, unit, tip, disabled, onChange }: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  tip: string;
  disabled?: boolean;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1">
        <span className="text-[10px] font-medium text-[var(--color-fg-dim)]">{label}</span>
        <HelpTip text={tip} />
      </div>
      <div className="flex items-center gap-1.5">
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          onChange={(e) => { const n = Number(e.target.value); if (Number.isFinite(n)) onChange(n); }}
          className={
            "unt-input h-8 w-full rounded-md border font-mono text-[13px] font-medium tabular-nums " +
            (disabled
              ? "cursor-not-allowed opacity-50"
              : "border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-fg)]")
          }
        />
        {unit ? <span className="shrink-0 text-[10px] font-medium text-[var(--color-fg-dim)]">{unit}</span> : null}
      </div>
    </div>
  );
}

function SuggestLinesButton() {
  const { refreshSuggestedBounceZones, floorCandlesStatus, chartAnalytics, model } = useApp();
  const [noKeyWarning, setNoKeyWarning] = useState(false);

  const candlesLoading = floorCandlesStatus === "loading";
  const visionLoading = chartAnalytics.visionDetectStatus === "loading";
  const loading = candlesLoading || visionLoading;
  const disabled = floorCandlesStatus === "idle" || candlesLoading;
  const noApiKey = !model.apiKey.trim();

  // Auto-hide the "no key" warning after 3 s
  useEffect(() => {
    if (!noKeyWarning) return;
    const t = window.setTimeout(() => setNoKeyWarning(false), 3000);
    return () => window.clearTimeout(t);
  }, [noKeyWarning]);

  const tooltipText = noKeyWarning
    ? "⚠ Connect your LLM API key in Setup first."
    : candlesLoading
      ? "Fetching candles… bounce lines will appear automatically."
      : visionLoading
        ? "Running vision analysis… AI is reading the chart."
        : disabled
          ? "Paste a mint to load bounce lines automatically."
          : noApiKey
            ? "Connect your LLM API key in Setup to enable AI vision analysis."
            : chartAnalytics.visionDetectError
              ? `Last vision attempt failed: ${chartAnalytics.visionDetectError}`
              : chartAnalytics.visionDetectStatus === "done"
                ? "Re-run: algo detection + AI vision analysis of the chart."
                : "Re-run bounce detection + AI vision analysis of the chart.";

  const label = candlesLoading
    ? "Loading candles…"
    : visionLoading
      ? "AI reading chart…"
      : "Refresh bounce lines";

  const isReady = !disabled && !loading && !noApiKey && !chartAnalytics.visionDetectError;

  const handleClick = () => {
    if (disabled || loading) return;
    if (noApiKey) {
      setNoKeyWarning(true);
      return;
    }
    refreshSuggestedBounceZones();
  };

  return (
    <Tooltip text={tooltipText} side="left">
      <button
        type="button"
        onClick={handleClick}
        disabled={disabled || loading}
        style={isReady ? {
          background: "linear-gradient(135deg, #0c4a6e 0%, #0369a1 45%, #0ea5e9 100%)",
          boxShadow: "0 0 10px rgba(14,165,233,0.45), 0 0 22px rgba(3,105,161,0.3)",
          border: "1px solid rgba(125,211,252,0.35)",
          animation: "untBetaPulse 2.4s ease-in-out infinite",
        } : noApiKey && !disabled ? {
          background: "rgba(220,38,38,0.08)",
          border: "1px solid rgba(248,113,113,0.25)",
        } : undefined}
        className={
          "relative flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[10px] font-bold tracking-wide transition-all " +
          (disabled || loading
            ? "cursor-not-allowed border-purple-400/15 bg-purple-500/5 text-purple-100/35"
            : noKeyWarning
              ? "border-rose-400/60 bg-rose-500/15 text-rose-200"
              : noApiKey
                ? "cursor-pointer border-rose-500/25 text-rose-300/70 hover:border-rose-400/40 hover:text-rose-200/90"
                : chartAnalytics.visionDetectError
                  ? "border-red-400/35 bg-red-500/10 text-red-200 hover:bg-red-500/20"
                  : "text-white hover:brightness-110")
        }
      >
        {/* BETA badge */}
        {isReady && (
          <span
            style={{ fontSize: "7.5px", letterSpacing: "0.1em", opacity: 0.9 }}
            className="rounded bg-white/15 px-1 py-px font-black uppercase text-white"
          >
            BETA
          </span>
        )}
        {noKeyWarning
          ? "⚠"
          : loading
            ? <span className="inline-block h-2.5 w-2.5 animate-spin rounded-full border border-purple-300/60 border-t-purple-200" />
            : chartAnalytics.visionDetectError
              ? "⚠"
              : null}
        {label}
      </button>
    </Tooltip>
  );
}

function BounceZonesEditor({ mint }: { mint: string }) {
  const { bounceZones, toggleBounceZone, updateBounceZonePrice, addBounceZone, removeBounceZone } = useApp();
  const [newPrice, setNewPrice] = useState("");

  const zones = bounceZones.filter((z) => z.mint === mint).sort((a, b) => b.price - a.price);

  return (
    <div className="space-y-2">
      {zones.length === 0 && (
        <p className="text-[10px] leading-snug text-[var(--color-fg-dim)]">
          Bounce lines load automatically once 3 000 candles are fetched. Add your own levels below.
        </p>
      )}

      {zones.map((z) => (
        <ZoneRow key={z.id} zone={z}
          onToggle={() => toggleBounceZone(z.id)}
          onPriceChange={(p) => updateBounceZonePrice(z.id, p)}
          onRemove={() => removeBounceZone(z.id)}
        />
      ))}

      {/* Add manual zone */}
      <div className="flex gap-1.5">
        <input
          type="number"
          placeholder="Add price level…"
          value={newPrice}
          onChange={(e) => setNewPrice(e.target.value)}
          className="unt-input h-7 min-w-0 flex-1 font-mono text-[11px] tabular-nums"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              const p = Number(newPrice);
              if (p > 0) { addBounceZone(mint, p); setNewPrice(""); }
            }
          }}
        />
        <button
          type="button"
          className="rounded-md border border-[var(--color-border-subtle)] px-2.5 py-1 text-[11px] text-[var(--color-fg-dim)] hover:border-sky-400/40 hover:text-sky-300"
          onClick={() => {
            const p = Number(newPrice);
            if (p > 0) { addBounceZone(mint, p); setNewPrice(""); }
          }}
        >
          Add
        </button>
      </div>
    </div>
  );
}

function ZoneRow({ zone, onToggle, onPriceChange, onRemove }: {
  zone: UserBounceZone;
  onToggle: () => void;
  onPriceChange: (p: number) => void;
  onRemove: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(zone.price.toFixed(2)));

  const commit = () => {
    const p = Number(draft);
    if (p > 0) onPriceChange(p);
    else setDraft(zone.price.toFixed(2));
    setEditing(false);
  };

  return (
    <div className={
      "flex items-center gap-1.5 rounded-md border px-2 py-1 transition-colors " +
      (zone.enabled
        ? "border-sky-400/25 bg-sky-500/5"
        : "border-[var(--color-border-subtle)] opacity-50")
    }>
      {/* Enable toggle */}
      <button type="button" onClick={onToggle} className="shrink-0 text-[10px]" title={zone.enabled ? "Disable zone" : "Enable zone"}>
        <span className={zone.enabled ? "text-sky-400" : "text-[var(--color-fg-dim)]"}>
          {zone.enabled ? "●" : "○"}
        </span>
      </button>

      {/* Price */}
      {editing ? (
        <input
          autoFocus
          type="number"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") { setDraft(zone.price.toFixed(2)); setEditing(false); } }}
          className="unt-input h-5 w-24 font-mono text-[11px] tabular-nums"
        />
      ) : (
        <button
          type="button"
          className="min-w-0 flex-1 text-left font-mono text-[11px] tabular-nums text-[var(--color-fg)] hover:text-sky-300"
          onClick={() => { setDraft(zone.price.toFixed(2)); setEditing(true); }}
          title="Click to edit price"
        >
          ${zone.price.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
        </button>
      )}

      {/* Meta — show which timeframes contributed, or "manual" */}
      <span className="shrink-0 text-[10px] text-[var(--color-fg-dim)]">
        {(() => {
          const src = (zone as { sources?: string }).sources;
          if (!src) return zone.touches > 0 ? `×${zone.touches}` : "manual";
          if (src === "swing") return "Swing low";
          if (src.startsWith("swing+")) return `Swing · ${src.slice("swing+".length)}`;
          if (src.startsWith("vision·")) return `👁 ${src.slice("vision·".length)}`;
          return src;
        })()}
      </span>

      {/* Remove */}
      <button type="button" onClick={onRemove} className="shrink-0 text-[10px] text-[var(--color-fg-dim)] hover:text-red-400" title="Remove zone">
        ✕
      </button>
    </div>
  );
}

function ScalperPaperPanel({
  snapshot,
  mint,
  orderBookConn,
  paperSessionActive,
  tradingMode,
  liveChainTrades,
}: {
  snapshot: ScalperPaperSnapshot | null;
  mint: string | null;
  orderBookConn: "idle" | "connecting" | "open" | "closed" | "error";
  paperSessionActive: boolean;
  tradingMode: TradingMode;
  liveChainTrades: BotTradeRow[];
}) {
  const { scalperUserConfig, setScalperUserConfig } = useApp();

  const wrap = (belowRules: ReactNode) => (
    <div className="space-y-2 text-[12px]">
      {/* ── Entry card ── */}
      <SettingsCard
        label="Entry"
        tip="Rules for when we open a buy."
        liveSession={paperSessionActive}
      >
        <div className="grid grid-cols-2 gap-x-3 gap-y-2.5">
          <Knob label="Dip %" value={scalperUserConfig.dipMinPct} min={1} max={50} step={1} unit="%"
            tip="How far the chart needs to drop from its recent high before we look for a buy. After each trade, we start measuring again."
            onChange={(v) => setScalperUserConfig({ dipMinPct: v })} />
          <Knob label="Min buy (SOL)" value={scalperUserConfig.catalystMinSol} min={0.01} max={10} step={0.05} unit="SOL"
            tip="We only jump in if someone buys this much SOL or more. Tiny buys are ignored so we don't chase noise."
            onChange={(v) => setScalperUserConfig({ catalystMinSol: v })} />
        </div>
      </SettingsCard>

      {/* ── Exit card ── */}
      <SettingsCard label="Exit" tip="Rules for when we sell and leave the trade." liveSession={paperSessionActive}>
        <div className="grid grid-cols-2 gap-x-3 gap-y-2.5">
          <Knob label="Take profit %" value={scalperUserConfig.takeProfitPct} min={1} max={200} step={1} unit="%"
            tip="We sell for profit when the chart goes up this much above where we bought (same numbers as on your chart)."
            onChange={(v) => setScalperUserConfig({ takeProfitPct: v })} />
          <Knob label="Stop SOL" value={scalperUserConfig.minOrderBookSellSolForStop} min={0.01} max={10} step={0.05} unit="SOL"
            tip="If we see a sell this big or bigger, we treat it as a stop and get out. Smaller sells don't count."
            onChange={(v) => setScalperUserConfig({ minOrderBookSellSolForStop: v })} />
          <Knob label="Re-entry cooldown (s)" value={Math.round(scalperUserConfig.reentryCooldownMs / 1000)} min={2} max={300} step={1} unit="s"
            tip="Seconds to wait after a closed trade before looking for a new entry. Default 30 s prevents back-to-back double entries."
            onChange={(v) => setScalperUserConfig({ reentryCooldownMs: Math.round(v) * 1000 })} />
        </div>
      </SettingsCard>

      {/* ── Execution card (real mode only) ── */}
      {tradingMode === "real" ? (
        <SettingsCard
          label="Execution"
          tip="Only used when real money is on. Slippage = how much the price can move before your trade still goes through. Priority fee = a little extra SOL so the chain handles your trade faster."
          liveSession={paperSessionActive}
        >
          <div className="grid grid-cols-2 gap-x-3 gap-y-2.5">
            <Knob label="Slippage %" value={scalperUserConfig.realSlippagePct} min={1} max={50} step={1} unit="%"
              tip="How much wiggle room the price has. Higher usually means fewer failed trades on jumpy coins."
              onChange={(v) => setScalperUserConfig({ realSlippagePct: v })} />
            <Knob label="Priority fee" value={scalperUserConfig.realPriorityFeeSol} min={0.00001} max={0.1} step={0.0005} unit="SOL"
              tip="Extra SOL paid so your trade gets picked up sooner. Try around 0.001 SOL to start."
              onChange={(v) => setScalperUserConfig({ realPriorityFeeSol: v })} />
          </div>
        </SettingsCard>
      ) : null}

      {/* ── Bounce zones card ── */}
      {mint ? (
        <SettingsCard
          label="Bounce zones"
          tip="Lines on the chart where price bounced a few times. Turn a line on (solid dot) and we only buy when price is close to it. Drag the line on the chart to move it."
          accent="sky"
          headerRight={<SuggestLinesButton />}
        >
          <Tooltip
            text="Refresh bounce lines sends one chart image to your LLM per click — costs more than plain chat. Check your provider usage dashboard."
            side="bottom"
          >
            <div
              role="note"
              className="mb-2 flex items-start gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/[0.07] px-2 py-1.5 text-[10px] font-medium leading-snug text-amber-100/95"
            >
              <span className="shrink-0 select-none" aria-hidden>
                ⚠
              </span>
              <span>Check API credit spend - still optimizing</span>
            </div>
          </Tooltip>
          <BounceZonesEditor mint={mint} />
        </SettingsCard>
      ) : null}

      {belowRules}
    </div>
  );

  if (!paperSessionActive) {
    return wrap(
      <p className="unt-help-text">
        Tap <strong className="font-semibold text-[var(--color-fg-muted)]">Start</strong> below. Paste a coin on the Chart tab so we can see live trades — numbers show up here when it&apos;s working.
      </p>,
    );
  }
  if (!mint) {
    return wrap(
      <p className="unt-help-text">
        Put this same coin on the Chart tab first — we need live trades to run.
      </p>,
    );
  }
  if (orderBookConn !== "open") {
    const plain =
      orderBookConn === "connecting"
        ? "Still connecting to live trades…"
        : orderBookConn === "error"
          ? "Something broke connecting to live trades. Refresh or try again."
          : "Live trades are turned off. Open the Chart tab with your coin.";
    return wrap(<p className="unt-help-text">{plain}</p>);
  }
  if (!snapshot) {
    return wrap(<p className="unt-help-text">Hang tight — connecting to live trades…</p>);
  }

  const st =
    snapshot.status === "watching"
      ? "Watching"
      : snapshot.status === "nearing"
        ? "Nearing bounce region — arming trade"
        : snapshot.status === "dip"
          ? "Dipped — not armed yet"
          : snapshot.status === "arming"
            ? `Armed — next ${scalperUserConfig.catalystMinSol}+ SOL buy fires`
            : "In a trade";

  const chainLegs =
    tradingMode === "real" ? liveChainTrades.filter(isBotTradeChain) : [];
  const chainClosed = chainLegs.length;
  const chainWins = chainLegs.filter((t) => t.netSol > 0).length;
  const chainWinRate = chainClosed > 0 ? (chainWins / chainClosed) * 100 : null;
  const chainNetSum = chainLegs.reduce((s, t) => s + t.netSol, 0);

  const tapePaperEstLegs: (BotTradeRowTape & { paperSolEstimate: NonNullable<BotTradeRowTape["paperSolEstimate"]> })[] =
    tradingMode === "paper"
      ? snapshot.botTrades.filter(
          (t): t is BotTradeRowTape & { paperSolEstimate: NonNullable<BotTradeRowTape["paperSolEstimate"]> } =>
            t.kind === "tape" && t.paperSolEstimate != null,
        )
      : [];
  const paperEstNetSum = tapePaperEstLegs.reduce((s, t) => s + t.paperSolEstimate.netSol, 0);

  return wrap(
    <>
      <div className="flex justify-between gap-2 text-[var(--color-fg-muted)]">
        <span>Status</span>
        <span
          className={
            snapshot.status === "nearing"
              ? "text-amber-400 font-medium"
              : snapshot.status === "arming"
                ? "text-emerald-400 font-medium"
                : snapshot.status === "in_trade"
                  ? "text-emerald-300 font-medium"
                  : "text-[var(--color-fg)]"
          }
        >
          {st}
        </span>
      </div>
      <div className="flex justify-between gap-2 text-[var(--color-fg-muted)]">
        <span>Win rate</span>
        <span className="text-[var(--color-fg)]">
          {tradingMode === "real"
            ? chainWinRate != null
              ? chainWinRate.toFixed(1) + "%"
              : "—"
            : snapshot.winRate != null
              ? snapshot.winRate.toFixed(1) + "%"
              : "—"}
        </span>
      </div>
      <div className="flex justify-between gap-2 text-[var(--color-fg-muted)]">
        <span title={tradingMode === "real" ? "SOL added or removed from your wallet after each finished trade." : "Adds up the chart move % on each practice trade."}>
          {tradingMode === "real" ? "Total SOL" : "Practice total %"}
        </span>
        <span
          className={
            tradingMode === "real"
              ? chainClosed > 0
                ? chainNetSum >= 0
                  ? "text-emerald-300"
                  : "text-red-400"
                : "text-[var(--color-fg)]"
              : snapshot.totalPnlPct >= 0
                ? "text-emerald-300"
                : "text-red-400"
          }
        >
          {tradingMode === "real"
            ? chainClosed > 0
              ? (chainNetSum >= 0 ? "+" : "") + formatSol(chainNetSum)
              : "—"
            : (snapshot.totalPnlPct >= 0 ? "+" : "") + snapshot.totalPnlPct.toFixed(2) + "%"}
        </span>
      </div>
      {tradingMode === "paper" && snapshot.closedTrades > 0 ? (
        <div className="flex justify-between gap-2 text-[var(--color-fg-muted)]">
          <span title="Rough SOL profit on practice trades when we have enough price data (not perfect).">
            Est. practice SOL
          </span>
          <span
            className={
              tapePaperEstLegs.length > 0
                ? paperEstNetSum >= 0
                  ? "text-cyan-300/95"
                  : "text-orange-300/95"
                : "text-[var(--color-fg)]"
            }
          >
            {tapePaperEstLegs.length > 0
              ? (paperEstNetSum >= 0 ? "+" : "") + formatSol(paperEstNetSum)
              : "—"}
          </span>
        </div>
      ) : null}
      <div className="flex justify-between gap-2 text-[var(--color-fg-muted)]">
        <span>Closed trades</span>
        <span className="text-[var(--color-fg)]">
          {tradingMode === "real" ? chainClosed : snapshot.closedTrades}
        </span>
      </div>
      <div className="border-t border-[var(--color-border-subtle)] pt-2">
        <div className="unt-section-overline">Current trade</div>
      </div>
      {snapshot.currentTrade ? (
        <div className="space-y-1 text-[11px] leading-snug text-[var(--color-fg-muted)]">
          <div>Bought near {formatUsdCompact(snapshot.currentTrade.entryMcUsd)}</div>
          <div>Big buy that triggered us: {snapshot.currentTrade.catalystSol.toFixed(2)} SOL</div>
          {snapshot.currentTrade.lastMcUsd != null ? (
            <div>Chart now {formatUsdCompact(snapshot.currentTrade.lastMcUsd)}</div>
          ) : null}
          {snapshot.currentTrade.unrealizedPct != null ? (
            <div>
              Unrealized profit{" "}
              <span
                className={
                  snapshot.currentTrade.unrealizedPct >= 0 ? "text-emerald-300" : "text-red-400"
                }
              >
                {(snapshot.currentTrade.unrealizedPct >= 0 ? "+" : "") +
                  snapshot.currentTrade.unrealizedPct.toFixed(2) +
                  "%"}
              </span>
              {tradingMode === "real" ? (
                <span className="text-[var(--color-fg-dim)]"> (same as chart)</span>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : (
        <div className="text-[11px] text-[var(--color-fg-dim)]">
          {snapshot.status === "nearing" ? (
            <span className="text-amber-400 font-medium">⚠️ Nearing bounce region — arming trade</span>
          ) : snapshot.status === "arming" ? (
            <span className="text-emerald-400 font-medium">🟢 Armed — waiting for catalyst buy</span>
          ) : snapshot.status === "dip" ? (
            <span className="text-sky-400">Dipped — waiting for zone alignment</span>
          ) : (
            <span>Flat</span>
          )}
        </div>
      )}
    </>,
  );
}
