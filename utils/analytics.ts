

import { Candle, ProfileLevel, ProfileMetrics, ScreenerRow, OrderBlock, SessionLevels, AuctionMode, AuctionContext, CVDState, ContextTag } from '../types';

/**
 * Checks if a timestamp falls within the session time range.
 */
export const isInSession = (timestamp: number, startStr: string, endStr: string): boolean => {
  const date = new Date(timestamp);
  const hours = date.getUTCHours();
  const minutes = date.getUTCMinutes();
  const currentTime = hours * 60 + minutes;

  const [startH, startM] = startStr.split(':').map(Number);
  const [endH, endM] = endStr.split(':').map(Number);
  const startTime = startH * 60 + startM;
  const endTime = endH * 60 + endM;

  if (startTime <= endTime) {
    return currentTime >= startTime && currentTime < endTime;
  } else {
    return currentTime >= startTime || currentTime < endTime;
  }
};

/**
 * Enriches a list of candles with Order Flow metrics:
 */
export const enrichCandlesWithContext = (candles: Candle[]): Candle[] => {
    let cumDelta = 0;
    let cumVol = 0;
    let cumPV = 0;
    let sumSquaredDev = 0; // For VWAP Bands
    let lastTime = 0;

    const enriched = candles.map((c, i) => {
        // Delta Calculation
        const aggressiveBuy = c.takerBuyVolume;
        const aggressiveSell = c.volume - c.takerBuyVolume;
        const delta = aggressiveBuy - aggressiveSell;
        
        // Reset Logic (New Day UTC)
        const date = new Date(c.timestamp).getUTCDate();
        const prevDate = new Date(lastTime).getUTCDate();
        
        if (lastTime !== 0 && date !== prevDate) {
            cumDelta = 0;
            cumVol = 0;
            cumPV = 0;
            sumSquaredDev = 0;
        }

        cumDelta += delta;
        cumVol += c.volume;
        cumPV += (c.close * c.volume); 
        
        const typicalPrice = (c.high + c.low + c.close) / 3;
        const vwap = cumVol > 0 ? cumPV / cumVol : c.close;
        
        // SD Calc for Bands
        if (cumVol > 0) {
             const dev = typicalPrice - vwap;
             sumSquaredDev += (dev * dev) * c.volume; 
        }
        const variance = cumVol > 0 ? sumSquaredDev / cumVol : 0;
        const stdDev = Math.sqrt(variance);

        lastTime = c.timestamp;

        return {
            ...c,
            delta,
            cvd: cumDelta,
            vwap,
            vwapStd: stdDev,
            divergence: null 
        };
    });

    // --- Divergence Detection Pass ---
    const LOOKBACK = 3; 
    for (let i = LOOKBACK; i < enriched.length - 1; i++) {
        const curr = enriched[i];
        
        // Pivot High
        const isPriceHigh = curr.high > enriched[i-1].high && curr.high > enriched[i+1].high;
        if (isPriceHigh) {
            let prevPivotIdx = -1;
            for(let j = i - 2; j >= Math.max(0, i - 15); j--) {
                if (enriched[j].high > enriched[j-1]?.high && enriched[j].high > enriched[j+1]?.high) {
                    prevPivotIdx = j;
                    break;
                }
            }
            if (prevPivotIdx !== -1) {
                const prev = enriched[prevPivotIdx];
                if (curr.high > prev.high && (curr.delta || 0) < (prev.delta || 0)) {
                    curr.divergence = 'bearish';
                }
            }
        }

        // Pivot Low
        const isPriceLow = curr.low < enriched[i-1].low && curr.low < enriched[i+1].low;
        if (isPriceLow) {
             let prevPivotIdx = -1;
            for(let j = i - 2; j >= Math.max(0, i - 15); j--) {
                if (enriched[j].low < enriched[j-1]?.low && enriched[j].low < enriched[j+1]?.low) {
                    prevPivotIdx = j;
                    break;
                }
            }
            if (prevPivotIdx !== -1) {
                const prev = enriched[prevPivotIdx];
                if (curr.low < prev.low && (curr.delta || 0) > (prev.delta || 0)) {
                    curr.divergence = 'bullish';
                }
            }
        }
    }

    return enriched;
};

/**
 * THE AUCTION BRAIN
 */
