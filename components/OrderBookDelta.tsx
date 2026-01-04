
import React, { useEffect, useRef, useState, useMemo } from 'react';
import { OrderBookLevel, Trade, NoiseFilterLevel } from '../types';
import { RefreshCw, Hash, Settings2, ChevronDown, Clock, BoxSelect, Zap, Shield, AlertTriangle, TrendingDown, TrendingUp, Filter, Volume2, EyeOff, Activity, Layers, Target, Microscope } from 'lucide-react';
import { SmartGroupingEngine, ZoneRaw, SmartZone } from '../utils/smartGrouping';

interface OrderBookDeltaProps {
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  symbol: string;
  lastPrice: number;
  trades: Trade[];
}

// --- Playbooks Configuration ---

interface PlaybookConfig {
  id: string;
  label: string;
  baseGroup: number;
  timeWindow: number;
  noiseFilter: NoiseFilterLevel;
}

const PLAYBOOKS: Record<string, PlaybookConfig> = {
  SCALP: {
    id: 'SCALP',
    label: 'Scalper (M1)',
    baseGroup: 5,
    timeWindow: 60000 * 5, // 5m Rolling
    noiseFilter: 'LOW'
  },
  INTRADAY: {
    id: 'INTRADAY',
    label: 'Intraday (H1)',
    baseGroup: 25,
    timeWindow: 3600000, // 1h Rolling
    noiseFilter: 'MEDIUM'
  },
  SWING: {
    id: 'SWING',
    label: 'Swing (Session)',
    baseGroup: 100,
    timeWindow: 14400000, // 4h Rolling
    noiseFilter: 'HIGH'
  }
};

const PRICE_GROUPS = [1, 5, 10, 20, 25, 50, 100, 200, 500];

