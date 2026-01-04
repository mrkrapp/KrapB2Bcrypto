
import { NoiseFilterLevel } from "../types";

export interface ZoneRaw {
  price: number;
  added: number;
  removed: number;
  executed: number;
  net: number;
  lastQty: number;
  firstSeen: number;
  lastUpdate: number;
  failedPushes?: number;
}

export interface SmartZone {
    id: string;
    priceStart: number;
    priceEnd: number;
    added: number;
    removed: number;
    executed: number;
    net: number;
    density: number;
    avgLifetime: number;
    lastUpdate: number;
    
    // Engine Metrics
    noiseScore: number; // 0 (Signal) to 100 (Noise)
    impactScore: number; // How much price moved relative to vol
    isSignificant: boolean; // Render decision
    volatility: number;
}

export class SmartGroupingEngine {
    
    // Volatility State
    private recentPrices: number[] = [];
    private volatility: number = 0;

    /**
     * Calculates Standard Deviation of recent prices to determine Volatility
     */
    public updateVolatility(currentPrice: number) {
        this.recentPrices.push(currentPrice);
        if (this.recentPrices.length > 20) this.recentPrices.shift();
        
        if (this.recentPrices.length < 5) {
            this.volatility = 0;
            return;
        }

        const mean = this.recentPrices.reduce((a, b) => a + b, 0) / this.recentPrices.length;
        const variance = this.recentPrices.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / this.recentPrices.length;
        this.volatility = Math.sqrt(variance);
    }

    /**
     * Calculates the Adaptive Price Group based on current volatility.
     */
    public getAdaptiveGroupSize(baseGroup: number): number {
        if (this.volatility === 0) return baseGroup;
        
        // If Volatility is high (> $10 moves standard deviation), widen the bucket
        if (this.volatility > 50) return Math.max(baseGroup, 100);
        if (this.volatility > 20) return Math.max(baseGroup, 50);
        if (this.volatility > 5) return Math.max(baseGroup, 10);
        
        return baseGroup;
    }

    /**
     * Core Aggregation Logic
     */
    public aggregateZones(
        rawMap: Map<number, ZoneRaw>, 
        groupSize: number, 
        timeWindow: number,
        noiseLevel: NoiseFilterLevel,
        lastPrice: number
    ): SmartZone[] {
        const now = Date.now();
        const zones = new Map<number, SmartZone>();
        const validStart = now - timeWindow;

        // 1. Bucket Raw Levels
        rawMap.forEach((raw) => {
            if (raw.lastUpdate < validStart) return;

            const bucketKey = groupSize === 0 ? raw.price : Math.floor(raw.price / groupSize) * groupSize;
            
            let zone = zones.get(bucketKey);
            if (!zone) {
                zone = {
                    id: `z-${bucketKey}`,
                    priceStart: bucketKey,
                    priceEnd: groupSize === 0 ? bucketKey : bucketKey + groupSize,
                    added: 0, removed: 0, executed: 0, net: 0, density: 0,
                    avgLifetime: 0, lastUpdate: 0,
                    noiseScore: 0, impactScore: 0, isSignificant: false, volatility: this.volatility
                };
                zones.set(bucketKey, zone);
            }

            zone.added += raw.added;
            zone.removed += raw.removed;
            zone.executed += raw.executed;
            zone.net += raw.net;
            zone.density++;
            zone.lastUpdate = Math.max(zone.lastUpdate, raw.lastUpdate);
            // We use max lifetime of constituents to represent the zone's age
            const rawLifetime = now - raw.firstSeen;
            zone.avgLifetime = Math.max(zone.avgLifetime, rawLifetime);
        });

        // 2. Filter & Noise Calculation
        const processed: SmartZone[] = [];
        const activeVolThreshold = this.calculateDynamicVolumeThreshold(Array.from(zones.values()));

        zones.forEach(zone => {
            // Noise Score Calculation (0 = Clean, 100 = Trash)
            let noise = 50; // Base

            const totalVol = zone.added + zone.removed + zone.executed;
            
            // A. Volume Significance
            if (totalVol > activeVolThreshold * 2) noise -= 30; // High Vol = Signal
            else if (totalVol < activeVolThreshold * 0.2) noise += 30; // Low Vol = Noise

            // B. Lifetime (Spoof Filter)
            if (zone.avgLifetime < 5000) noise += 40; // < 5s is usually noise/algo jitter
            if (zone.avgLifetime > 60000) noise -= 20; // > 1m is structural

            // C. Net Delta Impact (Action -> Result)
            // If Net Delta is huge, but price is INSIDE the zone, it's ABSORPTION (High Signal)
            // If Net Delta is huge, but price MOVED away, it's INITIATION (High Signal)
            // If Net Delta is tiny, and price didn't move, it's NOISE.
            
            const distToPrice = Math.abs(lastPrice - zone.priceStart);
            const inZone = distToPrice < groupSize;
            const deltaRatio = Math.abs(zone.net) / (totalVol || 1);

            if (totalVol > activeVolThreshold && inZone) {
                // High Volume + Price Stuck = Absorption
                noise -= 30;
                zone.impactScore = 100; // Semantic override
            } else if (totalVol > activeVolThreshold && !inZone && zone.executed > 0) {
                // High Volume + Price Moved = Initiation
                noise -= 20;
            } else if (totalVol < activeVolThreshold && !inZone) {
                // Low Volume + Price moved past = Vacuum or Noise
                noise += 10;
            }

            // D. Clamp
            zone.noiseScore = Math.max(0, Math.min(100, noise));

            // E. Final Filter Decision based on User Setting
            let threshold = 50;
            switch(noiseLevel) {
                case 'LOW': threshold = 80; break; // Show almost everything
                case 'MEDIUM': threshold = 60; break;
                case 'HIGH': threshold = 40; break; // Show only high signal
                case 'AUTO': 
                    // In high volatility, filter more aggressively
                    threshold = this.volatility > 20 ? 30 : 60; 
                    break;
            }

            if (zone.noiseScore < threshold) {
                zone.isSignificant = true;
                processed.push(zone);
            }
        });

        return processed.sort((a, b) => b.priceStart - a.priceStart);
    }

    private calculateDynamicVolumeThreshold(zones: SmartZone[]): number {
        if (zones.length === 0) return 1000;
        const volumes = zones.map(z => z.added + z.removed + z.executed).sort((a, b) => a - b);
        const p80 = Math.floor(volumes.length * 0.8);
        return volumes[p80] || 1000;
    }
}
