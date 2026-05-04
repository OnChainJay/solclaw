import type { CSSProperties } from "react";
import { useMemo } from "react";
import { PumpPortalWalletFundingBadge } from "@/components/PumpPortalWalletFundingBadge";
import { Tooltip } from "@/components/Tooltip";
import { useApp } from "@/context/AppContext";
import { usePumpPortalConfigRevision } from "@/hooks/usePumpPortalConfigRevision";
import { usePumpPortalLinkedWalletSol } from "@/hooks/usePumpPortalLinkedWalletSol";
import { useSetupProgress } from "@/hooks/useSetupProgress";
import { getPumpPortalTradingWalletPubkey } from "@/lib/pumpPortalConfig";
import { homePath } from "@/lib/siteUrls";

const noDrag = { WebkitAppRegion: "no-drag" } as CSSProperties;
const drag = { WebkitAppRegion: "drag" } as CSSProperties;

export function AppTopChrome() {
  const {
    sidebarOpen,
    setSidebarOpen,
    sidebarMode,
    setSidebarMode,
    activitySection,
    setActivitySection,
    openSetupPanel,
  } = useApp();

  const { done, complete, hint, total } = useSetupProgress();
  const pumpPortalRev = usePumpPortalConfigRevision();

  const topBarPortalLinkedPk = useMemo(() => getPumpPortalTradingWalletPubkey(), [pumpPortalRev]);

  const {
    sol: topBarPortalSol,
    loading: topBarPortalSolLoading,
  } = usePumpPortalLinkedWalletSol(topBarPortalLinkedPk);

  return (
    <header
      className={
        "flex min-h-11 shrink-0 flex-col border-b transition-[background-color,border-color,box-shadow] duration-200 " +
        (complete
          ? "border-[color-mix(in_srgb,var(--color-border)_65%,#2EA8FF_18%)] bg-[var(--color-bg-titleBar)] shadow-[0_10px_32px_rgba(0,0,0,0.55),inset_0_1px_0_rgba(255,255,255,0.055)]"
          : "border-red-500/40 bg-gradient-to-b from-red-950/75 via-red-950/55 to-red-950/[0.42]")
      }
    >
      {/* Incomplete setup: obvious band above the nav — reads as "needs attention" */}
      {!complete ? (
        <div
          className="flex shrink-0 items-center justify-center border-b border-red-500/25 bg-red-600/10 px-4 py-1.5 text-center text-[11px] font-medium text-red-100/95"
          style={noDrag}
        >
          Finish setup to unlock live data, the assistant, and GitHub apply —{" "}
          <button
            type="button"
            className="ml-1 underline decoration-red-300/50 underline-offset-2 hover:text-white"
            onClick={openSetupPanel}
          >
            open Setup
          </button>
        </div>
      ) : null}

      <div className="flex min-h-11 min-w-0 flex-1 items-center gap-2 px-2 py-2 sm:gap-3 sm:px-4">
        <div
          className={
            "flex min-w-0 flex-wrap items-center gap-0.5 rounded-xl border p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_4px_18px_rgba(0,0,0,0.35)] backdrop-blur-[2px] sm:gap-1 " +
            (complete
              ? "border-[color-mix(in_srgb,#2EA8FF_28%,#2a3230)] bg-[linear-gradient(180deg,rgba(46,168,255,0.07)_0%,rgba(0,0,0,0.35)_100%)]"
              : "border-red-500/30 bg-[linear-gradient(180deg,rgba(248,113,113,0.08)_0%,rgba(0,0,0,0.4)_100%)]")
          }
          style={noDrag}
        >
          <Tooltip text="Chart, tape, and algo trading controls" side="bottom" delay={500}>
            <NavTab
              label="Dashboard"
              active={activitySection === "analytics"}
              onClick={() => {
                setActivitySection("analytics");
                setSidebarMode("analytics");
                setSidebarOpen(true);
              }}
            />
          </Tooltip>
          <Tooltip text="Configure your LLM, PumpPortal API key, trading wallet, and GitHub" side="bottom" delay={500}>
            <NavTab
              label="Setup"
              active={activitySection === "models"}
              onClick={() => {
                setActivitySection("models");
                setSidebarMode("models");
                setSidebarOpen(true);
              }}
            />
          </Tooltip>
          <Tooltip text="Browse and edit your codebase via GitHub" side="bottom" delay={500}>
            <NavTab
              label="Code"
              active={activitySection === "code"}
              onClick={() => {
                setActivitySection("code");
                setSidebarMode("code");
                setSidebarOpen(true);
              }}
            />
          </Tooltip>
          <Tooltip text="Multi-token scanner — runs Lowest-Low algo across Nursery tokens" side="bottom" delay={500}>
            <NavTab
              label="Scanner"
              active={sidebarMode === "scanner"}
              onClick={() => {
                setSidebarMode("scanner");
                setSidebarOpen(true);
              }}
            />
          </Tooltip>
          <Tooltip text="All-time trading history and stats across every session and wallet" side="bottom" delay={500}>
            <NavTab
              label="Performance"
              active={activitySection === "performance"}
              onClick={() => {
                setActivitySection("performance");
                setSidebarMode("performance");
                setSidebarOpen(true);
              }}
            />
          </Tooltip>
          <Tooltip text="Training data — coming soon" side="bottom" delay={500}>
            <NavTab
              label="Training data"
              active={activitySection === "training"}
              onClick={() => {
                setActivitySection("training");
                setSidebarMode("training");
                setSidebarOpen(true);
              }}
            />
          </Tooltip>
        </div>

        <div
          className="hidden min-w-0 flex-1 select-none items-center justify-center px-4 text-center sm:flex"
          style={drag}
        >
          <a
            href={homePath()}
            className="inline-flex items-center gap-1.5 truncate text-[13px] font-semibold tracking-[0.02em] text-[color-mix(in_srgb,var(--color-fg)_78%,#2EA8FF_22%)] drop-shadow-[0_0_14px_rgba(46,168,255,0.12)] transition-opacity hover:opacity-80 pointer-events-auto"
            style={noDrag}
            title="Back to home"
          >
            <img src="/solclaw-logo.png" alt="" className="h-4 w-4 object-contain opacity-80" />
            SolClaw
          </a>
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-2" style={noDrag}>
          {topBarPortalLinkedPk ? (
            <Tooltip
              text={`PumpPortal trading wallet balance. Address: ${topBarPortalLinkedPk.slice(0, 6)}…${topBarPortalLinkedPk.slice(-4)}`}
              side="bottom"
            >
              <PumpPortalWalletFundingBadge
                sol={topBarPortalSol}
                loading={topBarPortalSolLoading}
                hasPubkey
                compact
              />
            </Tooltip>
          ) : null}
          <Tooltip text={hint} side="bottom">
          <button
            type="button"
            onClick={openSetupPanel}
            className={
              "flex shrink-0 items-center gap-2 rounded-lg border text-left font-medium transition-colors " +
              (complete
                ? "border-emerald-500/25 bg-emerald-950/30 px-2.5 py-1 text-[11px] text-emerald-100/90 hover:bg-emerald-900/35"
                : "border-red-400/40 bg-red-600/20 px-3 py-1.5 text-[12px] text-red-50 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] hover:bg-red-600/30")
            }
          >
            <span className="hidden sm:inline">{complete ? "Setup" : "Setup needed"}</span>
            <span
              className={
                "rounded-md px-1.5 py-0.5 font-mono tabular-nums " +
                (complete ? "bg-emerald-500/20 text-[11px]" : "bg-red-500/35 text-[11px]")
              }
            >
              {done}/{total}
            </span>
          </button>
          </Tooltip>

          <button
            type="button"
            title={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="shrink-0 rounded-lg border border-white/12 bg-[color-mix(in_srgb,var(--color-fill)_45%,transparent)] px-2.5 py-1 text-[12px] font-medium text-[var(--color-fg)] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] transition-colors hover:border-[color-mix(in_srgb,#2EA8FF_35%,white)] hover:text-[var(--color-fg)]"
          >
            {sidebarOpen ? "Hide panel" : "Show panel"}
          </button>
        </div>
      </div>
    </header>
  );
}

function NavTab({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={
        "rounded-lg px-2.5 py-1.5 text-[12px] font-semibold tracking-wide outline-none transition-[color,background-color,border-color,box-shadow] duration-150 sm:px-3.5 sm:text-[13px] " +
        "focus-visible:ring-2 focus-visible:ring-[color-mix(in_srgb,#2EA8FF_45%,transparent)] focus-visible:ring-offset-0 " +
        (active
          ? "border border-[color-mix(in_srgb,#2EA8FF_45%,transparent)] bg-[color-mix(in_srgb,#2EA8FF_14%,rgba(0,0,0,0.45))] text-[#e8f4ff] shadow-[0_0_20px_-8px_rgba(46,168,255,0.55),inset_0_1px_0_rgba(255,255,255,0.12)]"
          : "border border-transparent text-[color-mix(in_srgb,var(--color-fg)_92%,#2EA8FF_8%)] hover:border-white/10 hover:bg-white/[0.07] hover:text-[var(--color-fg)] hover:shadow-[0_0_12px_-8px_rgba(46,168,255,0.2)]")
      }
    >
      {label}
    </button>
  );
}
