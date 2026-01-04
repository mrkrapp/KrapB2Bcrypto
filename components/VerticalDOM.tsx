
import React, { useMemo } from 'react';
import { EnrichedLevel, PersistentEvent } from '../types';
import { Shield, Zap, AlertTriangle, ChevronsUp, ChevronsDown, XCircle, Anchor, History, AlertOctagon, Skull } from 'lucide-react';

interface VerticalDOMProps {
  bids: EnrichedLevel[];
  asks: EnrichedLevel[];
  lastPrice: number;
  filterThreshold: number; 
  showIcebergs: boolean;
  spread: number;
  events: PersistentEvent[]; // New Prop
}

const formatK = (num: number) => {
    if (num >= 1000000) return (num / 1000000).toFixed(2) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(0) + 'k';
    return num.toFixed(0);
};

// --- DOM Row Component ---
const DOMRow = React.memo(({ 
    level, 
    side, 
    showIcebergs,
    maxVol,
    event
}: { 
    level: EnrichedLevel | null; // Can be null if it's a ghost event level
    side: 'bid' | 'ask'; 
    showIcebergs: boolean;
    maxVol: number;
    event: PersistentEvent | undefined;
    price: number;
}) => {
    const qty = level ? level.qty : 0;
    
    // Heatmap Color Calculation
    const heatOpacity = Math.min(Math.max((qty / maxVol), 0.05), 1);
    const heatColor = side === 'bid' 
        ? `rgba(34, 197, 94, ${heatOpacity * 0.5})` 
        : `rgba(239, 68, 68, ${heatOpacity * 0.5})`;
    
    // Event Styling
    let eventBg = 'transparent';
    let eventBorder = 'transparent';
    let eventOpacity = 1;
    
    if (event) {
        // FAIL uses failTime for aging
        const startTime = event.state === 'FAIL' ? (event.failTime || Date.now()) : event.firstDetected;
        const ageMin = (Date.now() - startTime) / 60000;
        
        // FAIL fades fast (2 mins), others fade slow (30 mins)
        const fadeBase = event.state === 'FAIL' ? 2 : 30;
        eventOpacity = Math.max(0.2, 1 - (ageMin / fadeBase)); 

        if (event.state === 'FAIL') {
             // Distinct Heavy Fail Style
             eventBg = `rgba(255, 50, 50, ${0.15 * eventOpacity})`;
             eventBorder = `rgba(255, 50, 50, ${0.8 * eventOpacity})`;
        } else if (event.type === 'ABSORPTION') {
            eventBg = `rgba(168, 85, 247, ${0.3 * eventOpacity})`;
            eventBorder = `rgba(168, 85, 247, ${0.6 * eventOpacity})`;
        } else if (event.type === 'STACK') {
            eventBg = side === 'bid' ? `rgba(34, 197, 94, ${0.2 * eventOpacity})` : `rgba(239, 68, 68, ${0.2 * eventOpacity})`;
            eventBorder = side === 'bid' ? `rgba(34, 197, 94, ${0.5 * eventOpacity})` : `rgba(239, 68, 68, ${0.5 * eventOpacity})`;
        } else if (event.isRetest) {
            eventBg = `rgba(234, 179, 8, ${0.2 * eventOpacity})`; // Gold for Retest
            eventBorder = `rgba(234, 179, 8, ${0.8 * eventOpacity})`;
        }
    }

    const isBig = qty * (level?.price || 0) > 50000;

    return (
        <div className="grid grid-cols-[45px_1fr_60px_1fr_45px] h-5 text-[10px] items-center hover:bg-white/5 relative border-b border-gray-800/20 group select-none">
            
            {/* Event Background Overlay */}
            {event && (
                <div className="absolute inset-0 pointer-events-none z-0" 
                     style={{ backgroundColor: eventBg, borderTop: `1px solid ${eventBorder}`, borderBottom: `1px solid ${eventBorder}` }}>
                </div>
            )}

            {/* Heatmap Background (Liquidity) */}
            {level && (
                <div 
                    className="absolute inset-0 pointer-events-none transition-colors duration-300 z-0" 
                    style={{ 
                        background: `linear-gradient(to ${side === 'bid' ? 'right' : 'left'}, ${heatColor}, transparent 90%)`,
                        width: `${Math.min(level.depthRatio * 100, 100)}%`,
                        left: side === 'bid' ? 0 : 'auto',
                        right: side === 'ask' ? 0 : 'auto'
                    }}
                />
            )}

            {/* --- 1. Bid Info --- */}
            <div className="text-right px-1 text-gray-500 font-mono text-[9px] flex justify-end items-center border-r border-gray-800/30 z-10 relative">
               {side === 'bid' ? (
                   <>
                       {event?.type === 'ICE' && <div className="w-1 h-3 bg-cyan-400 rounded-full mr-1 shadow-[0_0_5px_cyan]" />}
                       {event?.state === 'FAIL' && <span className="text-red-500 font-bold text-[8px] mr-1 bg-red-900/50 px-1 rounded animate-pulse">FAIL</span>}
                       {level?.deltaQty && level.deltaQty > 0 ? <span className="text-green-500/60">+{formatK(level.deltaQty)}</span> : null}
                   </>
               ) : (
                   <span className="opacity-40">{level ? formatK(level.cumulativeQty) : ''}</span>
               )}
            </div>

            {/* --- 2. Bid Vol --- */}
            <div className={`text-right px-2 font-mono relative flex items-center justify-end gap-1 z-10 ${side === 'bid' ? (isBig ? 'font-bold text-green-300' : 'text-green-500/80') : 'opacity-10'}`}>
                {side === 'bid' && (
                    <>
                         {event?.type === 'ABSORPTION' && <Zap size={8} className="text-purple-400" />}
                         {event?.state === 'HOLDING' && <Shield size={8} className="text-green-500" />}
                         {event?.isRetest && <History size={8} className="text-yellow-500 animate-pulse" />}
                         <span>{level ? formatK(qty) : ''}</span>
                    </>
                )}
            </div>

            {/* --- 3. Price & Tooltip --- */}
            <div className={`text-center font-mono font-bold tracking-tighter z-10 ${side === 'bid' ? 'text-green-400' : 'text-red-400'} ${event ? 'text-white' : ''} cursor-help`}>
                
                {/* TOOLTIP */}
                {event && (
                    <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-1 hidden group-hover:block bg-[#0f172a] border border-gray-700 p-3 rounded shadow-xl z-50 w-56 text-left animate-in fade-in zoom-in-95 duration-100">
                        <div className="flex justify-between items-center mb-2 pb-2 border-b border-gray-700">
                             <div className="flex items-center gap-2">
                                 {event.state === 'FAIL' ? <Skull size={14} className="text-red-500" /> : <Shield size={14} className="text-blue-400" />}
                                 <span className={`font-bold ${event.state === 'FAIL' ? 'text-red-500' : 'text-white'}`}>{event.state}</span>
                             </div>
                             <span className="text-[9px] font-mono text-gray-500">{event.price.toFixed(2)}</span>
                        </div>
                        
                        <div className="space-y-1.5 text-[10px] text-gray-400">
                            <div className="flex justify-between">
                                <span>Previous State:</span>
                                <span className="text-white font-bold">{event.type}</span>
                            </div>
                            <div className="flex justify-between">
                                <span>Lifetime:</span>
                                <span className="font-mono">{((Date.now() - event.firstDetected)/60000).toFixed(1)}m</span>
                            </div>
                            <div className="flex justify-between">
                                <span>Failed Pushes:</span>
                                <span className="text-white">{event.failedPushes}</span>
                            </div>

                            {event.state === 'FAIL' ? (
                                <>
                                    <div className="border-t border-gray-700 my-1 pt-1"></div>
                                    <div className="flex justify-between">
                                        <span>REM Drop:</span>
                                        <span className="text-red-400 font-bold">-{((event.remDropRatio || 0) * 100).toFixed(0)}%</span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span>Confidence:</span>
                                        <span className={`${event.failConfidence > 80 ? 'text-green-400' : 'text-yellow-400'} font-bold`}>{event.failConfidence}%</span>
                                    </div>
                                    <div className="text-[9px] italic text-gray-500 mt-1">
                                        {event.remDropRatio && event.remDropRatio > 0.5 ? "Liquidity pulled before break." : "Defensive wall overwhelmed."}
                                    </div>
                                </>
                            ) : (
                                <div className="flex justify-between">
                                    <span>Peak Vol:</span>
                                    <span className="text-blue-400">{formatK(event.peakVolume)}</span>
                                </div>
                            )}
                        </div>
                    </div>
                )}
                
                {/* Price Display */}
                {side === 'bid' ? (event?.price || level?.price)?.toFixed(2) : (event?.price || level?.price)?.toFixed(2)}
            </div>

            {/* --- 4. Ask Vol --- */}
            <div className={`text-left px-2 font-mono relative flex items-center gap-1 z-10 ${side === 'ask' ? (isBig ? 'font-bold text-red-300' : 'text-red-500/80') : 'opacity-10'}`}>
                {side === 'ask' && (
                    <>
                        <span>{level ? formatK(qty) : ''}</span>
                        {event?.isRetest && <History size={8} className="text-yellow-500 animate-pulse" />}
                        {event?.state === 'HOLDING' && <Shield size={8} className="text-red-500" />}
                        {event?.type === 'ABSORPTION' && <Zap size={8} className="text-purple-400" />}
                    </>
                )}
            </div>

            {/* --- 5. Ask Info --- */}
            <div className="text-left px-1 text-gray-500 font-mono text-[9px] flex items-center border-l border-gray-800/30 z-10 relative">
                {side === 'ask' ? (
                   <>
                       {level?.deltaQty && level.deltaQty > 0 ? <span className="text-red-500/60">+{formatK(level.deltaQty)}</span> : null}
                       {event?.state === 'FAIL' && <span className="text-red-500 font-bold text-[8px] ml-1 bg-red-900/50 px-1 rounded animate-pulse">FAIL</span>}
                       {event?.type === 'ICE' && <div className="w-1 h-3 bg-cyan-400 rounded-full ml-1 shadow-[0_0_5px_cyan]" />}
                   </>
               ) : (
                   <span className="opacity-40">{level ? formatK(level.cumulativeQty) : ''}</span>
               )}
            </div>
        </div>
    );
}, (prev, next) => {
    // Custom Comparison to avoid unnecessary renders
    const prevLvl = prev.level;
    const nextLvl = next.level;
    const prevEvt = prev.event;
    const nextEvt = next.event;

    // Check Level Changes
    if (prevLvl?.qty !== nextLvl?.qty) return false;
    if (prevLvl?.deltaQty !== nextLvl?.deltaQty) return false;
    if (prev.maxVol !== next.maxVol) return false;

    // Check Event Changes
    if (prevEvt !== nextEvt) return false; 
    if (prevEvt && nextEvt) {
        if (prevEvt.strength !== nextEvt.strength) return false;
        if (prevEvt.state !== nextEvt.state) return false; // Important for FAIL transition
        if (prevEvt.isActive !== nextEvt.isActive) return false;
        if (prevEvt.isRetest !== nextEvt.isRetest) return false;
    }

    return true;
});


const VerticalDOM: React.FC<VerticalDOMProps> = ({ bids, asks, lastPrice, filterThreshold, showIcebergs, spread, events }) => {
  
  // Create Maps for fast lookup
  const bidMap = useMemo(() => new Map(bids.map(b => [b.price, b])), [bids]);
  const askMap = useMemo(() => new Map(asks.map(a => [a.price, a])), [asks]);
  const eventMap = useMemo(() => {
      const map = new Map<number, PersistentEvent>();
      events.forEach(e => map.set(e.price, e));
      return map;
  }, [events]);

  // Combine Real Levels + Ghost Levels (Historical Events where qty=0)
  // We need to construct a contiguous or merged list of prices to render
  
  // 1. Get Base Ranges from live data
  const maxAsk = asks.length > 0 ? asks[asks.length-1].price : lastPrice + 10;
  const minAsk = asks.length > 0 ? asks[0].price : lastPrice;
  const maxBid = bids.length > 0 ? bids[0].price : lastPrice;
  const minBid = bids.length > 0 ? bids[bids.length-1].price : lastPrice - 10;

  // 2. Identify Event Prices outside current range (Ghost Levels)
  // We only care about events somewhat close to price to avoid rendering miles of empty DOM
  const visibleRange = lastPrice * 0.05; // +/- 5%
  const relevantEvents = events.filter(e => Math.abs(e.price - lastPrice) < visibleRange);

  // 3. Merge Logic for ASKS
  // Get all unique prices from live asks + relevant ask events
  const askPrices = new Set<number>(asks.map(a => a.price));
  relevantEvents.filter(e => e.side === 'ask' && e.price >= lastPrice).forEach(e => askPrices.add(e.price));
  const sortedAskPrices = Array.from(askPrices).sort((a: number, b: number) => b - a); // Descending (High at top)

  // 4. Merge Logic for BIDS
  const bidPrices = new Set<number>(bids.map(b => b.price));
  relevantEvents.filter(e => e.side === 'bid' && e.price <= lastPrice).forEach(e => bidPrices.add(e.price));
  const sortedBidPrices = Array.from(bidPrices).sort((a: number, b: number) => b - a); // Descending (High at top)

  
  // Calculate Global Max for Heatmap normalization
  const maxVol = useMemo(() => {
      const bMax = Math.max(...bids.map(b => b.qty), 1);
      const aMax = Math.max(...asks.map(a => a.qty), 1);
      return Math.max(bMax, aMax);
  }, [bids, asks]);

  // Spread / Impulse Zone Logic
  const spreadPercentage = (spread / lastPrice) * 100;
  const isImpulseZone = spreadPercentage > 0.05; 

  return (
    <div className="flex flex-col h-full bg-[#0b0e11] font-mono text-xs select-none">
       {/* Header */}
       <div className="grid grid-cols-[45px_1fr_60px_1fr_45px] px-0 py-2 border-b border-gray-800 bg-gray-900/90 text-[9px] font-bold text-gray-500 uppercase tracking-wider sticky top-0 z-20 shadow-md">
          <div className="text-right pr-2">Delta</div>
          <div className="text-right pr-2">Bid</div>
          <div className="text-center">Price</div>
          <div className="text-left pl-2">Ask</div>
          <div className="text-left pl-2">Delta</div>
       </div>

       <div className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-gray-800 relative bg-[#0b0e11]">
          
          {/* ASKS (Sells) */}
          <div className="flex flex-col justify-end pb-0">
             {sortedAskPrices.map((price) => {
                const level = askMap.get(price) || null;
                const event = eventMap.get(price);
                
                // Skip if filtered out by threshold AND no event exists
                if (!event && level && (level.price * level.qty) < filterThreshold) return null;
                if (!level && !event) return null; // Should not happen

                return (
                    <DOMRow 
                        key={price} 
                        level={level} 
                        side="ask" 
                        showIcebergs={showIcebergs} 
                        maxVol={maxVol}
                        event={event}
                        price={price}
                    />
                );
             })}
             {sortedAskPrices.length === 0 && <div className="h-20 flex items-center justify-center text-gray-700">Empty Side</div>}
          </div>

          {/* SPREAD / IMPULSE ZONE */}
          <div className={`sticky top-0 bottom-0 py-1 my-0.5 backdrop-blur-sm z-30 flex justify-center items-center gap-4 transition-all duration-300 ${isImpulseZone ? 'bg-yellow-900/10 border-y border-yellow-900/30' : 'bg-gray-800/40 border-y border-gray-700/30'}`}>
             <div className="flex flex-col items-end">
                <span className="text-[9px] text-gray-500 font-bold">SPREAD</span>
                <span className={`text-[10px] font-mono ${spread > 5 ? 'text-red-400' : 'text-gray-400'}`}>{spread.toFixed(2)}</span>
             </div>
             
             <div className="bg-[#0d1117] px-4 py-1 rounded border border-gray-700 flex items-center justify-center min-w-[100px]">
                <span className={`font-bold text-xl tracking-widest ${lastPrice > 0 ? 'text-white' : 'text-gray-500'}`}>
                    {lastPrice.toFixed(2)}
                </span>
             </div>

            {isImpulseZone && (
                 <div className="flex flex-col items-start animate-pulse">
                    <AlertTriangle size={12} className="text-yellow-500" />
                    <span className="text-[8px] text-yellow-500 font-bold uppercase">Impulse</span>
                 </div>
             )}
          </div>

          {/* BIDS (Buys) */}
          <div className="flex flex-col pt-0">
             {sortedBidPrices.map((price) => {
                 const level = bidMap.get(price) || null;
                 const event = eventMap.get(price);

                 if (!event && level && (level.price * level.qty) < filterThreshold) return null;
                 if (!level && !event) return null;

                 return (
                    <DOMRow 
                        key={price} 
                        level={level} 
                        side="bid" 
                        showIcebergs={showIcebergs} 
                        maxVol={maxVol}
                        event={event}
                        price={price}
                    />
                );
             })}
          </div>

       </div>
    </div>
  );
};

export default VerticalDOM;
