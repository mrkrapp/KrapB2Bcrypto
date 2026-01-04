
import { ScreenerRow, SignalType } from '../types';

/**
 * Calculates Z-Score: (Value - Mean) / StdDev
 * Used to identify anomalies in volume, delta, funding.
 */
export const calculateZScore = (value: number, mean: number, stdDev: number): number => {
  if (stdDev === 0) return 0;
  return (value - mean) / stdDev;
};

/**
 * Detects Order Flow Signals based on available metrics.
 * Since we don't have full depth for all 500 symbols, we use heuristic signatures.
 */
export const detectSignal = (
  priceChg: number, 
  volZ: number, 
  delta: number, 
  trend: number
): { type: SignalType; confidence: number } => {
  
  // 1. ABSORPTION (High Vol, Low Price Move)
  if (volZ > 2.5 && Math.abs(priceChg) < 0.1) {
     return { type: 'ABSORPTION', confidence: 85 };
  }

  // 2. AGGRESSIVE BUY (High Vol, High Delta, Price Up)
  if (volZ > 2.0 && delta > 0 && priceChg > 0.5) {
      return { type: 'AGG_BUY', confidence: 90 };
  }

  // 3. AGGRESSIVE SELL (High Vol, Negative Delta, Price Down)
  if (volZ > 2.0 && delta < 0 && priceChg < -0.5) {
      return { type: 'AGG_SELL', confidence: 90 };
  }

  // 4. SQUEEZE (Fast Move, Moderate Vol, High Trend)
  if (Math.abs(priceChg) > 2.0 && volZ < 1.0 && trend > 70) {
      return { type: 'SQUEEZE', confidence: 75 };
  }

  // 5. LIQUIDITY VACUUM (Fast Move, Low Vol)
  if (Math.abs(priceChg) > 1.5 && volZ < 0.5) {
      return { type: 'VACUUM', confidence: 60 };
  }

  return { type: 'NONE', confidence: 0 };
};

/**
 * Calculates the "Attention Score" (0-100).
 * This is the primary sorting metric for the radar.
 */
export const calculateAttentionScore = (
  volZ: number,
  priceChg: number,
  fundingRate: number,
  deltaZ: number,
  hasSignal: boolean
): number => {
  let score = 0;

  // Volume Anomaly (0-40 pts)
  score += Math.min(Math.abs(volZ) * 10, 40);

  // Price Velocity (0-20 pts)
  score += Math.min(Math.abs(priceChg) * 5, 20);

  // Funding Extremes (0-20 pts)
  // Funding > 0.05% or < -0.05% is interesting
  const fundingScore = Math.max(0, (Math.abs(fundingRate) - 0.01) * 1000); 
  score += Math.min(fundingScore, 20);

  // Signal Bonus (20 pts)
  if (hasSignal) score += 20;

  return Math.min(score, 100);
};

/**
 * Generate a simulated sparkline for demo purposes if real history isn't fully available.
 */
export const generateSparkline = (lastPrice: number, volatility: number): number[] => {
    const points = [];
    let price = lastPrice;
    for (let i = 0; i < 20; i++) {
        points.unshift(price);
        price = price * (1 + (Math.random() - 0.5) * volatility);
    }
    return points;
};