export const calculateAuctionContext = (
    lastPrice: number, 
    profile: ProfileMetrics, 
    vwap: number,
    recentCandles: Candle[]
): AuctionContext => {
    if (recentCandles.length < 5) return { mode: 'BALANCED', confidence: 0, scenario: 'Gathering data...', bias: 'neutral' };

    const last = recentCandles[recentCandles.length - 1];
    
    // 1. Determine Base Mode
    let mode: AuctionMode = 'BALANCED';
    
    // Check for Failed Auctions (Lookback 3)
    const recentHighs = Math.max(...recentCandles.slice(-5).map(c => c.high));
    const recentLows = Math.min(...recentCandles.slice(-5).map(c => c.low));

    if (recentHighs > profile.vah && lastPrice < profile.vah && last.close < last.open) {
        mode = 'FAILED_AUCTION_HIGH';
    } else if (recentLows < profile.val && lastPrice > profile.val && last.close > last.open) {
        mode = 'FAILED_AUCTION_LOW';
    } else if (lastPrice > profile.vah) {
        mode = 'INITIATIVE_BUY';
    } else if (lastPrice < profile.val) {
        mode = 'INITIATIVE_SELL';
    } else {
        const distToVAH = Math.abs(lastPrice - profile.vah);
        const distToVAL = Math.abs(lastPrice - profile.val);
        const range = profile.vah - profile.val;
        
        if (distToVAH < range * 0.1 || distToVAL < range * 0.1) {
             mode = 'ROTATIONAL'; // Testing edges
        } else {
             mode = 'BALANCED';
        }
    }

    // 2. Calculate Confidence
    let confidence = 50; // Base
    const delta = last.delta || 0;
    const vol = last.volume;
    
    if (mode === 'INITIATIVE_BUY' && delta > 0 && lastPrice > vwap) confidence += 25;
    if (mode === 'INITIATIVE_SELL' && delta < 0 && lastPrice < vwap) confidence += 25;
    if (mode === 'FAILED_AUCTION_HIGH' && delta < 0) confidence += 30;
    if (mode === 'FAILED_AUCTION_LOW' && delta > 0) confidence += 30;
    if (mode === 'BALANCED' && Math.abs(delta) < (vol * 0.1)) confidence += 20;
    
    confidence = Math.min(100, Math.max(0, confidence));

    // 3. Scenario Generation
    let scenario = "";
    let bias: 'neutral' | 'bullish' | 'bearish' = 'neutral';

    switch(mode) {
        case 'INITIATIVE_BUY':
            scenario = "Acceptance above VA. Buyers chasing price. Target extension.";
            bias = 'bullish';
            break;
        case 'INITIATIVE_SELL':
            scenario = "Weakness below VA. Sellers aggressive. Target lower liquidity.";
            bias = 'bearish';
            break;
        case 'FAILED_AUCTION_HIGH':
            scenario = "Trap at highs. Buyers exhausted. Return to POC likely.";
            bias = 'bearish';
            break;
        case 'FAILED_AUCTION_LOW':
            scenario = "Trap at lows. Demand found. Return to value expected.";
            bias = 'bullish';
            break;
        case 'ROTATIONAL':
            if (lastPrice > profile.poc) {
                scenario = "Testing VAH supply. Break or rotate to POC.";
                bias = 'bullish';
            } else {
                scenario = "Testing VAL demand. Break or rotate to POC.";
                bias = 'bearish';
            }
            break;
        default:
            scenario = "Market in balance. Await reaction at extremes.";
            bias = 'neutral';
    }

    return { mode, confidence, scenario, bias };
};

export const determineCVDState = (candles: Candle[]): CVDState => {
    if (candles.length < 10) return 'NEUTRAL';
    const recent = candles.slice(-10);
    const cvdValues = recent.map(c => c.cvd || 0);
    const first = cvdValues[0];
    const last = cvdValues[cvdValues.length - 1];
    const slope = last - first;
    
    if (Math.abs(slope) < 1000) {
        const range = Math.max(...cvdValues) - Math.min(...cvdValues);
        if (range < 2000) return 'NEUTRAL';
        return 'ABSORPTION';
    }

    if (slope > 0) {
        const priceChange = recent[recent.length-1].close - recent[0].close;
        return priceChange > 0 ? 'EXPANSION_UP' : 'ABSORPTION'; 
    } else {
        const priceChange = recent[recent.length-1].close - recent[0].close;
        return priceChange < 0 ? 'EXPANSION_DOWN' : 'DISTRIBUTION'; 
    }
};

