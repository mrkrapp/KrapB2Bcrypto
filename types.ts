
export interface Candle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  takerBuyVolume: number; // Essential for Volume Delta
  isClosed?: boolean;
  
  // Enriched Metrics (Calculated)
  delta?: number;
  cvd?: number;
  vwap?: number;
  vwapStd?: number; // Standard Deviation for bands
  
  // Semantic Signals
  divergence?: 'bullish' | 'bearish' | null;
}

export interface ProfileLevel {
  price: number;
  volume: number;
  bidVol?: number; // Optional split
  askVol?: number; // Optional split
}

export interface ProfileMetrics {
  levels: ProfileLevel[];
  poc: number; // Point of Control Price
  vah: number; // Value Area High
  val: number; // Value Area Low
  totalVolume: number;
  sessionHigh: number;
  sessionLow: number;
}

export interface SessionConfig {
  symbol: string;
  startTime: string; // HH:mm format (UTC)
  endTime: string;   // HH:mm format (UTC)
  tickSize: number;
}

export interface SessionLevels {
  ibHigh: number | null; // Initial Balance High
  ibLow: number | null;  // Initial Balance Low
  vwap: number | null;
  sessionHigh: number;
  sessionLow: number;
}

export type AuctionMode = 
  | 'BALANCED' 
  | 'ROTATIONAL' 
  | 'INITIATIVE_BUY' 
  | 'INITIATIVE_SELL' 
  | 'FAILED_AUCTION_HIGH'
  | 'FAILED_AUCTION_LOW';

export interface AuctionContext {
  mode: AuctionMode;
  confidence: number; // 0-100
  scenario: string;   // "Acceptance likely, targeting VAH"
  bias: 'neutral' | 'bullish' | 'bearish';
}

export type CVDState = 'NEUTRAL' | 'ACCUMULATION' | 'DISTRIBUTION' | 'EXPANSION_UP' | 'EXPANSION_DOWN' | 'ABSORPTION';

export type SignalType = 'NONE' | 'AGG_BUY' | 'AGG_SELL' | 'ABSORPTION' | 'ICEBERG' | 'VACUUM' | 'SQUEEZE';

export type ContextTag = 
  | 'IN_BALANCE' 
  | 'TESTING_HIGH' 
  | 'TESTING_LOW' 
  | 'BREAKOUT' 
  | 'BREAKDOWN' 
  | 'AT_VWAP' 
  | 'OVEREXTENDED';

export type SymbolStatus = 'DISCOVERED' | 'INITIALIZING' | 'WARMING_UP' | 'ACTIVE';

export interface ScreenerRow {
  symbol: string;
  price: number;
  
  // Lifecycle Status
  status: SymbolStatus;

  // Base 24h Stats (from Ticker)
  chg24h: number; 
  vol24h: number; 
  
  // Dynamic Timeframe Stats
  tfChange: number; // Change % for selected timeframe
  tfVolume: number; // Volume for selected timeframe
  
  // Pro Metrics (The Radar)
  attentionScore: number; // 0-100 Aggregate Heat
  volZScore: number; // Volume Anomaly (> 2.0 is anomaly)
  delta1m: number; // Net CVD 1m
  deltaZScore: number; // Delta Anomaly
  ofSignal: SignalType;
  signalConfidence: number; // 0-100
  
  // New Semantic Context Fields
  contextTag: ContextTag;
  activeDuration: number; // Minutes the signal/context has been active
  auctionStateHint: string; // Short text for "Price Discovery" etc.
  
  // Context
  fundingRate: number; 
  fundingZScore: number;
  
  // Mini Chart Data (Last 20 points)
  sparkline: number[]; 
  
  // Legacy fields compatibility
  weekChange: number; 
  netInflow: number; 
  trendStrength: number; 
}

export interface OrderBlock {
  id: string;
  type: 'bullish' | 'bearish';
  top: number;
  bottom: number;
  start: number; // timestamp
  mitigated: boolean;
  strength: number; // 0-100 confidence based on reaction
  status: 'FRESH' | 'TESTED' | 'FAILING';
}

export interface DrawingLine {
  id: string;
  x1: number; // timestamp
  y1: number; // price
  x2: number; // timestamp
  y2: number; // price
  color: string;
}

export type SortDirection = 'asc' | 'desc';

export interface SortConfig {
  key: keyof ScreenerRow;
  direction: SortDirection;
}

export type Timeframe = '5m' | '15m' | '1h' | '4h' | '1d';
export type ScreenerTimeframe = '1m' | '5m' | '15m' | '30m' | '1h' | '2h' | '4h';

export enum ConnectionStatus {
  DISCONNECTED = 'Disconnected',
  CONNECTING = 'Connecting',
  CONNECTED = 'Connected',
  ERROR = 'Error',
}

// --- Order Flow Types ---

export interface Trade {
  id: number;
  price: number;
  qty: number;
  time: number;
  isBuyerMaker: boolean; // true = Sell, false = Buy
  isLarge: boolean;
}

export interface OrderBookLevel {
  price: number;
  qty: number;
  total: number; // Cumulative or simply total at level
  depthRatio: number; // 0 to 1 for heatmap/bar
}

// Extended interface for Analytics
export interface EnrichedLevel extends OrderBookLevel {
  type: 'bid' | 'ask';
  cumulativeQty: number;
  deltaQty: number; // Change in liquidity since last snapshot
  tradeVol: number; // Volume executed at this price in current frame
  absorption: number; // Calculated absorption score
  isIceberg: boolean;
  icebergVol: number;
  isSpoof: boolean; // Detected liquidity pull
  age: number; // How many snapshots this level has persisted > threshold
}

export interface OrderFlowState {
  trades: Trade[];
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  price: number;
}

// --- Persistent Event Engine Types (v5.0) ---

export type PersistentEventType = 'ICE' | 'ABSORPTION' | 'STACK' | 'PULL' | 'FAIL';
export type PersistenceWindow = 15 | 30 | 60 | 'SESSION';

// v5.0 State Machine
export type EventState = 'NEUTRAL' | 'STACK' | 'ABSORPTION' | 'HOLDING' | 'WEAKENING' | 'FAIL' | 'BROKEN';

export interface PersistentEvent {
  id: string;
  type: PersistentEventType;
  price: number;
  side: 'bid' | 'ask';
  
  // State Machine
  state: EventState;
  
  // Timing
  firstDetected: number;
  lastConfirmed: number;
  failTime?: number; // When the FAIL was triggered
  
  // Metrics
  volume: number; // Current volume
  peakVolume: number; // Highest volume seen (for REM drop calc)
  strength: number; // 0-100 Score
  confirmations: number; 
  failedPushes: number; // How many times price tested and bounced
  
  // Fail Analysis
  failConfidence: number; // 0-100, must be > 70 to show
  remDropRatio?: number; // % drop in liquidity before fail
  
  // State booleans (deprecated but kept for compat, prefer 'state')
  isActive: boolean; 
  isRetest: boolean; 
  isFailed: boolean;
}

// --- Smart Grouping Types (v4.1) ---

export type NoiseFilterLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'AUTO';

export interface SmartGroupingConfig {
  priceGroup: number; // $5, $10 etc
  timeWindow: number; // ms
  noiseFilter: NoiseFilterLevel;
  minLifetime: number; // ms, to avoid spoofs
  adaptive: boolean; // If true, priceGroup adjusts to volatility
}
