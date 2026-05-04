import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { BotTradeRow, BotTradeRowChain, BotTradeRowTape, ScalperPaperSnapshot } from "@/lib/scalperPaperEngine";
import type { BounceZone } from "@/lib/chartBounceZones";
import { createAssistantGreetingMessage } from "@/lib/chatGreeting";
import { inferBackendIdFromBaseUrl } from "@/lib/llmBackends";
import type { ChatMessage, ChatSession, GitHubWorkspaceSettings, ModelSettings, UserAlgoPreset } from "@/types";
import { githubGetFileContent, githubPutFileContent } from "@/lib/githubApi";
import {
  isFileSystemAccessSupported,
  loadPersistedHandle,
  openLocalWorkspace,
  requestPermission,
  writeLocalFile,
  clearPersistedHandle,
} from "@/lib/localWorkspace";
import { SCALPER_PAPER_CONFIG } from "@/lib/scalperPaperConfig";

const MODEL_STORAGE_KEY = "unt_model_settings_v1";
const GITHUB_WORKSPACE_KEY = "unt_github_workspace_v1";
/** Legacy single-session key — migrated on first load */
const LEGACY_MESSAGES_KEY = "unt_chat_messages_v1";
const CHAT_SESSIONS_KEY = "unt_chat_sessions_v2";
const USER_ALGOS_KEY = "unt_user_algo_presets_v1";
const TRADING_MODE_STORAGE_KEY = "unt_trading_mode_v1";
const SELECTED_ALGO_KEY = "unt_selected_algo_v1";
const CA_MINT_KEY = "unt_ca_mint_v1";
const SCALPER_LIVE_BUY_SOL_KEY = "unt_scalper_live_buy_sol_v1";
const PERSISTED_TRADES_KEY = "unt_persisted_bot_trades_v1";
const BOUNCE_ZONES_KEY = "unt_bounce_zones_v1";
const SCALPER_USER_CONFIG_KEY = "unt_scalper_user_config_v1";
const SCALPER_LIVE_BUY_MIN = 0.001;
const SCALPER_LIVE_BUY_MAX = 25;
const MAX_STORED_MESSAGES = 120;
const MAX_SESSIONS = 10;
const MAX_PERSISTED_TRADES = 1000;

export type TradingMode = "paper" | "real";

function loadTradingMode(): TradingMode {
  try {
    const raw = localStorage.getItem(TRADING_MODE_STORAGE_KEY);
    if (raw === "real" || raw === "paper") return raw;
    return "paper";
  } catch {
    return "paper";
  }
}

export const defaultModel: ModelSettings = {
  providerLabel: "OpenAI",
  baseUrl: "https://api.openai.com/v1",
  apiKey: "",
  model: "gpt-4o-mini",
  llmBackendId: "openai",
};

function loadModel(): ModelSettings {
  try {
    const raw = localStorage.getItem(MODEL_STORAGE_KEY);
    if (!raw) return defaultModel;
    const parsed = { ...defaultModel, ...JSON.parse(raw) } as ModelSettings;
    if (!parsed.llmBackendId) {
      const fromUrl = inferBackendIdFromBaseUrl(parsed.baseUrl);
      if (fromUrl) parsed.llmBackendId = fromUrl;
    }
    return parsed;
  } catch {
    return defaultModel;
  }
}

function makeGreetingSession(id?: string, name?: string): ChatSession {
  return {
    id: id ?? crypto.randomUUID(),
    name: name ?? "Chat 1",
    messages: [createAssistantGreetingMessage()],
    createdAt: Date.now(),
  };
}


