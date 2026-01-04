
import React, { useState, useMemo, memo } from 'react';
import { ScreenerRow, SortConfig, SignalType, ContextTag, SymbolStatus } from '../types';
import { 
  ArrowUp, ArrowDown, Filter, Zap, Activity, 
  BarChart2, Flame, AlertTriangle, MousePointer2, Clock, Map, Loader2 
} from 'lucide-react';

interface MarketScreenerProps {
  data: ScreenerRow[];
  onSelectSymbol: (symbol: string) => void;
  selectedSymbol: string;
  favorites: Set<string>;
  onToggleFavorite: (symbol: string) => void;
}

// --- Sub-components for Performance ---

const ContextBadge = memo(({ tag }: { tag: ContextTag }) => {
    let colorClass = 'text-gray-500 border-gray-700 bg-gray-800/50';
    if (tag === 'BREAKOUT' || tag === 'TESTING_HIGH') colorClass = 'text-blue-400 border-blue-900/50 bg-blue-900/20';
    if (tag === 'BREAKDOWN' || tag === 'TESTING_LOW') colorClass = 'text-orange-400 border-orange-900/50 bg-orange-900/20';
    if (tag === 'OVEREXTENDED') colorClass = 'text-purple-400 border-purple-900/50 bg-purple-900/20';
    if (tag === 'AT_VWAP') colorClass = 'text-yellow-500 border-yellow-900/50 bg-yellow-900/20';
    
    return (
        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${colorClass} uppercase tracking-tight`}>
            {tag.replace('_', ' ')}
        </span>
    );
});

const SignalBadge = memo(({ type, confidence, duration }: { type: SignalType; confidence: number; duration: number }) => {
  if (type === 'NONE') return <span className="text-gray-800 text-[10px]">-</span>;

  let bg = 'bg-gray-800';
  let text = 'text-gray-400';
  let border = 'border-gray-700';
  let label: string = type;
  
  // Quality Indicator (Opacity based on confidence)
  const opacity = confidence > 80 ? 'opacity-100' : confidence > 60 ? 'opacity-80' : 'opacity-60';

  switch (type) {
    case 'AGG_BUY':
      bg = 'bg-emerald-900/40'; text = 'text-emerald-400'; border = 'border-emerald-500/40'; label = 'AGG BUY';
      break;
    case 'AGG_SELL':
      bg = 'bg-rose-900/40'; text = 'text-rose-400'; border = 'border-rose-500/40'; label = 'AGG SELL';
      break;
    case 'ABSORPTION':
      bg = 'bg-purple-900/40'; text = 'text-purple-300'; border = 'border-purple-500/40'; label = 'ABSORB';
      break;
    case 'VACUUM':
      bg = 'bg-gray-700/50'; text = 'text-gray-300'; border = 'border-gray-500/40'; label = 'VACUUM';
      break;
    case 'SQUEEZE':
      bg = 'bg-orange-900/40'; text = 'text-orange-400'; border = 'border-orange-500/40'; label = 'SQUEEZE';
      break;
  }

  return (
    <div className="flex items-center gap-2">
        <div className={`flex items-center gap-1.5 px-2 py-0.5 rounded border ${bg} ${border} ${opacity} min-w-[70px] justify-center shadow-sm`}>
            <span className={`text-[10px] font-bold ${text}`}>{label}</span>
            {confidence > 85 && <div className={`w-1 h-1 rounded-full ${text.replace('text-', 'bg-')} animate-pulse`}></div>}
        </div>
        {/* Persistence Indicator */}
        {duration > 0 && (
            <div className="flex items-center gap-0.5 text-[9px] font-mono text-gray-500" title={`Active for ${duration} minutes`}>
                <Clock size={8} />
                <span>{duration}m</span>
            </div>
        )}
    </div>
  );
});

const AttentionBar = memo(({ score }: { score: number }) => {
  const getColor = (s: number) => {
    if (s > 80) return 'bg-[#00ffd9] shadow-[0_0_8px_#00ffd9]';
    if (s > 50) return 'bg-orange-500';
    return 'bg-blue-600';
  };

  return (
    <div className="w-16 h-1.5 bg-gray-800 rounded-full overflow-hidden flex">
      <div 
        className={`h-full transition-all duration-500 ${getColor(score)}`} 
        style={{ width: `${score}%` }}
      />
    </div>
  );
});

// --- Main Component ---

const MarketScreener: React.FC<MarketScreenerProps> = ({ 
  data, 
  onSelectSymbol, 
  selectedSymbol, 
  favorites,
  onToggleFavorite 
}) => {
  const [sortConfig, setSortConfig] = useState<SortConfig>({ key: 'attentionScore', direction: 'desc' });
  const [hoveredSymbol, setHoveredSymbol] = useState<string | null>(null);
  const [contextMode, setContextMode] = useState(false); // Toggle for Detail View

  // 1. Sort & Filter
  const processedData = useMemo(() => {
    const sorted = [...data].sort((a, b) => {
       // Always put active symbols first unless sorting by something else specific
       // Actually, maintaining sort order is better, but maybe de-prioritize INITIALIZING
       if (a.status === 'INITIALIZING' && b.status !== 'INITIALIZING') return 1;
       if (b.status === 'INITIALIZING' && a.status !== 'INITIALIZING') return -1;

       const valA = a[sortConfig.key];
       const valB = b[sortConfig.key];

       if (typeof valA === 'number' && typeof valB === 'number') {
           return sortConfig.direction === 'asc' ? valA - valB : valB - valA;
       }
       return 0;
    });
    return sorted;
  }, [data, sortConfig]);

  const handleSort = (key: keyof ScreenerRow) => {
      setSortConfig(current => ({
          key,
          direction: current.key === key && current.direction === 'desc' ? 'asc' : 'desc'
      }));
  };

  // --- Formatters ---
  const fmtPrice = (p: number) => p < 1 ? p.toFixed(4) : p < 10 ? p.toFixed(3) : p.toFixed(2);
  const fmtPct = (n: number) => (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  
  return (
    <div className="flex flex-col h-full bg-[#0d1117] border border-gray-800 rounded-xl overflow-hidden shadow-2xl">
      
      {/* Header Toolbar */}
      <div className="flex items-center justify-between px-4 py-3 bg-[#0b0e11] border-b border-gray-800">
          <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 text-gray-200 font-bold text-sm">
                  <Activity size={16} className="text-blue-500" />
                  <span>Market Radar</span>
              </div>
              <span className="text-[10px] text-gray-600 font-mono px-1.5 py-0.5 border border-gray-800 rounded">
                  {processedData.filter(d => d.status === 'ACTIVE').length} ACTIVE
                  {processedData.some(d => d.status === 'WARMING_UP') && <span className="ml-1 text-yellow-600">({processedData.filter(d => d.status === 'WARMING_UP').length} WARM)</span>}
              </span>
          </div>
          
          <div className="flex items-center gap-3">
              <div className="flex bg-gray-900 rounded-lg p-0.5 border border-gray-800">
                  <button onClick={() => setContextMode(false)} className={`px-3 py-1 text-[10px] font-bold uppercase rounded transition-all ${!contextMode ? 'bg-gray-700 text-white' : 'text-gray-500 hover:text-gray-300'}`}>Scan</button>
                  <button onClick={() => setContextMode(true)} className={`px-3 py-1 text-[10px] font-bold uppercase rounded transition-all ${contextMode ? 'bg-gray-700 text-white' : 'text-gray-500 hover:text-gray-300'}`}>Context</button>
              </div>

              <div className="w-px h-4 bg-gray-800"></div>

              {/* Quick Filters */}
              <button 
                  onClick={() => handleSort('attentionScore')}
                  className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] font-bold uppercase transition-colors ${sortConfig.key === 'attentionScore' ? 'bg-blue-900/30 text-blue-400 border border-blue-800' : 'bg-gray-800 text-gray-500 border border-gray-700'}`}
              >
                  <Flame size={10} />
                  Hot
              </button>
              <button 
                  onClick={() => handleSort('volZScore')}
                  className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] font-bold uppercase transition-colors ${sortConfig.key === 'volZScore' ? 'bg-purple-900/30 text-purple-400 border border-purple-800' : 'bg-gray-800 text-gray-500 border border-gray-700'}`}
              >
                  <BarChart2 size={10} />
                  Vol Z
              </button>
          </div>
      </div>

      {/* Table Header */}
      <div className={`grid ${contextMode ? 'grid-cols-[30px_100px_80px_1fr_80px_80px_100px]' : 'grid-cols-[30px_90px_60px_60px_1fr_60px_60px_80px]'} gap-2 px-2 py-2 bg-[#0d1117] text-[9px] font-bold text-gray-500 uppercase tracking-wider sticky top-0 z-20 border-b border-gray-800`}>
          <div className="text-center">#</div>
          <div className="cursor-pointer hover:text-white" onClick={() => handleSort('symbol')}>Symbol</div>
          
          {contextMode ? (
              <>
                 <div className="text-right cursor-pointer hover:text-white" onClick={() => handleSort('price')}>Price</div>
                 <div className="text-left pl-2">Market Context</div>
                 <div className="text-right cursor-pointer hover:text-white" onClick={() => handleSort('volZScore')}>Vol Z</div>
                 <div className="text-right cursor-pointer hover:text-white" onClick={() => handleSort('delta1m')}>Delta</div>
                 <div className="text-right cursor-pointer hover:text-white pr-2" onClick={() => handleSort('attentionScore')}>Attention</div>
              </>
          ) : (
              <>
                  <div className="text-right cursor-pointer hover:text-white" onClick={() => handleSort('price')}>Price</div>
                  <div className="text-right cursor-pointer hover:text-white" onClick={() => handleSort('tfChange')}>Chg%</div>
                  <div className="text-left pl-2">Signal Flow</div>
                  <div className="text-right cursor-pointer hover:text-white" onClick={() => handleSort('volZScore')}>Vol Z</div>
                  <div className="text-right cursor-pointer hover:text-white" onClick={() => handleSort('delta1m')}>Delta</div>
                  <div className="text-right cursor-pointer hover:text-white pr-2" onClick={() => handleSort('attentionScore')}>Attention</div>
              </>
          )}
      </div>

      {/* List Area */}
      <div className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-gray-800 relative bg-[#0b0e11]">
          {processedData.map((row, idx) => {
              const isSelected = selectedSymbol === row.symbol;
              const isFav = favorites.has(row.symbol);
              const score = row.attentionScore || 0;
              const isHot = score > 60 && row.status === 'ACTIVE';
              const isWarming = row.status === 'WARMING_UP' || row.status === 'INITIALIZING';
              
              const rowBg = isSelected 
                  ? 'bg-blue-900/20 border-l-2 border-l-blue-500' 
                  : isHot 
                    ? 'bg-gradient-to-r from-[#0d1117] to-blue-900/10'
                    : idx % 2 === 0 ? 'bg-[#0b0e11]' : 'bg-[#0d1117]';

              const priceColor = row.tfChange > 0 ? 'text-green-400' : row.tfChange < 0 ? 'text-red-400' : 'text-gray-400';
              
              return (
                  <div 
                      key={row.symbol}
                      className={`grid ${contextMode ? 'grid-cols-[30px_100px_80px_1fr_80px_80px_100px] h-[48px]' : 'grid-cols-[30px_90px_60px_60px_1fr_60px_60px_80px] h-[36px]'} gap-2 items-center px-2 border-b border-gray-800/40 cursor-pointer hover:bg-gray-800/50 transition-colors text-xs group ${rowBg} ${isWarming ? 'opacity-50 grayscale-[0.5]' : ''}`}
                      onClick={() => onSelectSymbol(row.symbol)}
                      onMouseEnter={() => setHoveredSymbol(row.symbol)}
                      onMouseLeave={() => setHoveredSymbol(null)}
                  >
                      {/* 1. Rank/Fav */}
                      <div className="flex justify-center" onClick={(e) => { e.stopPropagation(); onToggleFavorite(row.symbol); }}>
                         {row.status === 'INITIALIZING' ? (
                            <Loader2 size={12} className="text-gray-600 animate-spin" />
                         ) : (
                            <div className={`w-1.5 h-1.5 rounded-full ${isFav ? 'bg-yellow-400 shadow-[0_0_6px_#facc15]' : isWarming ? 'bg-gray-700' : 'bg-gray-700 group-hover:bg-gray-500'}`}></div>
                         )}
                      </div>

                      {/* 2. Symbol & Context (in Context Mode) */}
                      <div>
                          <div className={`font-bold leading-none ${isSelected ? 'text-white' : 'text-gray-300'}`}>
                             {row.symbol.replace('USDT', '')}
                             {isWarming && <span className="text-[8px] ml-1 text-gray-500 font-normal">WARM</span>}
                          </div>
                          {contextMode && <div className="mt-1"><ContextBadge tag={row.contextTag} /></div>}
                      </div>

                      {/* 3. Price */}
                      <div className={`text-right font-mono ${priceColor}`}>
                          {fmtPrice(row.price)}
                          {contextMode && <div className={`text-[9px] ${row.tfChange > 0 ? 'text-green-500/70' : 'text-red-500/70'}`}>{fmtPct(row.tfChange)}</div>}
                      </div>

                      {/* 4. Column Switch based on Mode */}
                      {contextMode ? (
                          /* CONTEXT MODE: Signal + Auction Hint */
                          <div className="pl-2 flex flex-col justify-center">
                              <SignalBadge type={row.ofSignal} confidence={row.signalConfidence} duration={row.activeDuration} />
                              <div className="flex items-center gap-1 mt-1 opacity-60">
                                 <Map size={8} />
                                 <span className="text-[9px] text-gray-400">{row.auctionStateHint}</span>
                              </div>
                          </div>
                      ) : (
                          <>
                             {/* SCAN MODE: Chg% + Signal */}
                             <div className={`text-right font-mono ${priceColor}`}>
                                 {fmtPct(row.tfChange)}
                             </div>
                             <div className="pl-2 flex items-center">
                                 <SignalBadge type={row.ofSignal} confidence={row.signalConfidence} duration={row.activeDuration} />
                             </div>
                          </>
                      )}

                      {/* 5. Vol Z-Score */}
                      <div className={`text-right font-mono ${row.volZScore > 2 ? 'text-purple-400 font-bold' : 'text-gray-500'}`}>
                          {row.volZScore?.toFixed(1) || '0.0'}σ
                      </div>

                      {/* 6. Delta */}
                      <div className={`text-right font-mono ${row.delta1m > 0 ? 'text-green-500' : row.delta1m < 0 ? 'text-red-500' : 'text-gray-600'}`}>
                          {row.delta1m > 0 ? '+' : ''}{row.delta1m ? (row.delta1m/1000).toFixed(0) + 'K' : '-'}
                      </div>

                      {/* 7. Attention Score */}
                      <div className="pr-2 flex flex-col items-end justify-center gap-0.5">
                          <span className={`text-[9px] font-bold ${score > 70 ? 'text-white' : 'text-gray-500'}`}>{score.toFixed(0)}</span>
                          <AttentionBar score={score} />
                      </div>
                  </div>
              );
          })}
      </div>
    </div>
  );
};

export default MarketScreener;
