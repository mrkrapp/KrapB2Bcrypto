

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { 
  Settings, RefreshCw, Activity, Calendar, TrendingUp, 
  Radio, LayoutDashboard, SlidersHorizontal, ChevronDown,
  Zap, Clock, Layers, History, Maximize2, Minimize2, Eye, EyeOff, BarChart2, BoxSelect,
  ArrowRightLeft
} from 'lucide-react';
import { 
  fetchDailyCandles, subscribeToTicker, 
  fetchTopSymbols, fetchScreenerMetrics, subscribeToAllMarketTicker 
} from './services/marketData';
import { calculateProfile, isInSession, findOrderBlocks } from './utils/analytics';
import { calculateAttentionScore, calculateZScore, detectSignal, generateSparkline } from './utils/screenerUtils';
import ProfileChart from './components/ProfileChart';
import MarketScreener from './components/MarketScreener';
import HFTEngine from './components/HFTEngine'; 
import OrderFlowDashboard from './components/OrderFlowDashboard';
import { SessionIntelligence } from './components/SessionIntelligence';
import { Candle, SessionConfig, ConnectionStatus, ProfileMetrics, ScreenerRow, Timeframe, ScreenerTimeframe, OrderBlock, SignalType } from './types';

// Initial Config
const DEFAULT_CONFIG: SessionConfig = {
  symbol: 'BTCUSDT',
  startTime: '00:00', // UTC
  endTime: '23:59',   // UTC
  tickSize: 10.0,
};

type ViewMode = 'screener' | 'hft' | 'orderflow';