function loadUserAlgos(): UserAlgoPreset[] {
  try {
    const raw = localStorage.getItem(USER_ALGOS_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as UserAlgoPreset[];
  } catch {
    return [];
  }
}

const defaultGithubWorkspace: GitHubWorkspaceSettings = {
  token: "",
  owner: "",
  repo: "",
  branch: "main",
};

function loadSelectedAlgoId(): string | null {
  try {
    return localStorage.getItem(SELECTED_ALGO_KEY) ?? null;
  } catch {
    return null;
  }
}

function loadCaMintInput(): string {
  try {
    return localStorage.getItem(CA_MINT_KEY) ?? "";
  } catch {
    return "";
  }
}

function clampScalperLiveBuySol(n: number): number {
  if (!Number.isFinite(n)) return SCALPER_PAPER_CONFIG.realBuySol;
  return Math.min(SCALPER_LIVE_BUY_MAX, Math.max(SCALPER_LIVE_BUY_MIN, n));
}

function loadScalperLiveBuySol(): number {
  try {
    const raw = localStorage.getItem(SCALPER_LIVE_BUY_SOL_KEY);
    if (!raw) return SCALPER_PAPER_CONFIG.realBuySol;
    return clampScalperLiveBuySol(Number(raw));
  } catch {
    return SCALPER_PAPER_CONFIG.realBuySol;
  }
}

function loadGithubWorkspace(): GitHubWorkspaceSettings {
  try {
    const raw = localStorage.getItem(GITHUB_WORKSPACE_KEY);
    if (!raw) return { ...defaultGithubWorkspace };
    return { ...defaultGithubWorkspace, ...JSON.parse(raw) } as GitHubWorkspaceSettings;
  } catch {
    return { ...defaultGithubWorkspace };
  }
}

/** User-editable scalper strategy parameters (knobs in the sidebar). */
export type ScalperUserConfig = {
  dipMinPct: number;
  catalystMinSol: number;
  takeProfitPct: number;
  minOrderBookSellSolForStop: number;
  realSlippagePct: number;
  realPriorityFeeSol: number;
  /** Re-entry cooldown in milliseconds after a closed trade — maps directly to SCALPER_PAPER_CONFIG.reentryCooldownMs. */
  reentryCooldownMs: number;
};

function defaultScalperUserConfig(): ScalperUserConfig {
  return {
    dipMinPct: SCALPER_PAPER_CONFIG.dipMinPct,
    catalystMinSol: SCALPER_PAPER_CONFIG.catalystMinSol,
    takeProfitPct: SCALPER_PAPER_CONFIG.takeProfitPct,
    minOrderBookSellSolForStop: SCALPER_PAPER_CONFIG.minOrderBookSellSolForStop,
    realSlippagePct: SCALPER_PAPER_CONFIG.realSlippagePct,
    realPriorityFeeSol: 0.001,
    reentryCooldownMs: 30_000, // 30 s default — prevents rapid double-entry on real money
  };
}

function loadScalperUserConfig(): ScalperUserConfig {
  try {
    const raw = localStorage.getItem(SCALPER_USER_CONFIG_KEY);
    if (!raw) return defaultScalperUserConfig();
    return { ...defaultScalperUserConfig(), ...JSON.parse(raw) } as ScalperUserConfig;
  } catch {
    return defaultScalperUserConfig();
  }
}

export type ActivitySection = "analytics" | "models" | "code" | "performance" | "training";
export type SidebarMode = "analytics" | "models" | "code" | "performance" | "training" | "scanner";

/**
 * A closed bot trade that survives session resets and page reloads.
 * Stores the wallet + mint at time of trade so records stay accurate even after
 * the user switches wallets or tokens.
 */
export type PersistedBotTrade = (BotTradeRowChain | BotTradeRowTape) & {
  walletPk: string;
  mint: string;
};

/**
 * A bounce zone the user has confirmed (or manually created) for a specific mint.
 * Survives session resets so lines re-appear when you re-load the same token.
 */
export type UserBounceZone = {
  id: string;
  mint: string;
  /** Price level in the same USD units as the chart (MC USD or price USD). */
  price: number;
  /** Auto-detected touch count; 0 = manually added. */
  touches: number;
  /** Whether this zone is active (used as an entry condition). */
  enabled: boolean;
  /** 0–1 strength from detection; 0 = manual. */
  strength: number;
  /**
   * For multi-timeframe auto zones: which resolutions contributed, e.g. "5m+15m+1h".
   * Undefined for manually added zones.
   */
  sources?: string;
};

function loadBounceZones(): UserBounceZone[] {
  try {
    const raw = localStorage.getItem(BOUNCE_ZONES_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as UserBounceZone[];
  } catch {
    return [];
  }
}

function loadPersistedTrades(): PersistedBotTrade[] {
  try {
    const raw = localStorage.getItem(PERSISTED_TRADES_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as PersistedBotTrade[];
  } catch {
    return [];
  }
}

/** Live chart + PumpPortal order-book stream signals for the Dashboard sidebar (chart panel). */
/** Last closed candle as shown on chart (OHLC). Values are price USD or MC USD depending on axis mode. */
export type ChartCandleBarSummary = {
  interval: string;
  timeUnix: number;
  open: number;
  high: number;
  low: number;
  close: number;
  yAxisIsMarketCapUsd: boolean;
};

export type ChartTapePrintLite = {
  ts: number;
  buy: boolean;
  sol: number;
  mcUsd: number | null;
};

/** Aggregate view of buffered PumpPortal prints (newest-first buffer). */
export type ChartTapeSummary = {
  sampleSize: number;
  buyCount: number;
  sellCount: number;
  solVolume: number;
  /** Best available MC from recent prints (usually newest trade's MC). */
  latestMcUsd: number | null;
  recentPrints: ChartTapePrintLite[];
};

export type ChartAnalyticsState = {
  mint: string | null;
  chartLoading: boolean;
  chartError: string | null;
  yMcCap: boolean | null;
  /** Candle interval when a mint is active */
  chartInterval: string | null;
  lastCandle: ChartCandleBarSummary | null;
  tapeSummary: ChartTapeSummary | null;
  /** SPL token supply (UI units) when RPC returned it — used for MC scaling context */
  tokenSupplyUi: number | null;
  orderBookConn: "idle" | "connecting" | "open" | "closed" | "error";
  orderBookError: string | null;
  /** When the last trade for the active mint arrived (ms epoch). null = never. */
  orderBookLastTradeAt: number | null;
  /** Paper Scalper sim fed by the order-book stream (chart panel); null when inactive. */
  paperScalper: ScalperPaperSnapshot | null;
  /** Closed round-trips from real execution (reserved for future local-signing path). */
  realBotTrades: BotTradeRow[];
  /** Last PumpPortal Lightning tx signature from live scalper (browser → PumpPortal). */
  livePumpPortalLastSig: string | null;
  /** Last live trade error message from PumpPortal. */
  livePumpPortalLastErr: string | null;
  /** Status of the vision-based bounce detection (runs on manual Refresh). */
  visionDetectStatus: "idle" | "loading" | "done" | "error";
  /** Error message if vision detection failed. */
  visionDetectError: string | null;
};

const defaultChartAnalytics: ChartAnalyticsState = {
  mint: null,
  chartLoading: false,
  chartError: null,
  yMcCap: null,
  chartInterval: null,
  lastCandle: null,
  tapeSummary: null,
  tokenSupplyUi: null,
  orderBookConn: "idle",
  orderBookError: null,
  orderBookLastTradeAt: null,
  paperScalper: null,
  realBotTrades: [],
  livePumpPortalLastSig: null,
  livePumpPortalLastErr: null,
  visionDetectStatus: "idle",
  visionDetectError: null,
};

type AppState = {
  model: ModelSettings;
  setModel: (m: Partial<ModelSettings>) => void;

  /** All chat sessions */
  chatSessions: ChatSession[];
  activeChatId: string;
  setActiveChatId: (id: string) => void;
  newChatSession: () => void;
  closeChatSession: (id: string) => void;
  renameChatSession: (id: string, name: string) => void;
  setSessionModel: (id: string, patch: Partial<ModelSettings>) => void;
  clearSessionModel: (id: string) => void;

  /** Convenience: messages of the active session */
  messages: ChatMessage[];
  appendMessage: (m: Omit<ChatMessage, "id" | "createdAt">) => string;
  updateMessage: (id: string, patch: Partial<Pick<ChatMessage, "content">>) => void;
  clearChat: () => void;

  /** Opens the Setup sidebar (models / keys). */
  openSetupPanel: () => void;

  /**
   * Put this mint in the Chart panel input and focus Dashboard (user still triggers fetch via debounce).
   */
  navigateChartToMint: (mint: string) => void;

  chartAnalytics: ChartAnalyticsState;
  setChartAnalytics: (patch: Partial<ChartAnalyticsState>) => void;
  composerBusy: boolean;
  setComposerBusy: (v: boolean) => void;
  sidebarMode: SidebarMode;
  setSidebarMode: (m: SidebarMode) => void;
  sidebarOpen: boolean;
  setSidebarOpen: (v: boolean) => void;
  activitySection: ActivitySection;
  setActivitySection: (s: ActivitySection) => void;
  userAlgos: UserAlgoPreset[];
  addUserAlgo: (name: string, description: string) => void;
  removeUserAlgo: (id: string) => void;
  selectedAlgoId: string | null;
  setSelectedAlgoId: (id: string | null) => void;
  caMintInput: string;
  setCaMintInput: (v: string) => void;
  /** SOL per Lightning buy when Order-book scalper is in real mode (clamped). */
  scalperLiveBuySol: number;
  setScalperLiveBuySol: (v: number) => void;
  tradingMode: TradingMode;
  setTradingMode: (m: TradingMode) => void;
  algoSessionActive: boolean;
  setAlgoSessionActive: (v: boolean) => void;
  /** When true, live PumpPortal sends are blocked until cleared (e.g. new session). */
  tradingHalted: boolean;
  setTradingHalted: (v: boolean) => void;
  /** Emergency stop: halt live sends + end scalper session. */
  hardStopTrading: () => void;
  /** Fire an immediate real sell for 100 % of token balance, then stop the session. */
  manualSellRequested: boolean;
  requestManualSell: () => void;
  clearManualSellRequest: () => void;
  /** User-editable scalper strategy params (knobs). Persisted to localStorage. */
  scalperUserConfig: ScalperUserConfig;
  setScalperUserConfig: (patch: Partial<ScalperUserConfig>) => void;
  /** Bounce zones for the current (and past) mints — auto-detected + user overrides. */
  bounceZones: UserBounceZone[];
  /** Replace detected zones for a mint (called when candles reload). Keeps user-manual zones intact. */
  setDetectedZones: (mint: string, zones: BounceZone[]) => void;
  /** Bump this to trigger bounce detection with already-loaded floor candles (Suggest lines button). */
  bounceSuggestionTick: number;
  refreshSuggestedBounceZones: () => void;
  /**
   * Loading state for the 3-page floor candle prefetch that backs "Suggest lines".
   * "idle" — no mint loaded yet; "loading" — fetching candles; "ready" — candles fetched, button enabled.
   */
  floorCandlesStatus: "idle" | "loading" | "ready";
  setFloorCandlesStatus: (s: "idle" | "loading" | "ready") => void;
  /** Toggle a zone on/off. */
  toggleBounceZone: (id: string) => void;
  /** Update the price of a zone (user edits the number input). */
  updateBounceZonePrice: (id: string, price: number) => void;
  /** Add a manual zone for a mint. */
  addBounceZone: (mint: string, price: number) => void;
  /** Remove a zone entirely. */
  removeBounceZone: (id: string) => void;
  /** All-time persisted bot trades (real + paper) across sessions and wallet changes. */
  persistedBotTrades: PersistedBotTrade[];
  /** Append new closed trades to the persistent log. Deduplicates by id. */
  appendPersistedTrades: (trades: PersistedBotTrade[]) => void;
  /** Wipe the persistent trade log. */
  clearPersistedTrades: () => void;
  githubWorkspace: GitHubWorkspaceSettings;
  setGithubWorkspace: (patch: Partial<GitHubWorkspaceSettings>) => void;
  openFilePath: string | null;
  openFileContent: string | null;
  setOpenFile: (path: string | null, content: string | null) => void;
  workspaceFilePaths: string[];
  setWorkspaceFilePaths: (paths: string[]) => void;
  applyEditTick: number;
  lastAppliedPath: string | null;
  /**
   * Apply a file edit from chat. Auto-detects create vs update.
   * If a local workspace is connected, writes to disk (Vite HMR) and queues for GitHub push.
   * Otherwise falls back to a direct GitHub commit.
   * Returns the GitHub commit SHA (empty string for local-only writes).
   */
  applyFileEdit: (path: string, code: string, commitMessage?: string) => Promise<string>;
  /** The locally-connected repo folder (File System Access API). Null if not connected. */
  localWorkspaceHandle: FileSystemDirectoryHandle | null;
  /** Connect (or reconnect) the local workspace folder. */
  connectLocalWorkspace: () => Promise<void>;
  /** Disconnect the local workspace. */
  disconnectLocalWorkspace: () => void;
  /** Files written locally but not yet pushed to GitHub. */
  pendingLocalEdits: Map<string, string>;
  /** Push all pending local edits to GitHub and clear the queue. */
  pushPendingToGitHub: () => Promise<void>;
};

const Ctx = createContext<AppState | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [model, setModelState] = useState(loadModel);

  // Chat sessions intentionally NOT loaded from localStorage — always start fresh.
  const [sessionsState, setSessionsState] = useState(() => {
    const s = makeGreetingSession();
    return { sessions: [s], activeId: s.id };
  });
  const chatSessions = sessionsState.sessions;
  const activeChatId = sessionsState.activeId;

  const [sidebarMode, setSidebarMode] = useState<SidebarMode>("analytics");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [activitySection, setActivitySection] = useState<ActivitySection>("analytics");
  const [chartAnalytics, setChartAnalyticsState] = useState<ChartAnalyticsState>(defaultChartAnalytics);
  const [composerBusy, setComposerBusy] = useState(false);
  const [userAlgos, setUserAlgos] = useState(loadUserAlgos);
  const [selectedAlgoId, setSelectedAlgoId] = useState<string | null>(loadSelectedAlgoId);
  const [caMintInput, setCaMintInput] = useState(loadCaMintInput);
  const [scalperLiveBuySol, setScalperLiveBuySolState] = useState(loadScalperLiveBuySol);
  const [tradingMode, setTradingModeState] = useState<TradingMode>(loadTradingMode);
  const [algoSessionActive, setAlgoSessionActive] = useState(false);
  const [tradingHalted, setTradingHalted] = useState(false);
  const [manualSellRequested, setManualSellRequested] = useState(false);
  const [scalperUserConfig, setScalperUserConfigState] = useState<ScalperUserConfig>(loadScalperUserConfig);
  const [bounceZones, setBounceZones] = useState<UserBounceZone[]>(loadBounceZones);
  const [persistedBotTrades, setPersistedBotTrades] = useState<PersistedBotTrade[]>(loadPersistedTrades);
  const [githubWorkspace, setGithubWorkspaceState] = useState(loadGithubWorkspace);
  const [openFilePath, setOpenFilePath] = useState<string | null>(null);
  const [openFileContent, setOpenFileContent] = useState<string | null>(null);
  const [workspaceFilePaths, setWorkspaceFilePaths] = useState<string[]>([]);
  const [applyEditTick, setApplyEditTick] = useState(0);
  const [lastAppliedPath, setLastAppliedPath] = useState<string | null>(null);
  const [localWorkspaceHandle, setLocalWorkspaceHandleState] = useState<FileSystemDirectoryHandle | null>(null);
  const [pendingLocalEdits, setPendingLocalEdits] = useState<Map<string, string>>(new Map());

  // Restore persisted handle on mount (requires one user permission click before use)
  useEffect(() => {
    if (!isFileSystemAccessSupported()) return;
    loadPersistedHandle().then((h) => {
      if (h) setLocalWorkspaceHandleState(h);
    }).catch(() => { /* storage unavailable */ });
  }, []);

  const connectLocalWorkspace = useCallback(async () => {
    const handle = await openLocalWorkspace();
    setLocalWorkspaceHandleState(handle);
  }, []);

  const disconnectLocalWorkspace = useCallback(() => {
    setLocalWorkspaceHandleState(null);
    setPendingLocalEdits(new Map());
    void clearPersistedHandle();
  }, []);

  // ── Persist other settings ────────────────────────────────────────
  function lsSave(key: string, value: string) {
    try { localStorage.setItem(key, value); } catch { /* QuotaExceededError — silently ignore */ }
  }

  // Chat sessions are intentionally NOT persisted — every load starts fresh.
  // Purge any stale chat data left from a previous build.
  useEffect(() => {
    try {
      localStorage.removeItem(CHAT_SESSIONS_KEY);
      localStorage.removeItem(LEGACY_MESSAGES_KEY);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    lsSave(MODEL_STORAGE_KEY, JSON.stringify(model));
  }, [model]);

  useEffect(() => {
    lsSave(USER_ALGOS_KEY, JSON.stringify(userAlgos));
  }, [userAlgos]);

  useEffect(() => {
    lsSave(TRADING_MODE_STORAGE_KEY, tradingMode);
  }, [tradingMode]);

  useEffect(() => {
    if (selectedAlgoId) lsSave(SELECTED_ALGO_KEY, selectedAlgoId);
    else localStorage.removeItem(SELECTED_ALGO_KEY);
  }, [selectedAlgoId]);

  useEffect(() => {
    if (caMintInput) lsSave(CA_MINT_KEY, caMintInput);
    else localStorage.removeItem(CA_MINT_KEY);
  }, [caMintInput]);

  useEffect(() => {
    lsSave(SCALPER_LIVE_BUY_SOL_KEY, String(scalperLiveBuySol));
  }, [scalperLiveBuySol]);

  useEffect(() => {
    lsSave(GITHUB_WORKSPACE_KEY, JSON.stringify(githubWorkspace));
  }, [githubWorkspace]);

  useEffect(() => {
    lsSave(SCALPER_USER_CONFIG_KEY, JSON.stringify(scalperUserConfig));
  }, [scalperUserConfig]);

  useEffect(() => {
    lsSave(BOUNCE_ZONES_KEY, JSON.stringify(bounceZones));
  }, [bounceZones]);

  useEffect(() => {
    lsSave(PERSISTED_TRADES_KEY, JSON.stringify(persistedBotTrades));
  }, [persistedBotTrades]);

  // ── Session helpers ───────────────────────────────────────────────
  const updateSessions = useCallback(
    (fn: (prev: ChatSession[]) => ChatSession[]) => {
      setSessionsState((s) => ({ ...s, sessions: fn(s.sessions) }));
    },
    [],
  );

  const setActiveChatId = useCallback((id: string) => {
    setSessionsState((s) => ({ ...s, activeId: id }));
  }, []);

  const newChatSession = useCallback(() => {
    setSessionsState((prev) => {
      const s = makeGreetingSession();
      s.name = `Chat ${prev.sessions.length + 1}`;
      return {
        sessions: [...prev.sessions.slice(-(MAX_SESSIONS - 1)), s],
        activeId: s.id,
      };
    });
  }, []);

  const closeChatSession = useCallback((id: string) => {
    setSessionsState((prev) => {
      const next = prev.sessions.filter((s) => s.id !== id);
      if (next.length === 0) {
        const fresh = makeGreetingSession();
        return { sessions: [fresh], activeId: fresh.id };
      }
      const activeId = prev.activeId === id ? next[next.length - 1]!.id : prev.activeId;
      return { sessions: next, activeId };
    });
  }, []);

  const renameChatSession = useCallback((id: string, name: string) => {
    updateSessions((ss) => ss.map((s) => (s.id === id ? { ...s, name: name.slice(0, 36) } : s)));
  }, [updateSessions]);

  const setSessionModel = useCallback((id: string, patch: Partial<ModelSettings>) => {
    updateSessions((ss) =>
      ss.map((s) =>
        s.id === id
          ? { ...s, modelOverride: { ...s.modelOverride, ...patch } }
          : s,
      ),
    );
  }, [updateSessions]);

  const clearSessionModel = useCallback((id: string) => {
    updateSessions((ss) =>
      ss.map((s) => (s.id === id ? { ...s, modelOverride: undefined } : s)),
    );
  }, [updateSessions]);

  // ── Active session messages ───────────────────────────────────────
  const messages = useMemo(
    () => chatSessions.find((s) => s.id === activeChatId)?.messages ?? [],
    [chatSessions, activeChatId],
  );

  const appendMessage = useCallback(
    (m: Omit<ChatMessage, "id" | "createdAt">): string => {
      const id = crypto.randomUUID();
      const full: ChatMessage = { ...m, id, createdAt: Date.now() };
      updateSessions((ss) =>
        ss.map((s) => {
          if (s.id !== activeChatId) return s;
          const newMessages = [...s.messages, full].slice(-MAX_STORED_MESSAGES);
          // Auto-name session from first user message
          const name =
            s.name.startsWith("Chat ") && m.role === "user" && s.messages.filter((x) => x.role === "user").length === 0
              ? m.content.slice(0, 36).replace(/\n/g, " ") || s.name
              : s.name;
          return { ...s, name, messages: newMessages };
        }),
      );
      return id;
    },
    [activeChatId, updateSessions],
  );

  const updateMessage = useCallback(
    (id: string, patch: Partial<Pick<ChatMessage, "content">>) => {
      updateSessions((ss) =>
        ss.map((s) =>
          s.id !== activeChatId
            ? s
            : {
                ...s,
                messages: s.messages.map((msg) =>
                  msg.id === id ? { ...msg, ...patch } : msg,
                ),
              },
        ),
      );
    },
    [activeChatId, updateSessions],
  );

  const clearChat = useCallback(() => {
    updateSessions((ss) =>
      ss.map((s) =>
        s.id === activeChatId
          ? { ...s, messages: [createAssistantGreetingMessage()] }
          : s,
      ),
    );
  }, [activeChatId, updateSessions]);

  // ── Other setters ─────────────────────────────────────────────────
  const openSetupPanel = useCallback(() => {
    setSidebarOpen(true);
    setSidebarMode("models");
    setActivitySection("models");
  }, []);

  const navigateChartToMint = useCallback((mint: string) => {
    const m = mint.trim();
    if (!m) return;
    setCaMintInput(m);
    setSidebarOpen(true);
    setSidebarMode("analytics");
    setActivitySection("analytics");
  }, []);

  const setModel = useCallback((patch: Partial<ModelSettings>) => {
    setModelState((m) => ({ ...m, ...patch }));
  }, []);

  const setOpenFile = useCallback((path: string | null, content: string | null) => {
    setOpenFilePath(path);
    setOpenFileContent(content);
  }, []);

  const setGithubWorkspace = useCallback((patch: Partial<GitHubWorkspaceSettings>) => {
    setGithubWorkspaceState((prev) => ({ ...prev, ...patch }));
  }, []);

  const applyFileEdit = useCallback(
    async (path: string, code: string, commitMessage?: string): Promise<string> => {
      // ── Local-first path (instant HMR) ────────────────────────────
      if (localWorkspaceHandle) {
        const granted = await requestPermission(localWorkspaceHandle);
        if (!granted) throw new Error("Local workspace permission denied — re-connect in Setup.");
        await writeLocalFile(localWorkspaceHandle, path, code);
        // Queue the edit so the user can push to GitHub later in one batch
        setPendingLocalEdits((prev) => {
          const next = new Map(prev);
          next.set(path, code);
          return next;
        });
        setLastAppliedPath(path);
        setApplyEditTick((t) => t + 1);
        return ""; // no commit SHA yet — file is local only
      }

      // ── GitHub fallback ───────────────────────────────────────────
      const { token, owner, repo, branch } = githubWorkspace;
      if (!token.trim() || !owner.trim() || !repo.trim()) {
        throw new Error("Connect your GitHub repo in Setup (or connect a local workspace folder for instant edits).");
      }
      const br = branch.trim() || "main";

      let existingSha: string | undefined;
      try {
        const { sha } = await githubGetFileContent(token, owner, repo, br, path);
        existingSha = sha;
      } catch {
        existingSha = undefined;
      }

      const { commitSha } = await githubPutFileContent({
        token,
        owner,
        repo,
        branch: br,
        path,
        message: commitMessage ?? `${existingSha ? "Edit" : "Create"} ${path} via chat`,
        contentUtf8: code,
        sha: existingSha,
      });

      setLastAppliedPath(path);
      setApplyEditTick((t) => t + 1);
      return commitSha;
    },
    [githubWorkspace, localWorkspaceHandle],
  );

  const pushPendingToGitHub = useCallback(async () => {
    const { token, owner, repo, branch } = githubWorkspace;
    if (!token.trim() || !owner.trim() || !repo.trim()) {
      throw new Error("Connect your GitHub repo in Setup first (PAT + Fork & connect).");
    }
    const br = branch.trim() || "main";
    const edits = Array.from(pendingLocalEdits.entries());
    for (const [path, code] of edits) {
      let existingSha: string | undefined;
      try {
        const { sha } = await githubGetFileContent(token, owner, repo, br, path);
        existingSha = sha;
      } catch {
        existingSha = undefined;
      }
      await githubPutFileContent({
        token,
        owner,
        repo,
        branch: br,
        path,
        message: `Edit ${path} via chat`,
        contentUtf8: code,
        sha: existingSha,
      });
    }
    setPendingLocalEdits(new Map());
  }, [githubWorkspace, pendingLocalEdits]);

  const setTradingMode = useCallback((m: TradingMode) => {
    setTradingModeState(m);
  }, []);

  const setScalperLiveBuySol = useCallback((v: number) => {
    setScalperLiveBuySolState(clampScalperLiveBuySol(v));
  }, []);

  const setScalperUserConfig = useCallback((patch: Partial<ScalperUserConfig>) => {
    setScalperUserConfigState((prev) => ({ ...prev, ...patch }));
  }, []);

  const [bounceSuggestionTick, setBounceSuggestionTick] = useState(0);
  const refreshSuggestedBounceZones = useCallback(() => {
    setBounceSuggestionTick((n) => n + 1);
  }, []);
  const [floorCandlesStatus, setFloorCandlesStatus] = useState<"idle" | "loading" | "ready">("idle");

  const setDetectedZones = useCallback((mint: string, zones: BounceZone[]) => {
    setBounceZones((prev) => {
      // Manual zones have no `sources` field; auto zones always have sources set.
      const manual = prev.filter((z) => z.mint === mint && z.sources == null);
      const other = prev.filter((z) => z.mint !== mint);
      const fresh: UserBounceZone[] = zones.map((z) => ({
        id: `auto-${mint}-${z.price.toFixed(6)}`,
        mint,
        price: z.price,
        touches: z.touches,
        enabled: true,
        strength: z.strength,
        sources: (z as { sources?: string }).sources,
      }));
      return [...other, ...manual, ...fresh];
    });
  }, []);

  const toggleBounceZone = useCallback((id: string) => {
    setBounceZones((prev) => prev.map((z) => z.id === id ? { ...z, enabled: !z.enabled } : z));
  }, []);

  /**
   * Clamp a proposed bounce-zone price so it can never be at or above 93 % of the
   * live chart close (i.e. must be at least 7 % below current price).
   * If no live price is available the value passes through unchanged.
   */
  const clampBouncePrice = useCallback((price: number): number => {
    const liveClose = chartAnalytics.lastCandle?.close;
    if (liveClose != null && liveClose > 0) {
      return Math.min(price, liveClose * 0.93);
    }
    return price;
  }, [chartAnalytics.lastCandle]);

  const updateBounceZonePrice = useCallback((id: string, price: number) => {
    if (!Number.isFinite(price) || price <= 0) return;
    const safe = clampBouncePrice(price);
    setBounceZones((prev) => prev.map((z) => z.id === id ? { ...z, price: safe } : z));
  }, [clampBouncePrice]);

  const addBounceZone = useCallback((mint: string, price: number) => {
    if (!Number.isFinite(price) || price <= 0) return;
    const safe = clampBouncePrice(price);
    const zone: UserBounceZone = {
      id: `manual-${mint}-${Date.now()}`,
      mint,
      price: safe,
      touches: 0,
      enabled: true,
      strength: 0,
    };
    setBounceZones((prev) => [...prev, zone]);
  }, [clampBouncePrice]);

  const removeBounceZone = useCallback((id: string) => {
    setBounceZones((prev) => prev.filter((z) => z.id !== id));
  }, []);

  const hardStopTrading = useCallback(() => {
    setTradingHalted(true);
    setAlgoSessionActive(false);
  }, []);

  const requestManualSell = useCallback(() => {
    setManualSellRequested(true);
  }, []);

  const clearManualSellRequest = useCallback(() => {
    setManualSellRequested(false);
  }, []);

  const appendPersistedTrades = useCallback((trades: PersistedBotTrade[]) => {
    if (trades.length === 0) return;
    setPersistedBotTrades((prev) => {
      const existingIds = new Set(prev.map((t) => t.id));
      const fresh = trades.filter((t) => !existingIds.has(t.id));
      if (fresh.length === 0) return prev;
      const next = [...prev, ...fresh];
      // Drop oldest if over cap
      return next.length > MAX_PERSISTED_TRADES ? next.slice(next.length - MAX_PERSISTED_TRADES) : next;
    });
  }, []);

  const clearPersistedTrades = useCallback(() => {
    setPersistedBotTrades([]);
  }, []);

  const setChartAnalytics = useCallback((patch: Partial<ChartAnalyticsState>) => {
    setChartAnalyticsState((prev) => ({ ...prev, ...patch }));
  }, []);

  const addUserAlgo = useCallback((name: string, description: string) => {
    const trimmedName = name.trim();
    if (!trimmedName) return;
    const next: UserAlgoPreset = {
      id: crypto.randomUUID(),
      name: trimmedName,
      description: description.trim() || "No description",
      createdAt: Date.now(),
    };
    setUserAlgos((prev) => [next, ...prev]);
    setSelectedAlgoId(next.id);
  }, []);

  const removeUserAlgo = useCallback((id: string) => {
    setUserAlgos((prev) => prev.filter((a) => a.id !== id));
    setSelectedAlgoId((cur) => (cur === id ? null : cur));
  }, []);

  const value = useMemo(
    () => ({
      model,
      setModel,
      chatSessions,
      activeChatId,
      setActiveChatId,
      newChatSession,
      closeChatSession,
      renameChatSession,
      setSessionModel,
      clearSessionModel,
      messages,
      appendMessage,
      updateMessage,
      clearChat,
      openSetupPanel,
      navigateChartToMint,
      chartAnalytics,
      setChartAnalytics,
      composerBusy,
      setComposerBusy,
      sidebarMode,
      setSidebarMode,
      sidebarOpen,
      setSidebarOpen,
      activitySection,
      setActivitySection,
      userAlgos,
      addUserAlgo,
      removeUserAlgo,
      selectedAlgoId,
      setSelectedAlgoId,
      caMintInput,
      setCaMintInput,
      scalperLiveBuySol,
      setScalperLiveBuySol,
      tradingMode,
      setTradingMode,
      algoSessionActive,
      setAlgoSessionActive,
      tradingHalted,
      setTradingHalted,
      hardStopTrading,
      manualSellRequested,
      requestManualSell,
      clearManualSellRequest,
      scalperUserConfig,
      setScalperUserConfig,
      bounceZones,
      setDetectedZones,
      bounceSuggestionTick,
      refreshSuggestedBounceZones,
      floorCandlesStatus,
      setFloorCandlesStatus,
      toggleBounceZone,
      updateBounceZonePrice,
      addBounceZone,
      removeBounceZone,
      persistedBotTrades,
      appendPersistedTrades,
      clearPersistedTrades,
      githubWorkspace,
      setGithubWorkspace,
      openFilePath,
      openFileContent,
      setOpenFile,
      workspaceFilePaths,
      setWorkspaceFilePaths,
      applyEditTick,
      lastAppliedPath,
      applyFileEdit,
      localWorkspaceHandle,
      connectLocalWorkspace,
      disconnectLocalWorkspace,
      pendingLocalEdits,
      pushPendingToGitHub,
    }),
    [
      model, setModel,
      chatSessions, activeChatId, setActiveChatId, newChatSession, closeChatSession,
      renameChatSession, setSessionModel, clearSessionModel,
      messages, appendMessage, updateMessage, clearChat, openSetupPanel, navigateChartToMint,
      chartAnalytics, setChartAnalytics,
      composerBusy,
      sidebarMode, sidebarOpen, activitySection,
      userAlgos, addUserAlgo, removeUserAlgo, selectedAlgoId,
      caMintInput, scalperLiveBuySol, tradingMode, algoSessionActive, tradingHalted,
      manualSellRequested, requestManualSell, clearManualSellRequest,
      scalperUserConfig, setScalperUserConfig,
      bounceZones, setDetectedZones, bounceSuggestionTick, refreshSuggestedBounceZones,
      floorCandlesStatus, setFloorCandlesStatus,
      toggleBounceZone, updateBounceZonePrice, addBounceZone, removeBounceZone,
      persistedBotTrades, appendPersistedTrades, clearPersistedTrades,
      githubWorkspace, setGithubWorkspace,
      openFilePath, openFileContent, setOpenFile,
      workspaceFilePaths, setWorkspaceFilePaths,
      applyEditTick, lastAppliedPath, applyFileEdit,
      localWorkspaceHandle, connectLocalWorkspace, disconnectLocalWorkspace,
      pendingLocalEdits, pushPendingToGitHub,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useApp requires AppProvider");
  return v;
}
