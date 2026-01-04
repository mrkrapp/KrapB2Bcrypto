
import React, { useMemo } from 'react';
import { Candle, ProfileMetrics } from '../types';

interface SessionIntelligenceProps {
  candles: Candle[];
  profile: ProfileMetrics;
}

export const SessionIntelligence: React.FC<SessionIntelligenceProps> = ({ candles, profile }) => {
  const ctx = useMemo(() => {
    if (!profile || candles.length === 0) return null;

    const last = candles[candles.length - 1];
    const open = candles[0].open;
    const lastPrice = last.close;
    const range = profile.sessionHigh - profile.sessionLow;
    
    // 1. Profile Type Intelligence
    // Heuristic classification based on Open/Close/POC relationship
    let profileType = 'Normal Variation';
    const closeLoc = (lastPrice - profile.sessionLow) / range;
    const pocLoc = (profile.poc - profile.sessionLow) / range;
    
    if (closeLoc > 0.9 && lastPrice > open && range > (lastPrice * 0.01)) profileType = 'Trend (Strong Buy)';
    else if (closeLoc < 0.1 && lastPrice < open && range > (lastPrice * 0.01)) profileType = 'Trend (Strong Sell)';
    else if (range < (lastPrice * 0.005)) profileType = 'Balanced (Compressed)';
    else if (pocLoc > 0.65 && closeLoc < 0.5) profileType = 'P-Shape (Short Covering)';
    else if (pocLoc < 0.35 && closeLoc > 0.5) profileType = 'b-Shape (Long Liquidation)';
    else if (Math.abs(closeLoc - 0.5) < 0.15) profileType = 'Balanced / Rotational';
    
    // 2. Value Acceptance
    let valueStatus = 'Inside Value (Balance)';
    if (lastPrice > profile.vah) {
         // Determine if accepted (time spent above)
         const candlesAbove = candles.filter(c => c.close > profile.vah).length;
         if (candlesAbove > 8) valueStatus = 'Accepted Break (Bullish)';
         else valueStatus = 'Attempted Break';
    } else if (lastPrice < profile.val) {
         const candlesBelow = candles.filter(c => c.close < profile.val).length;
         if (candlesBelow > 8) valueStatus = 'Accepted Break (Bearish)';
         else valueStatus = 'Attempted Break';
    }

    // 3. POC Intelligence
    const distPoc = Math.abs(lastPrice - profile.poc) / lastPrice;
    let pocState = 'Stable';
    if (distPoc < 0.0005) pocState = 'Stable (Accepted)';
    else if (distPoc < 0.002) pocState = 'Magnet (Pulling)';
    else pocState = 'Rejected (Migration)';

    // 4. Delta Summary & Context
    let netDelta = 0;
    let totalVol = 0;
    candles.forEach(c => {
        netDelta += (c.delta || 0);
        totalVol += c.volume;
    });
    
    let deltaState = 'Balanced';
    const deltaRatio = netDelta / totalVol;
    
    if (deltaRatio > 0.05) deltaState = 'Buyers Dominant';
    else if (deltaRatio < -0.05) deltaState = 'Sellers Dominant';
    else {
        // Absorption check: High Delta but Price Reversal?
        if (netDelta > 0 && lastPrice < open) deltaState = 'Aggression Absorbed (Ask)';
        else if (netDelta < 0 && lastPrice > open) deltaState = 'Aggression Absorbed (Bid)';
        else deltaState = 'Neutral / Churn';
    }

    // 5. Volume Context (Simplified Heuristic)
    // In a real app, this compares to 30-day Avg Volume for this time of day
    let volState = 'Normal';
    if (totalVol > 10000000) volState = 'Extreme'; 
    else if (totalVol > 5000000) volState = 'Elevated';
    else if (totalVol < 1000000) volState = 'Below Avg';

    return { profileType, valueStatus, pocState, deltaState, volState };
  }, [candles, profile]);

  if (!ctx) return null;

  return (
    <div className="bg-[#0b0e11] border border-gray-800 rounded-xl p-6 w-full animate-in fade-in duration-500 mt-6 shadow-2xl">
        <h3 className="text-gray-500 font-bold uppercase tracking-widest text-xs mb-6 border-b border-gray-800 pb-2 flex items-center gap-2">
            Session Profile — Context
        </h3>
        
        <div className="grid grid-cols-2 md:grid-cols-5 gap-8">
            <div className="flex flex-col gap-1">
                <span className="text-[10px] text-gray-600 font-bold uppercase tracking-wider">Profile Type</span>
                <span className="text-lg font-bold text-gray-200 leading-tight">{ctx.profileType}</span>
            </div>

            <div className="flex flex-col gap-1">
                <span className="text-[10px] text-gray-600 font-bold uppercase tracking-wider">Value Acceptance</span>
                <span className={`text-lg font-bold leading-tight ${ctx.valueStatus.includes('Accepted') ? 'text-blue-400' : 'text-gray-300'}`}>
                    {ctx.valueStatus}
                </span>
            </div>

            <div className="flex flex-col gap-1">
                <span className="text-[10px] text-gray-600 font-bold uppercase tracking-wider">POC Intelligence</span>
                <span className="text-lg font-bold text-gray-300 leading-tight">{ctx.pocState}</span>
            </div>

            <div className="flex flex-col gap-1">
                <span className="text-[10px] text-gray-600 font-bold uppercase tracking-wider">Delta Summary</span>
                <span className={`text-lg font-bold leading-tight ${
                    ctx.deltaState.includes('Buyers') ? 'text-emerald-400' : 
                    ctx.deltaState.includes('Sellers') ? 'text-rose-400' : 
                    ctx.deltaState.includes('Absorbed') ? 'text-purple-400' : 'text-yellow-400'
                }`}>
                    {ctx.deltaState}
                </span>
            </div>

            <div className="flex flex-col gap-1">
                <span className="text-[10px] text-gray-600 font-bold uppercase tracking-wider">Volume Context</span>
                <span className={`text-lg font-bold leading-tight ${ctx.volState === 'Extreme' ? 'text-orange-400' : 'text-gray-300'}`}>
                    {ctx.volState}
                </span>
            </div>
        </div>
    </div>
  );
};