export const calculateSessionLevels = (candles: Candle[]): SessionLevels => {
    if (candles.length === 0) return { ibHigh: null, ibLow: null, vwap: null, sessionHigh: 0, sessionLow: 0 };
    
    let sessionHigh = -Infinity;
    let sessionLow = Infinity;
    const start = candles[0].timestamp;
    const ibDuration = 60 * 60 * 1000;
    let ibHigh = -Infinity;
    let ibLow = Infinity;
    let ibEstablished = false;

    candles.forEach(c => {
        sessionHigh = Math.max(sessionHigh, c.high);
        sessionLow = Math.min(sessionLow, c.low);
        if (c.timestamp < start + ibDuration) {
            ibHigh = Math.max(ibHigh, c.high);
            ibLow = Math.min(ibLow, c.low);
        } else {
            ibEstablished = true;
        }
    });

    const last = candles[candles.length - 1];
    return {
        ibHigh: ibEstablished ? ibHigh : null,
        ibLow: ibEstablished ? ibLow : null,
        vwap: last.vwap || null,
        sessionHigh,
        sessionLow
    };
};

export const calculateProfile = (
  candles: Candle[],
  tickSize: number
): ProfileMetrics => {
  if (candles.length === 0) {
    return {
      levels: [],
      poc: 0,
      vah: 0,
      val: 0,
      totalVolume: 0,
      sessionHigh: 0,
      sessionLow: 0,
    };
  }

  const volumeMap = new Map<number, number>();
  let sessionHigh = -Infinity;
  let sessionLow = Infinity;
  let totalVolume = 0;

  candles.forEach((candle) => {
    sessionHigh = Math.max(sessionHigh, candle.high);
    sessionLow = Math.min(sessionLow, candle.low);

    const lowTick = Math.floor(candle.low / tickSize);
    const highTick = Math.floor(candle.high / tickSize);
    
    const numTicks = highTick - lowTick + 1;
    const volumePerTick = candle.volume / numTicks;

    for (let t = lowTick; t <= highTick; t++) {
      const currentVol = volumeMap.get(t) || 0;
      volumeMap.set(t, currentVol + volumePerTick);
    }
    totalVolume += candle.volume;
  });

  const levels: ProfileLevel[] = Array.from(volumeMap.entries())
    .map(([tickIndex, volume]) => ({
      price: tickIndex * tickSize,
      volume,
    }))
    .sort((a, b) => a.price - b.price);

  let poc = 0;
  let maxVol = -1;
  levels.forEach((l) => {
    if (l.volume > maxVol) {
      maxVol = l.volume;
      poc = l.price;
    }
  });

  const targetVolume = totalVolume * 0.7;
  let currentVolume = maxVol;
  const pocIndex = levels.findIndex((l) => l.price === poc);
  let upperIndex = pocIndex;
  let lowerIndex = pocIndex;

  while (currentVolume < targetVolume && (upperIndex < levels.length - 1 || lowerIndex > 0)) {
    const nextUpper = upperIndex < levels.length - 1 ? levels[upperIndex + 1].volume : 0;
    const nextLower = lowerIndex > 0 ? levels[lowerIndex - 1].volume : 0;

    if (nextUpper > nextLower) {
      upperIndex++;
      currentVolume += levels[upperIndex].volume;
    } else {
      lowerIndex--;
      currentVolume += levels[lowerIndex].volume;
    }
    if (upperIndex === levels.length - 1 && lowerIndex === 0) break;
  }

  return {
    levels,
    poc,
    vah: levels[upperIndex]?.price || poc,
    val: levels[lowerIndex]?.price || poc,
    totalVolume,
    sessionHigh,
    sessionLow,
  };
};