export default function App() {
  const [config, setConfig] = useState<SessionConfig>(DEFAULT_CONFIG);
  const [status, setStatus] = useState<ConnectionStatus>(ConnectionStatus.DISCONNECTED);
  const [candles, setCandles] = useState<Candle[]>([]);
  const [filteredCandles, setFilteredCandles] = useState<Candle[]>([]);
  const [metrics, setMetrics] = useState<ProfileMetrics | null>(null);
  
  // Analytics
  const [orderBlocks, setOrderBlocks] = useState<OrderBlock[]>([]);
  
  // Timeframe State for CHART
  const [timeframe, setTimeframe] = useState<Timeframe>('15m');

  // Timeframe State for SCREENER COLUMNS
  const [screenerTimeframe, setScreenerTimeframe] = useState<ScreenerTimeframe>('15m');
  
  // View Mode State
  const [viewMode, setViewMode] = useState<ViewMode>('screener');

  // Screener State
  // We use a Map or Set to track known symbols to prevent duplicates/overwrites
  const knownSymbolsRef = useRef<Set<string>>(new Set());
  const [screenerData, setScreenerData] = useState<ScreenerRow[]>([]);
  
  // Favorites State (Watchlist)
  const [favorites, setFavorites] = useState<Set<string>>(new Set(['BTCUSDT', 'ETHUSDT']));

  // Signal Persistence Tracking
  const signalStartMap = useRef<Map<string, { type: SignalType, startTime: number }>>(new Map());

  // Chart UI State
  const [isChartFullscreen, setIsChartFullscreen] = useState(false);
  const [chartIndicators, setChartIndicators] = useState({
    volume: true,
    orderBlocks: true
  });
  
  // Buffering Ref for Screener Updates (Optimized Rendering)
  const screenerUpdateBuffer = useRef<Map<string, { price: number; chg24h: number; vol24h: number }>>(new Map());

  // Date Selection State (YYYY-MM-DD)
  const [selectedDate, setSelectedDate] = useState<string>(() => {
    return new Date().toISOString().split('T')[0];
  });

  const [isLongTermMode, setIsLongTermMode] = useState(false);
  const [dimensions, setDimensions] = useState({ width: 1000, height: 500 });
  const [showSettings, setShowSettings] = useState(true);

  // --- Pipeline: Data Enrichment Logic ---
  // Caps confidence/score if the symbol is not yet ACTIVE
  const enrichRowData = useCallback((row: ScreenerRow): ScreenerRow => {
      // 1. Calculate Z-Scores
      const volMean = row.vol24h / 1440; 
      const volZ = calculateZScore(row.tfVolume, volMean, volMean * 0.5); 
      
      const fundingMean = 0.01; 
      const fundingZ = calculateZScore(row.fundingRate * 100, fundingMean, 0.01);

      // 2. Simulate Delta 
      const delta1m = row.vol24h * 0.0001 * (row.tfChange > 0 ? 1 : -1) * Math.random() * 5; 

      // 3. Detect Signals
      const { type, confidence } = detectSignal(row.tfChange, volZ, delta1m, row.trendStrength);

      // 4. Persistence Tracking (Signal Duration)
      const now = Date.now();
      let duration = 0;
      const existing = signalStartMap.current.get(row.symbol);
      
      if (type !== 'NONE') {
          if (existing && existing.type === type) {
              duration = Math.floor((now - existing.startTime) / 60000); // Minutes
          } else {
              // New Signal Start
              signalStartMap.current.set(row.symbol, { type, startTime: now });
              duration = 0; // Fresh
          }
      } else {
          // No signal, clear history
          if (existing) signalStartMap.current.delete(row.symbol);
      }
      
      // Override for Demo purposes (random duration if 0 to show UI)
      if (type !== 'NONE' && duration === 0) duration = Math.floor(Math.random() * 10); 

      // 5. Calculate Attention Score
      let attention = calculateAttentionScore(volZ, row.tfChange, row.fundingRate, 0, type !== 'NONE');

      // --- WARM UP DAMPENING ---
      let effectiveConfidence = confidence;
      
      if (row.status === 'WARMING_UP') {
          // Cap metrics for warming symbols to avoid noise
          attention = Math.min(attention, 40); 
          effectiveConfidence = Math.min(confidence, 50);
      } else if (row.status === 'INITIALIZING') {
          attention = 0;
          effectiveConfidence = 0;
      }

      return {
          ...row,
          volZScore: volZ,
          fundingZScore: fundingZ,
          delta1m: delta1m,
          deltaZScore: 0,
          ofSignal: type,
          signalConfidence: effectiveConfidence,
          activeDuration: duration,
          attentionScore: attention,
          sparkline: row.sparkline.length > 0 ? row.sparkline : generateSparkline(row.price, 0.005)
      };
  }, []);

  // --- Pipeline: Discovery & Onboarding ---
  const discoverAndOnboard = useCallback(async () => {
      // 1. Discover: Fetch Top Liquid Symbols
      const topSymbols = await fetchTopSymbols(100);
      
      // 2. Filter: Find New Candidates
      const newCandidates = topSymbols.filter(s => !knownSymbolsRef.current.has(s));
      
      if (newCandidates.length === 0) return;

      console.log(`Pipeline: Discovered ${newCandidates.length} new symbols.`);

      // 3. Initialize: Add to state immediately as INITIALIZING
      // This prevents double-fetching if the hook runs again quickly
      newCandidates.forEach(s => knownSymbolsRef.current.add(s));

      const newRowsPlaceholder: ScreenerRow[] = newCandidates.map(s => ({
          symbol: s,
          price: 0, status: 'INITIALIZING',
          chg24h: 0, vol24h: 0, tfChange: 0, tfVolume: 0,
          attentionScore: 0, volZScore: 0, delta1m: 0, deltaZScore: 0,
          ofSignal: 'NONE', signalConfidence: 0,
          contextTag: 'IN_BALANCE', activeDuration: 0, auctionStateHint: 'Initializing...',
          fundingRate: 0, fundingZScore: 0, sparkline: [],
          weekChange: 0, netInflow: 0, trendStrength: 0
      }));

      // Update State: Add Placeholders
      setScreenerData(prev => [...prev, ...newRowsPlaceholder]);

      // 4. Warm Up: Fetch Metrics for NEW symbols only
      // We don't want to re-fetch existing 'ACTIVE' symbols here, they are live via WebSocket
      const freshMetrics = await fetchScreenerMetrics(newCandidates, screenerTimeframe);

      setScreenerData(prev => {
          return prev.map(row => {
              const metricData = freshMetrics.find(m => m.symbol === row.symbol);
              
              // If we found metrics for an INITIALIZING symbol, upgrade it to WARMING_UP
              if (row.status === 'INITIALIZING' && metricData) {
                  const merged = { ...row, ...metricData, status: 'WARMING_UP' as const };
                  return enrichRowData(merged);
              }
              return row;
          });
      });

      // 5. Activate: After a short delay, flip WARMING_UP to ACTIVE
      // In a real app, this might wait for 5-10 websocket ticks. Here we use a timer.
      setTimeout(() => {
          setScreenerData(prev => 
              prev.map(row => {
                  if (newCandidates.includes(row.symbol) && row.status === 'WARMING_UP') {
                      return { ...row, status: 'ACTIVE' };
                  }
                  return row;
              })
          );
      }, 5000); // 5 second warm-up

  }, [screenerTimeframe, enrichRowData]);


  // --- Initialization Effect ---
  useEffect(() => {
    discoverAndOnboard();

    // Polling for new symbols every 60s
    const discoveryInterval = setInterval(discoverAndOnboard, 60000);
    return () => clearInterval(discoveryInterval);
  }, [discoverAndOnboard]);


  // --- Re-fetch Metrics on Timeframe Change (Only for Active/Warming) ---
  useEffect(() => {
     if (knownSymbolsRef.current.size === 0) return;
     
     const refreshMetrics = async () => {
        const symbolsToRefresh = Array.from(knownSymbolsRef.current) as string[];
        const freshMetrics = await fetchScreenerMetrics(symbolsToRefresh, screenerTimeframe);
        
        setScreenerData(prev => {
           return prev.map(existingRow => {
             const fresh = freshMetrics.find(f => f.symbol === existingRow.symbol);
             if (fresh) {
                 const enriched = enrichRowData(fresh);
                 // Preserve status unless it was somehow lost
                 return {
                     ...enriched,
                     status: existingRow.status, 
                     price: existingRow.price, // Keep live price if available
                     chg24h: existingRow.chg24h,
                     vol24h: existingRow.vol24h
                 };
             }
             return existingRow;
           });
        });
     };
     refreshMetrics();
  }, [screenerTimeframe, enrichRowData]); // Re-run when TF changes

  // --- Real-time Updates ---
  useEffect(() => {
    // Subscribe to ALL market tickers. 
    // This pushes data for all symbols, but we only update rows that exist in our state.
    const unsubscribe = subscribeToAllMarketTicker((updateMap) => {
      updateMap.forEach((val, key) => {
         screenerUpdateBuffer.current.set(key, val);
      });
    });

    const flushInterval = setInterval(() => {
       if (screenerUpdateBuffer.current.size > 0) {
          const updates: Map<string, { price: number; chg24h: number; vol24h: number }> = new Map(screenerUpdateBuffer.current);
          screenerUpdateBuffer.current.clear();
          
          setScreenerData((prevRows) => {
             return prevRows.map(row => {
                const update = updates.get(row.symbol);
                if (update) {
                   // Update live data regardless of status (even warming symbols need price)
                   return {
                      ...row,
                      price: update.price,
                      chg24h: update.chg24h,
                      vol24h: update.vol24h
                   };
                }
                return row;
             });
          });
       }
    }, 500);

    return () => {
      unsubscribe();
      clearInterval(flushInterval);
    };
  }, []); // Run once on mount

  // --- Layout Resize ---
  useEffect(() => {
    const handleResize = () => {
      if (isChartFullscreen) {
          setDimensions({ width: window.innerWidth, height: window.innerHeight - 80 });
      } else {
          // Full width minus padding
          setDimensions({ width: Math.min(window.innerWidth - 48, 1600), height: 500 });
      }
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [isChartFullscreen]);

  const isLive = useMemo(() => {
    const today = new Date().toISOString().split('T')[0];
    return selectedDate === today;
  }, [selectedDate]);

  // --- Chart Data Loading (Existing Logic) ---
  useEffect(() => {
    if (viewMode === 'orderflow' || viewMode === 'hft') return;
    let unsubscribe: (() => void) | null = null;
    let isActive = true;

    const loadData = async () => {
      setStatus(ConnectionStatus.CONNECTING);
      setCandles([]);

      let startTimestamp: number;
      const now = Date.now();
      
      if (isLongTermMode) {
          const threeYearsAgo = new Date();
          threeYearsAgo.setFullYear(threeYearsAgo.getFullYear() - 3);
          startTimestamp = threeYearsAgo.getTime();
      } else {
          startTimestamp = new Date(`${selectedDate}T00:00:00Z`).getTime();
      }

      const endOfDay = new Date(`${selectedDate}T23:59:59.999Z`).getTime();
      const fetchEnd = (isLive || isLongTermMode) ? now : endOfDay;

      try {
        const history = await fetchDailyCandles(config.symbol, startTimestamp, fetchEnd, timeframe);
        if (isActive) {
          setCandles(history);
          if (!isLive && !isLongTermMode) setStatus(ConnectionStatus.DISCONNECTED);
        }
      } catch (e) {
        if (isActive) setStatus(ConnectionStatus.ERROR);
      }

      if (isLive && isActive && !isLongTermMode) {
        unsubscribe = subscribeToTicker(config.symbol, (newCandle) => {
            setCandles((prev) => {
              const last = prev[prev.length - 1];
              if (last && last.timestamp === newCandle.timestamp) {
                const updated = [...prev];
                updated[updated.length - 1] = newCandle;
                return updated;
              } else if (!last || newCandle.timestamp > last.timestamp) {
                 return [...prev, newCandle];
              }
              return prev;
            });
          }, setStatus, timeframe);
      }
    };

    loadData();
    return () => { isActive = false; if (unsubscribe) unsubscribe(); };
  }, [config.symbol, selectedDate, isLive, timeframe, isLongTermMode, viewMode]);

  // --- Analytics Calculation ---
  useEffect(() => {
    if (candles.length === 0) {
      setMetrics(null);
      setOrderBlocks([]);
      return;
    }
    const blocks = findOrderBlocks(candles);
    setOrderBlocks(blocks);

    let targetCandles = candles;
    if (!isLongTermMode) {
        targetCandles = candles.filter((c) => isInSession(c.timestamp, config.startTime, config.endTime));
    }
    setFilteredCandles(targetCandles);
    
    let usedTickSize = config.tickSize;
    if (isLongTermMode) usedTickSize = config.tickSize * 10;
    const profile = calculateProfile(targetCandles, usedTickSize);
    setMetrics(profile);
  }, [candles, config, isLongTermMode]);

  const handleConfigChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setConfig((prev) => ({ ...prev, [name]: name === 'tickSize' ? parseFloat(value) : value }));
  };

  const handleSymbolSelect = (symbol: string) => {
    setConfig(prev => ({ ...prev, symbol }));
    if (!isChartFullscreen) window.scrollTo({ top: 0, behavior: 'smooth' });
    const row = screenerData.find(r => r.symbol === symbol);
    if (row) {
      let tick = 1.0;
      if (row.price < 0.1) tick = 0.0001;
      else if (row.price < 1) tick = 0.001;
      else if (row.price < 10) tick = 0.01;
      else if (row.price < 100) tick = 0.1;
      else if (row.price < 1000) tick = 0.5;
      else tick = 10.0;
      setConfig(prev => ({ ...prev, symbol, tickSize: tick }));
    }
  };

  const toggleFavorite = (symbol: string) => {
    setFavorites(prev => {
      const next = new Set(prev);
      if (next.has(symbol)) next.delete(symbol); else next.add(symbol);
      return next;
    });
  };

  const chartTimeframes: Timeframe[] = ['5m', '15m', '1h', '4h', '1d'];
  const screenerTimeframes: ScreenerTimeframe[] = ['1m', '5m', '15m', '30m', '1h', '2h', '4h'];

  return (
    <div className={`min-h-screen font-sans bg-[#0d1117] text-gray-200 selection:bg-blue-500/30 ${isChartFullscreen ? 'overflow-hidden' : ''}`}>
      
      {/* Header Bar */}
      {!isChartFullscreen && (
        <header className="sticky top-0 z-30 bg-[#0d1117]/80 backdrop-blur-md border-b border-gray-800 px-6 py-4 flex flex-col md:flex-row justify-between items-center gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-600/20 rounded-lg">
              <LayoutDashboard className="text-blue-500" size={24} />
            </div>
            <div>
              <h1 className="text-lg font-bold text-white leading-tight">Pro Terminal</h1>
              <p className="text-gray-500 text-[11px] font-mono uppercase tracking-wider">Real-time Analytics</p>
            </div>
          </div>
          
          <div className="flex bg-gray-900 rounded-lg p-1 border border-gray-800">
            <button onClick={() => setViewMode('screener')} className={`flex items-center gap-2 px-4 py-1.5 rounded-md text-xs font-bold transition-all ${viewMode === 'screener' ? 'bg-gray-700 text-white shadow-sm' : 'text-gray-500 hover:text-gray-300'}`}><LayoutDashboard size={14} /> Radar</button>
            <button onClick={() => setViewMode('hft')} className={`flex items-center gap-2 px-4 py-1.5 rounded-md text-xs font-bold transition-all ${viewMode === 'hft' ? 'bg-gray-700 text-white shadow-sm' : 'text-gray-500 hover:text-gray-300'}`}><Zap size={14} /> HFT Engine</button>
            <button onClick={() => setViewMode('orderflow')} className={`flex items-center gap-2 px-4 py-1.5 rounded-md text-xs font-bold transition-all ${viewMode === 'orderflow' ? 'bg-gray-700 text-white shadow-sm' : 'text-gray-500 hover:text-gray-300'}`}><ArrowRightLeft size={14} /> Order Flow</button>
          </div>
          
          <div className="flex items-center gap-4">
              <div className={`px-3 py-1.5 rounded-full border flex items-center gap-2 text-[10px] font-bold uppercase tracking-wide transition-all ${isLive ? 'bg-green-900/10 border-green-800 text-green-400 shadow-[0_0_10px_rgba(34,197,94,0.1)]' : 'bg-yellow-900/10 border-yellow-800 text-yellow-400'}`}>
                  {isLive ? <Radio size={12} className={isLive ? "animate-pulse" : ""} /> : <Calendar size={12} />}
                  {isLive ? 'Live Feed' : 'Historical Data'}
              </div>
          </div>
        </header>
      )}

      <div className={`${isChartFullscreen ? 'h-screen w-screen bg-[#0d1117] p-4 flex flex-col' : 'p-4 md:p-6 max-w-[1800px] mx-auto'}`}>
        
        {/* Content */}
        {viewMode === 'screener' ? (
          <div className="flex flex-col gap-6">
            <div className={`flex flex-col gap-6 w-full ${isChartFullscreen ? 'h-full' : ''}`}>
              
              {/* Chart Toolbar */}
              <div className="flex flex-col md:flex-row justify-between items-end gap-4">
                 <div>
                   <h2 className="text-2xl font-bold text-white flex items-center gap-3">
                     {config.symbol.replace('USDT', '')} <span className="text-sm text-gray-500 font-normal px-2 py-0.5 bg-gray-800 rounded border border-gray-700">USDT.P</span>
                   </h2>
                 </div>
                 <div className="flex items-center gap-3">
                     <div className="flex items-center bg-gray-900/50 border border-gray-700 rounded-lg p-0.5 h-[34px]">
                        <button onClick={() => setChartIndicators(p => ({...p, volume: !p.volume}))} className={`px-2 h-full rounded flex items-center gap-1 text-[10px] font-bold ${chartIndicators.volume ? 'bg-gray-700 text-white' : 'text-gray-500 hover:text-gray-300'}`}><BarChart2 size={12} /> Vol</button>
                        <div className="w-px bg-gray-700 mx-0.5 h-4"></div>
                        <button onClick={() => setChartIndicators(p => ({...p, orderBlocks: !p.orderBlocks}))} className={`px-2 h-full rounded flex items-center gap-1 text-[10px] font-bold ${chartIndicators.orderBlocks ? 'bg-gray-700 text-white' : 'text-gray-500 hover:text-gray-300'}`}><BoxSelect size={12} /> OB</button>
                     </div>

                     <div className="flex flex-col items-end gap-1">
                        {!isChartFullscreen && <span className="text-[9px] text-gray-500 font-bold uppercase">Chart TF</span>}
                        <div className="flex bg-gray-900/50 border border-gray-700 rounded-lg p-0.5">
                            {chartTimeframes.map(tf => (
                                <button key={tf} onClick={() => { setTimeframe(tf); if(isLongTermMode && ['5m','15m'].includes(tf)) setIsLongTermMode(false); }} className={`px-3 py-1 text-xs font-mono font-medium rounded transition-all ${timeframe === tf ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800'}`}>{tf}</button>
                            ))}
                        </div>
                     </div>

                     <button onClick={() => setShowSettings(!showSettings)} className={`flex items-center gap-2 px-3 py-1.5 rounded text-xs font-medium border transition-colors self-end h-[34px] ${showSettings ? 'bg-blue-600/20 border-blue-600/50 text-blue-400' : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-white'}`}><SlidersHorizontal size={14} /></button>
                     <button onClick={() => setIsChartFullscreen(!isChartFullscreen)} className={`flex items-center justify-center w-[34px] h-[34px] rounded border transition-colors self-end ${isChartFullscreen ? 'bg-gray-700 text-white border-gray-600' : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-white'}`}>{isChartFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}</button>
                 </div>
              </div>
              
              {/* Settings */}
              {showSettings && !isChartFullscreen && (
                 <div className="bg-gray-800/40 border border-gray-700/50 rounded-xl p-4 grid grid-cols-2 md:grid-cols-4 gap-4 animate-in fade-in slide-in-from-top-2 duration-200">
                    <div className="space-y-1">
                      <label className="text-[10px] uppercase text-gray-500 font-bold tracking-wider">Date</label>
                      <input type="date" value={selectedDate} onChange={(e) => { setSelectedDate(e.target.value); setIsLongTermMode(false); }} max={new Date().toISOString().split('T')[0]} className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:ring-1 focus:ring-blue-500 outline-none transition-all" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] uppercase text-gray-500 font-bold tracking-wider">Session (UTC)</label>
                      <div className="flex items-center gap-2">
                        <input type="time" name="startTime" value={config.startTime} onChange={handleConfigChange} className="w-full bg-gray-900 border border-gray-700 rounded-lg px-2 py-2 text-sm text-gray-200 outline-none" />
                        <span className="text-gray-600">-</span>
                        <input type="time" name="endTime" value={config.endTime} onChange={handleConfigChange} className="w-full bg-gray-900 border border-gray-700 rounded-lg px-2 py-2 text-sm text-gray-200 outline-none" />
                      </div>
                    </div>
                    <div className="space-y-1">
                       <label className="text-[10px] uppercase text-gray-500 font-bold tracking-wider">TPO Tick</label>
                       <input type="number" name="tickSize" value={config.tickSize} onChange={handleConfigChange} step="0.01" className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 outline-none" />
                    </div>
                 </div>
              )}

              {/* Chart */}
              {metrics && candles.length > 0 ? (
                <div className={`${isChartFullscreen ? 'flex-1' : ''}`}>
                    <ProfileChart candles={filteredCandles} profile={metrics} orderBlocks={orderBlocks} width={dimensions.width} height={dimensions.height} showVolume={chartIndicators.volume} showOrderBlocks={chartIndicators.orderBlocks} />
                </div>
              ) : (
                <div className={`${isChartFullscreen ? 'flex-1' : 'h-[500px]'} bg-gray-800/30 rounded-xl flex items-center justify-center border border-gray-700/50 border-dashed text-gray-500`}>
                    <div className="flex flex-col items-center">
                       <RefreshCw className="animate-spin mb-3 opacity-50" size={32} />
                       <span className="text-sm font-medium">Initializing Market Data...</span>
                    </div>
                </div>
              )}

              {/* Screener Component */}
              {!isChartFullscreen && (
                  <>
                      <div className="flex justify-between items-center mt-6">
                         <h3 className="text-lg font-bold text-gray-200">Market Radar</h3>
                         <div className="flex flex-col items-end gap-1">
                            <span className="text-[9px] text-gray-500 font-bold uppercase">Signal TF</span>
                            <div className="flex bg-gray-900/50 border border-gray-700 rounded-lg p-0.5">
                                {screenerTimeframes.map(tf => (
                                    <button key={tf} onClick={() => setScreenerTimeframe(tf)} className={`px-2 py-1 text-[10px] font-mono font-medium rounded transition-all ${screenerTimeframe === tf ? 'bg-purple-600 text-white shadow-sm' : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800'}`}>{tf}</button>
                                ))}
                            </div>
                         </div>
                      </div>

                      <div className="mt-2 h-[500px]">
                        <MarketScreener 
                            data={screenerData} 
                            onSelectSymbol={handleSymbolSelect} 
                            selectedSymbol={config.symbol} 
                            favorites={favorites}
                            onToggleFavorite={toggleFavorite}
                        />
                      </div>
                  </>
              )}

              {/* Bottom Intelligence HUD */}
              {!isChartFullscreen && metrics && filteredCandles.length > 0 && (
                 <SessionIntelligence candles={filteredCandles} profile={metrics} />
              )}

            </div>
          </div>
        ) : viewMode === 'hft' ? (
          <div className="animate-in fade-in duration-300">
             <div className="mb-6 flex justify-between items-center">
                <h2 className="text-xl font-bold text-white flex items-center gap-2"><Zap className="text-yellow-500 fill-yellow-500" /> HFT Engine <span className="text-xs bg-gray-800 text-gray-400 px-2 py-0.5 rounded ml-2 font-normal">Experimental</span></h2>
             </div>
             <HFTEngine activeSymbols={['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT', 'BNBUSDT']} />
          </div>
        ) : (
          <div className="animate-in fade-in duration-300">
             <OrderFlowDashboard symbol={config.symbol} />
          </div>
        )}
      </div>
    </div>
  );
}
