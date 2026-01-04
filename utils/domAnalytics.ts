
import { OrderBookLevel, Trade, EnrichedLevel } from '../types';

// Constants for Detection
const ICEBERG_RELOAD_THRESHOLD = 0.1; // If volume reloads within 10% of previous, suspect iceberg
const ABSORPTION_RATIO = 2.0; // If Trade Vol > 2x Limit Liquidity and price holds
const SPOOF_PULL_THRESHOLD = 5000; // USD Value to consider a pull significant
const LARGE_ORDER_THRESHOLD = 10000; // USD Value

/**
 * Merges raw depth data with trade data and previous state to detect patterns.
 */
export const analyzeDOM = (
  newLevels: OrderBookLevel[], 
  prevLevels: Map<number, EnrichedLevel>,
  recentTrades: Trade[],
  side: 'bid' | 'ask'
): EnrichedLevel[] => {
  
  // 1. Aggregate Trades by Price
  const tradeMap = new Map<number, number>();
  recentTrades.forEach(t => {
    // For Bids, we look at Sell trades hitting them (isBuyerMaker = true)
    // For Asks, we look at Buy trades hitting them (isBuyerMaker = false)
    if ((side === 'bid' && t.isBuyerMaker) || (side === 'ask' && !t.isBuyerMaker)) {
       const p = t.price;
       // Simple binning to nearest price level if needed, but assuming exact matches for now
       tradeMap.set(p, (tradeMap.get(p) || 0) + t.qty);
    }
  });

  let cumulative = 0;

  // Process Enriched Levels
  const result: EnrichedLevel[] = newLevels.map(level => {
    const prev = prevLevels.get(level.price);
    const executedVol = tradeMap.get(level.price) || 0;
    
    cumulative += level.qty;

    // --- 1. Delta (Liquidity Change) ---
    // Net change = NewQty - PrevQty
    // Real Change (Added/Removed) = (NewQty - PrevQty) + ExecutedVol
    let delta = 0;
    let isSpoof = false;

    if (prev) {
        const rawDiff = level.qty - prev.qty;
        // If it's a Bid, executed volume REMOVES liquidity. So if Qty didn't drop by ExecutedVol, it was added.
        // Added = New - (Prev - Executed) = New - Prev + Executed
        delta = rawDiff + executedVol;

        // --- 2. Spoofing / Liquidity Pull Detection ---
        // If significant liquidity vanished WITHOUT execution
        const valueRemoved = (prev.qty - level.qty) * level.price;
        if (valueRemoved > SPOOF_PULL_THRESHOLD && executedVol === 0) {
            isSpoof = true;
        }
    } else {
        // New Level
        delta = level.qty; 
    }

    // --- 3. Iceberg Detection ---
    // If we had execution, but liquidity remained same or increased (delta > 0 while trades happened)
    let isIceberg = false;
    let icebergVol = prev ? prev.icebergVol : 0;
    
    if (executedVol > 0 && delta >= 0) {
        // They hit it, but it didn't drop -> Replenished
        isIceberg = true;
        icebergVol += executedVol; // Accumulate hidden volume
    }

    // --- 4. Absorption ---
    // High trade volume relative to the remaining liquidity
    // e.g. 50k traded, 10k sitting there, price holds
    const absorptionScore = (executedVol > 0 && level.qty > 0) 
        ? executedVol / level.qty 
        : 0;

    // --- 5. Aging ---
    const age = prev ? prev.age + 1 : 0;

    return {
        ...level,
        type: side,
        cumulativeQty: cumulative,
        deltaQty: delta,
        tradeVol: executedVol,
        absorption: absorptionScore,
        isIceberg,
        icebergVol,
        isSpoof,
        age
    };
  });

  return result;
};