export const calculateScreenerMetrics = (
  symbol: string,
  candles: Candle[], 
  chg24h: number 
): ScreenerRow => {
  const last = candles[candles.length - 1];
  
  const rsi = calculateRSI(candles, 14);
  const trendStrength = Math.abs(rsi - 50) * 2; 

  // --- Context Tag Heuristics (Lightweight) ---
  // Using simplified Donchian Channels / VWAP logic
  let contextTag: ContextTag = 'IN_BALANCE';
  let auctionHint = 'Balanced';

  if (candles.length > 20) {
      const recent = candles.slice(-20);
      const high20 = Math.max(...recent.map(c => c.high));
      const low20 = Math.min(...recent.map(c => c.low));
      const range20 = high20 - low20;
      
      const distHigh = Math.abs(last.close - high20);
      const distLow = Math.abs(last.close - low20);
      
      if (rsi > 70) {
          contextTag = 'OVEREXTENDED';
          auctionHint = 'Potential Mean Reversion';
      } else if (last.close > (high20 - range20 * 0.1)) {
          contextTag = 'TESTING_HIGH';
          auctionHint = 'Testing Supply';
          if (last.volume > (recent[0].volume * 2)) {
             contextTag = 'BREAKOUT';
             auctionHint = 'Price Discovery Up';
          }
      } else if (last.close < (low20 + range20 * 0.1)) {
          contextTag = 'TESTING_LOW';
          auctionHint = 'Testing Demand';
           if (last.volume > (recent[0].volume * 2)) {
             contextTag = 'BREAKDOWN';
             auctionHint = 'Price Discovery Down';
          }
      } else {
          // Inside
          // Use a rough VWAP approx
          const vwapApprox = recent.reduce((sum, c) => sum + c.close, 0) / recent.length;
          if (Math.abs(last.close - vwapApprox) / last.close < 0.002) {
              contextTag = 'AT_VWAP';
              auctionHint = 'Equilibrium';
          } else {
              contextTag = 'IN_BALANCE';
              auctionHint = 'Rotational';
          }
      }
  }

  return {
    symbol,
    price: last.close,
    chg24h,
    vol24h: 0, 
    tfChange: 0,
    tfVolume: 0,
    weekChange: 0, 
    netInflow: 0, 
    fundingRate: 0, 
    trendStrength,
    attentionScore: 0,
    volZScore: 0,
    delta1m: 0,
    deltaZScore: 0,
    ofSignal: 'NONE',
    signalConfidence: 0,
    fundingZScore: 0,
    sparkline: [],
    
    // New Context fields
    contextTag,
    activeDuration: 0, // Filled by App state
    auctionStateHint: auctionHint,
    status: 'ACTIVE', // Added status property
  };
};

const calculateRSI = (candles: Candle[], period: number = 14): number => {
  if (candles.length < period + 1) return 50;

  let gains = 0;
  let losses = 0;

  for (let i = candles.length - period; i < candles.length; i++) {
    const diff = candles[i].close - candles[i-1].close;
    if (diff >= 0) gains += diff;
    else losses += Math.abs(diff);
  }

  const avgGain = gains / period;
  const avgLoss = losses / period;

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
};

export const findOrderBlocks = (candles: Candle[]): OrderBlock[] => {
  const blocks: OrderBlock[] = [];
  if (candles.length < 20) return blocks;
  const lookback = 5;

  for (let i = lookback; i < candles.length - 5; i++) {
    const current = candles[i];
    const prev = candles[i - 1];
    const next = candles[i + 1];
    
    const isRed = current.close < current.open;
    if (isRed) {
       const moveUp = (next.close - current.high) / current.high;
       const isExplosive = moveUp > 0.005; 
       const breaksStructure = next.close > Math.max(...candles.slice(i-lookback, i).map(c => c.high));

       if (isExplosive || breaksStructure) {
          blocks.push({
            id: `bull-${current.timestamp}`,
            type: 'bullish',
            top: current.high,
            bottom: current.low,
            start: current.timestamp,
            mitigated: false,
            strength: isExplosive ? 80 : 50,
            status: 'FRESH'
          });
       }
    }

    const isGreen = current.close > current.open;
    if (isGreen) {
       const moveDown = (current.low - next.close) / current.low;
       const isExplosive = moveDown > 0.005;
       const breaksStructure = next.close < Math.min(...candles.slice(i-lookback, i).map(c => c.low));

       if (isExplosive || breaksStructure) {
          blocks.push({
            id: `bear-${current.timestamp}`,
            type: 'bearish',
            top: current.high,
            bottom: current.low,
            start: current.timestamp,
            mitigated: false,
            strength: isExplosive ? 80 : 50,
            status: 'FRESH'
          });
       }
    }
  }

  // Refine Status logic
  return blocks.filter(ob => {
      const idx = candles.findIndex(c => c.timestamp === ob.start);
      if (idx === -1) return false;
      let broken = false;
      
      for(let j = idx + 1; j < candles.length; j++) {
         const c = candles[j];
         if (ob.type === 'bullish') {
            if (c.low <= ob.top && c.close >= ob.bottom) ob.status = 'TESTED';
            if (c.close < ob.bottom) { broken = true; break; }
         } else {
            if (c.high >= ob.bottom && c.close <= ob.top) ob.status = 'TESTED';
            if (c.close > ob.top) { broken = true; break; }
         }
      }
      return !broken; 
  }).slice(-10);
};