const OrderBookDelta: React.FC<OrderBookDeltaProps> = ({ bids, asks, symbol, lastPrice, trades }) => {
  // --- State & Config ---
  const [playbookKey, setPlaybookKey] = useState<string>('INTRADAY');
  const [customPriceGroup, setCustomPriceGroup] = useState<number | null>(null);
  const [noiseFilter, setNoiseFilter] = useState<NoiseFilterLevel>('AUTO');
  const [isAutoGroup, setIsAutoGroup] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  
  // --- Engine Memory (Refs) ---
  const deltaMap = useRef<Map<number, ZoneRaw>>(new Map());
  const engine = useRef(new SmartGroupingEngine());
  
  // --- UI State ---
  const [zones, setZones] = useState<SmartZone[]>([]);
  const [maxVolume, setMaxVolume] = useState(1);
  const [hoveredZone, setHoveredZone] = useState<number | null>(null);
  const [activeGroupSize, setActiveGroupSize] = useState(10); // Display value

  const activePlaybook = PLAYBOOKS[playbookKey];

  // --- Formatters ---
  const formatK = (n: number) => {
      if (Math.abs(n) >= 1000000) return (n/1000000).toFixed(1) + 'M';
      if (Math.abs(n) >= 1000) return (n/1000).toFixed(0) + 'k';
      return n.toFixed(0);
  };

  const formatTime = (ms: number) => {
      if (ms < 1000) return ms + 'ms';
      if (ms < 60000) return (ms/1000).toFixed(0) + 's';
      if (ms < 3600000) return (ms/60000).toFixed(0) + 'm';
      return (ms/3600000).toFixed(1) + 'h';
  };

  // --- 1. Raw Data Accumulation (Tick Level) ---
  useEffect(() => {
    const timestamp = Date.now();
    
    // Feed volatility engine
    if (lastPrice > 0) engine.current.updateVolatility(lastPrice);

    const updateLevel = (level: OrderBookLevel) => {
        let entry = deltaMap.current.get(level.price);

        if (!entry) {
            entry = {
                price: level.price,
                added: level.qty,
                removed: 0,
                executed: 0,
                net: level.qty,
                lastQty: level.qty,
                firstSeen: timestamp,
                lastUpdate: timestamp,
            };
            deltaMap.current.set(level.price, entry);
        } else {
            const rawDiff = level.qty - entry.lastQty;
            
            if (rawDiff > 0) {
                entry.added += rawDiff;
            } else if (rawDiff < 0) {
                 entry.removed += Math.abs(rawDiff);
            }

            entry.lastQty = level.qty;
            entry.lastUpdate = timestamp;
            entry.net = entry.added - entry.removed; 
        }
    };

    bids.forEach(b => updateLevel(b));
    asks.forEach(a => updateLevel(a));
    
    // Attribute Executions
    const recentTrades = trades.filter(t => t.time > (Date.now() - 500)); 
    recentTrades.forEach(t => {
        const entry = deltaMap.current.get(t.price);
        if (entry) {
             entry.lastUpdate = timestamp;
             entry.executed += t.qty;
        }
    });

  }, [bids, asks, lastPrice]); 

  // --- 2. THE SMART GROUPING ENGINE LOOP ---
  useEffect(() => {
    const engineTick = () => {
        const config = PLAYBOOKS[playbookKey];
        
        // 1. Determine Effective Group Size
        let targetGroup = customPriceGroup || config.baseGroup;
        if (isAutoGroup && customPriceGroup === null) {
            targetGroup = engine.current.getAdaptiveGroupSize(config.baseGroup);
        }
        setActiveGroupSize(targetGroup);

        // 2. Call Engine to Aggregate & Filter
        const calculatedZones = engine.current.aggregateZones(
            deltaMap.current,
            targetGroup,
            config.timeWindow,
            noiseFilter,
            lastPrice
        );

        // 3. Viewport & Scaling
        const range = lastPrice * 0.15;
        const visible = calculatedZones.filter(z => Math.abs(z.priceStart - lastPrice) < range);

        let max = 1;
        visible.forEach(z => {
            if ((z.added + z.removed) > max) max = z.added + z.removed;
        });

        setMaxVolume(max);
        setZones(visible.slice(0, 100));
    };

    const interval = setInterval(engineTick, 200); // 5 FPS
    return () => clearInterval(interval);

  }, [playbookKey, customPriceGroup, lastPrice, trades, noiseFilter, isAutoGroup]);

  const handleReset = () => {
      deltaMap.current.clear();
      engine.current = new SmartGroupingEngine();
  };

  // --- Visual Logic ---
  const getGradient = (zone: SmartZone) => {
      // Opacity based on noise score: Low noise = high opacity
      const opacity = Math.max(0.1, (100 - zone.noiseScore) / 200);
      
      if (zone.net > 0 && zone.impactScore > 80) {
          // Absorption (Purple)
          return `linear-gradient(90deg, rgba(168, 85, 247, ${opacity * 1.5}) 0%, transparent 100%)`; 
      }
      
      if (zone.net > 0) return `linear-gradient(90deg, rgba(34, 197, 94, ${opacity}) 0%, transparent 100%)`; 
      return `linear-gradient(90deg, rgba(239, 68, 68, ${opacity}) 0%, transparent 100%)`; 
  };

  return (
    <div className="flex flex-col h-full bg-[#0d1117] text-xs font-mono select-none border border-gray-800 rounded-lg overflow-hidden relative shadow-2xl">
      
      {/* 1. Decision Header */}
      <div className="flex flex-col border-b border-gray-800 bg-[#0b0e11] z-20">
         <div className="flex justify-between items-center p-2 relative">
             <div className="flex items-center gap-3">
                 <div className="flex items-center gap-1.5 font-bold text-gray-200">
                    <Hash size={16} className="text-gray-500" />
                    <span>SMART DELTA</span>
                    <span className="text-[9px] bg-blue-900/30 text-blue-300 px-1.5 rounded border border-blue-500/30 font-bold shadow-sm">v4.1</span>
                 </div>
                 
                 {/* Playbook Selector */}
                 <div className="relative">
                    <button 
                        onClick={() => setShowSettings(!showSettings)}
                        className={`flex items-center gap-2 px-2 py-1.5 rounded border text-[10px] font-bold uppercase tracking-wide transition-all ${showSettings ? 'bg-gray-800 border-gray-600 text-white' : 'bg-gray-900 border-gray-800 text-gray-400 hover:text-gray-200'}`}
                    >
                        {playbookKey === 'SCALP' && <Zap size={12} className="text-yellow-500" />}
                        {playbookKey === 'INTRADAY' && <Target size={12} className="text-blue-500" />}
                        {playbookKey === 'SWING' && <BoxSelect size={12} className="text-purple-500" />}
                        
                        <span>{activePlaybook.label}</span>
                        <ChevronDown size={10} className="opacity-50" />
                    </button>

                    {showSettings && (
                        <div className="absolute top-full left-0 mt-2 w-80 bg-[#161b22] border border-gray-700 rounded-xl shadow-2xl z-50 p-3 animate-in fade-in slide-in-from-top-2">
                             <div className="text-[10px] uppercase text-gray-500 font-bold mb-2 tracking-widest">Strategy</div>
                             <div className="grid gap-1 mb-4">
                                {Object.values(PLAYBOOKS).map(pb => (
                                    <button 
                                        key={pb.id}
                                        onClick={() => { setPlaybookKey(pb.id); setCustomPriceGroup(null); setNoiseFilter(pb.noiseFilter); setShowSettings(false); }}
                                        className={`flex items-center gap-3 px-3 py-2 rounded text-left border transition-all ${playbookKey === pb.id ? 'bg-gray-800 border-gray-600 text-white' : 'bg-transparent border-transparent text-gray-500 hover:bg-gray-800/50'}`}
                                    >
                                        <div className="text-[10px] font-bold">{pb.label}</div>
                                    </button>
                                ))}
                             </div>

                             <div className="text-[10px] uppercase text-gray-500 font-bold mb-2 tracking-widest">Smart Grouping ($)</div>
                             <div className="flex items-center gap-2 mb-3">
                                 <button 
                                    onClick={() => { setIsAutoGroup(!isAutoGroup); setCustomPriceGroup(null); }}
                                    className={`flex-1 py-1 text-[10px] font-bold rounded border uppercase ${isAutoGroup ? 'bg-purple-600/20 border-purple-500 text-purple-300' : 'bg-gray-800 border-gray-700 text-gray-500'}`}
                                 >
                                     Adaptive {isAutoGroup && '(On)'}
                                 </button>
                             </div>
                             <div className={`grid grid-cols-5 gap-1 ${isAutoGroup ? 'opacity-50 pointer-events-none' : ''}`}>
                                {PRICE_GROUPS.map(pg => (
                                    <button
                                        key={pg}
                                        onClick={() => setCustomPriceGroup(pg)}
                                        className={`px-1 py-1 text-[10px] font-bold rounded border ${activeGroupSize === pg ? 'bg-blue-600 border-blue-500 text-white' : 'bg-gray-800 border-gray-700 text-gray-500'}`}
                                    >
                                        ${pg}
                                    </button>
                                ))}
                             </div>
                             
                             <div className="text-[10px] uppercase text-gray-500 font-bold mb-2 mt-4 tracking-widest">Noise Suppression</div>
                             <div className="grid grid-cols-4 gap-1">
                                 {(['LOW', 'MEDIUM', 'HIGH', 'AUTO'] as NoiseFilterLevel[]).map(nf => (
                                     <button
                                        key={nf}
                                        onClick={() => setNoiseFilter(nf)}
                                        className={`px-1 py-1 text-[10px] font-bold rounded border ${noiseFilter === nf ? 'bg-orange-600/20 border-orange-500 text-orange-400' : 'bg-gray-800 border-gray-700 text-gray-500'}`}
                                     >
                                         {nf}
                                     </button>
                                 ))}
                             </div>
                        </div>
                    )}
                 </div>
             </div>
             
             {/* Engine Stats */}
             <div className="flex items-center gap-4 px-2 text-[9px] text-gray-500 font-bold">
                 <div className="flex items-center gap-1">
                     <Layers size={10} />
                     <span>Group: ${activeGroupSize}</span>
                 </div>
                 <div className="flex items-center gap-1">
                     <Volume2 size={10} />
                     <span>Noise: {noiseFilter}</span>
                 </div>
                 <button onClick={handleReset} className="ml-auto p-1.5 hover:bg-gray-800 rounded text-gray-500 transition-colors" title="Flush Engine">
                    <RefreshCw size={12} />
                 </button>
             </div>
         </div>

         <div className="grid grid-cols-[80px_1fr_1fr_1fr_50px_40px] px-2 py-2 bg-gray-900/80 text-[9px] font-bold uppercase text-gray-500 border-t border-gray-800 tracking-wider">
             <div>Zone</div>
             <div className="text-right text-emerald-600">Added</div>
             <div className="text-right text-rose-600">Rem</div>
             <div className="text-right text-blue-400">Net</div>
             <div className="text-center">State</div>
             <div className="text-right pr-1">Sig%</div>
         </div>
      </div>

      {/* 2. Zone List */}
      <div className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-gray-800 relative bg-[#0d1117]">
          {zones.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-48 text-gray-600 gap-3 opacity-50">
                  <Microscope size={32} />
                  <span className="text-[10px] font-bold uppercase tracking-widest">Calculating Zones...</span>
              </div>
          ) : (
              <div className="relative pb-10">
                  {/* Sticky Price */}
                  <div className="sticky top-0 z-10 w-full flex justify-center pointer-events-none opacity-90">
                     <div className="bg-gray-800 border border-gray-600 rounded-b px-4 py-1 text-xs font-bold text-white shadow-lg backdrop-blur-sm tracking-widest">
                        {lastPrice.toFixed(2)}
                     </div>
                  </div>

                  {zones.map((zone) => {
                      const addedPct = Math.min((zone.added / maxVolume) * 100, 100);
                      const subPct = Math.min((zone.removed / maxVolume) * 100, 100);
                      const isHovered = hoveredZone === zone.priceStart;
                      const isCurrentGroup = lastPrice >= zone.priceStart && lastPrice < zone.priceEnd;
                      const rowGradient = getGradient(zone);
                      
                      // Calculate Visual Signal Strength (100 - Noise)
                      const signalStrength = 100 - zone.noiseScore;
                      
                      // If High Noise, dim row
                      const isNoisy = zone.noiseScore > 60;
                      const rowOpacity = isNoisy && !isHovered && !isCurrentGroup ? 'opacity-30 grayscale' : 'opacity-100';

                      return (
                          <div 
                             key={zone.id}
                             className={`grid grid-cols-[80px_1fr_1fr_1fr_50px_40px] ${activeGroupSize > 0 ? 'h-[28px]' : 'h-[24px]'} items-center px-2 border-b border-gray-800/20 group relative transition-all cursor-crosshair ${rowOpacity}`}
                             style={{ background: isCurrentGroup ? 'rgba(59, 130, 246, 0.15)' : rowGradient }}
                             onMouseEnter={() => setHoveredZone(zone.priceStart)}
                             onMouseLeave={() => setHoveredZone(null)}
                          >
                              {/* --- Price & Group --- */}
                              <div className={`font-mono font-medium truncate flex flex-col justify-center ${isCurrentGroup ? 'text-white' : 'text-gray-500'}`}>
                                  <div className="flex items-center gap-1">
                                      <span>{zone.priceStart.toFixed(0)}</span>
                                  </div>
                                  <div className="h-[2px] w-full bg-gray-800 mt-[1px] rounded-full overflow-hidden opacity-50">
                                      <div className={`h-full ${zone.avgLifetime < 5000 ? 'bg-red-500' : 'bg-blue-400'}`} style={{ width: `${Math.min((zone.avgLifetime / activePlaybook.timeWindow) * 500, 100)}%` }}></div>
                                  </div>
                              </div>

                              {/* --- Added --- */}
                              <div className="relative h-full flex items-center justify-end pr-2 border-r border-gray-800/10">
                                  <div className="absolute right-0 top-[6px] bottom-[6px] bg-emerald-600 rounded-l-sm transition-all opacity-30" style={{ width: `${addedPct}%` }} />
                                  {!isNoisy && zone.added > 0 && <span className="relative z-10 text-[9px] text-emerald-200 font-medium tracking-tight">{formatK(zone.added)}</span>}
                              </div>

                              {/* --- Removed --- */}
                              <div className="relative h-full flex items-center justify-end pr-2 border-r border-gray-800/10">
                                  <div className="absolute right-0 top-[6px] bottom-[6px] bg-rose-600 rounded-l-sm transition-all opacity-30" style={{ width: `${subPct}%` }} />
                                  {!isNoisy && zone.removed > 0 && <span className="relative z-10 text-[9px] text-rose-200 font-medium tracking-tight">{formatK(zone.removed)}</span>}
                              </div>

                              {/* --- Net Delta --- */}
                              <div className="text-right pr-2 font-medium text-[10px] flex items-center justify-end">
                                  <span className={`${zone.net > 0 ? 'text-green-400' : 'text-red-400'}`} style={{ opacity: Math.min(Math.abs(zone.net) / (maxVolume * 0.1) + 0.4, 1) }}>
                                      {zone.net > 0 ? '+' : ''}{formatK(zone.net)}
                                  </span>
                              </div>

                              {/* --- Signal Marker (Icons) --- */}
                              <div className="text-center flex justify-center items-center">
                                  {zone.impactScore > 80 ? (
                                      <span className="text-[8px] font-bold text-purple-200 bg-purple-900/60 px-1.5 py-0.5 rounded border border-purple-500/30">ABS</span>
                                  ) : isNoisy ? (
                                      <EyeOff size={10} className="text-gray-700" />
                                  ) : (
                                     <Activity size={10} className="text-gray-500" />
                                  )}
                              </div>

                              {/* --- Signal Score --- */}
                              <div className="text-right pr-1 flex items-center justify-end">
                                  <div className="flex flex-col items-end">
                                      <span className={`text-[10px] font-bold ${signalStrength > 70 ? 'text-white' : 'text-gray-600'}`}>{signalStrength.toFixed(0)}</span>
                                  </div>
                              </div>

                              {/* --- TOOLTIP (DECISION CARD) --- */}
                              {isHovered && (
                                  <div className="absolute right-[100%] mr-2 top-0 bg-[#0d1117] border border-gray-700 shadow-[0_0_20px_rgba(0,0,0,0.5)] rounded-lg p-3 z-50 w-72 text-xs pointer-events-none animate-in slide-in-from-right-4 duration-150">
                                      {/* Header */}
                                      <div className="flex justify-between items-start mb-3 border-b border-gray-800 pb-2">
                                          <div>
                                              <div className="text-[9px] text-gray-500 font-bold uppercase">Zone Analysis</div>
                                              <div className="text-sm font-bold text-white font-mono">{zone.priceStart}-{zone.priceEnd}</div>
                                          </div>
                                          <div className="flex flex-col items-end gap-1">
                                              <div className={`text-[9px] font-bold px-2 py-0.5 rounded border ${!isNoisy ? 'bg-[#00ffd9]/10 text-[#00ffd9] border-[#00ffd9]/30' : 'bg-gray-800 text-gray-400 border-gray-700'}`}>
                                                  {isNoisy ? 'NOISE' : 'SIGNAL'}
                                              </div>
                                          </div>
                                      </div>
                                      
                                      {/* Metrics Grid */}
                                      <div className="grid grid-cols-2 gap-y-2 gap-x-4 mb-3">
                                          <div>
                                              <div className="text-[9px] text-gray-500 uppercase">Noise Score</div>
                                              <div className={`font-bold ${isNoisy ? 'text-red-400' : 'text-green-400'}`}>{zone.noiseScore.toFixed(0)}</div>
                                          </div>
                                          <div>
                                              <div className="text-[9px] text-gray-500 uppercase">Impact Score</div>
                                              <div className={`font-bold ${zone.impactScore > 50 ? 'text-purple-400' : 'text-gray-500'}`}>{zone.impactScore.toFixed(0)}</div>
                                          </div>
                                          
                                          <div>
                                              <div className="text-[9px] text-gray-500 uppercase">Net Delta</div>
                                              <div className="flex items-center gap-1">
                                                <span className={`font-mono font-bold ${zone.net > 0 ? 'text-green-400' : 'text-red-400'}`}>{zone.net > 0 ? '+' : ''}{formatK(zone.net)}</span>
                                              </div>
                                          </div>
                                          <div>
                                              <div className="text-[9px] text-gray-500 uppercase">Lifetime</div>
                                              <div className="font-mono text-gray-300">{formatTime(zone.avgLifetime)}</div>
                                          </div>
                                      </div>

                                      <div className="text-[9px] text-gray-500 italic border-t border-gray-800 pt-1">
                                          {zone.impactScore > 80 ? "High volume absorption detected." : 
                                           zone.noiseScore > 80 ? "Fleeting liquidity or spoofing detected." :
                                           "Active structural level."}
                                      </div>
                                  </div>
                              )}
                          </div>
                      );
                  })}
              </div>
          )}
      </div>
    </div>
  );
};

export default OrderBookDelta;
