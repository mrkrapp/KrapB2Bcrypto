
import { EnrichedLevel, PersistentEvent, PersistentEventType, PersistenceWindow, EventState } from '../types';

export class EventEngine {
  private events: Map<string, PersistentEvent>;
  private windowMinutes: number;
  
  // Anti-Thrash: Prevent generating multiple FAILs in the same range quickly
  private failCooldowns: Map<number, number> = new Map(); 

  constructor() {
    this.events = new Map();
    this.windowMinutes = 30; // Default
  }

  public setWindow(window: PersistenceWindow) {
    this.windowMinutes = window === 'SESSION' ? 480 : window; 
  }

  public getEvents(): PersistentEvent[] {
    return Array.from(this.events.values());
  }

  public process(
    bids: EnrichedLevel[], 
    asks: EnrichedLevel[], 
    lastPrice: number
  ): PersistentEvent[] {
    const now = Date.now();
    const windowMs = this.windowMinutes * 60 * 1000;

    // 1. Process Active Levels (Reinforce or Create)
    this.processLevels(bids, 'bid', now, lastPrice);
    this.processLevels(asks, 'ask', now, lastPrice);

    // 2. Process State Machine (Failures & Retests)
    for (const [key, event] of this.events.entries()) {
      const age = now - event.firstDetected;

      // Expiration (Ghost removal)
      // If it's a FAIL, it fades faster (2 mins) unless configured otherwise
      const expiry = event.state === 'FAIL' ? 120000 : windowMs;
      
      if (age > expiry && event.state !== 'FAIL') {
        this.events.delete(key);
        continue;
      }
      
      // Separate cleanup for old fails
      if (event.state === 'FAIL' && now - (event.failTime || 0) > expiry) {
          this.events.delete(key);
          continue;
      }

      // Check Active Status
      const justUpdated = (now - event.lastConfirmed) < 500;
      event.isActive = justUpdated;

      // --- STATE MACHINE UPDATE ---
      
      // Transition: HOLDING
      // If it has survived > 2 mins and has multiple confirmations
      if ((event.state === 'STACK' || event.state === 'ABSORPTION') && age > 120000 && event.confirmations > 10) {
          event.state = 'HOLDING';
      }

      // Transition: WEAKENING
      // If current volume drops significantly from peak (< 30%) while still active
      if (event.isActive && event.state === 'HOLDING' && event.volume < (event.peakVolume * 0.3)) {
          event.state = 'WEAKENING';
      }

      // Transition: FAIL (The Big One)
      // Condition: Price breaks through
      const tolerance = lastPrice * 0.0003; 
      const isBreached = (event.side === 'bid' && lastPrice < (event.price - tolerance)) || 
                         (event.side === 'ask' && lastPrice > (event.price + tolerance));

      if (isBreached && !event.isFailed && event.state !== 'BROKEN') {
          
          // STRICT FAIL LOGIC
          // 1. Must have been significant
          const isSignificant = ['STACK', 'ABSORPTION', 'HOLDING', 'WEAKENING'].includes(event.state);
          // 2. Must have duration
          const isMature = age > 60000; // 1 min min
          // 3. Must not be in cooldown (prevent carpet bombing fails)
          const bucket = Math.floor(event.price / 10) * 10; // 10 price unit bucket
          const cooldown = this.failCooldowns.get(bucket) || 0;
          
          if (isSignificant && isMature && now > cooldown) {
               // Calculate Confidence
               const remDrop = 1 - (event.volume / event.peakVolume);
               const conf = this.calculateFailConfidence(event, remDrop, age);
               
               if (conf >= 70) {
                   event.state = 'FAIL';
                   event.type = 'FAIL';
                   event.isFailed = true;
                   event.failTime = now;
                   event.failConfidence = conf;
                   event.remDropRatio = remDrop;
                   
                   // Set Cooldown for this price area (5 mins)
                   this.failCooldowns.set(bucket, now + 300000);
               } else {
                   // If not confident, just mark BROKEN and hide/delete
                   event.state = 'BROKEN';
                   event.isFailed = true;
               }
          } else {
              // Just a break, not a FAIL signal
              event.state = 'BROKEN';
              event.isFailed = true;
          }
      }

      // Retest Logic (Only on valid zones, not FAILs)
      if (!justUpdated && !event.isFailed && age > 60000) {
          const dist = Math.abs(lastPrice - event.price) / lastPrice;
          
          // Increment Failed Pushes if price gets close and moves away
          // This is a heuristic: If we were close (dist < 0.001) and now we are far, did we bounce?
          // Simplification: Just count re-confirmations as "pushes" if time gap exists
          
          if (dist < 0.0005) {
              event.isRetest = true;
          }
      }

      // Decay
      if (event.state !== 'FAIL') {
         const lifeRatio = 1 - (age / windowMs);
         event.strength = Math.max(10, event.strength * lifeRatio);
      }
    }

    // Cleanup Cooldowns
    if (Math.random() > 0.95) {
        for (const [k, t] of this.failCooldowns) {
            if (now > t) this.failCooldowns.delete(k);
        }
    }

    // Return only renderable events (Hide BROKEN)
    return Array.from(this.events.values()).filter(e => e.state !== 'BROKEN');
  }

  private processLevels(levels: EnrichedLevel[], side: 'bid' | 'ask', now: number, lastPrice: number) {
    levels.forEach(lvl => {
        let detectedType: PersistentEventType | null = null;
        let detectionStrength = 0;

        // Basic Detection
        if (lvl.isIceberg) {
            detectedType = 'ICE';
            detectionStrength = 80;
        } else if (lvl.absorption > 1.5) { // Stricter Abs threshold
            detectedType = 'ABSORPTION';
            detectionStrength = 80;
        } else if (lvl.isSpoof) {
            detectedType = 'PULL';
            detectionStrength = 90;
        } else if (lvl.qty * lvl.price > 150000 && lvl.age > 5) { // Large Stack
            detectedType = 'STACK';
            detectionStrength = 60;
        }

        if (detectedType) {
            const id = `${side}-${lvl.price}`;
            const existing = this.events.get(id);

            if (existing) {
                // Cannot update a FAILED zone
                if (existing.state === 'FAIL' || existing.state === 'BROKEN') return;

                // Update Existing
                existing.lastConfirmed = now;
                existing.confirmations += 1;
                existing.volume = lvl.qty; // Current Vol
                existing.peakVolume = Math.max(existing.peakVolume, lvl.qty);
                existing.strength = Math.min(100, existing.strength + 2);
                
                // State Promotion
                if (detectedType === 'ICE' && existing.type !== 'ICE') {
                    existing.type = 'ICE';
                    existing.state = 'STACK'; // Reset to stack/abs flow
                }
                
                // Failed Push detection: If we are revisiting an old level
                if ((now - existing.firstDetected) > 60000 && (now - existing.lastConfirmed) > 10000) {
                     existing.failedPushes += 1;
                }

            } else {
                // Create New
                // Only if price is not already past it (don't create levels behind price)
                const isBehind = side === 'bid' ? lastPrice < lvl.price : lastPrice > lvl.price;
                if (isBehind) return;

                this.events.set(id, {
                    id,
                    type: detectedType,
                    price: lvl.price,
                    side,
                    state: detectedType === 'ABSORPTION' || detectedType === 'ICE' ? 'ABSORPTION' : 'STACK',
                    firstDetected: now,
                    lastConfirmed: now,
                    volume: lvl.qty,
                    peakVolume: lvl.qty,
                    strength: detectionStrength,
                    confirmations: 1,
                    failedPushes: 0,
                    isActive: true,
                    isRetest: false,
                    isFailed: false,
                    failConfidence: 0
                });
            }
        }
    });
  }

  private calculateFailConfidence(event: PersistentEvent, remDrop: number, age: number): number {
      let score = 50; // Base

      // 1. History Strength
      if (event.state === 'HOLDING') score += 20;
      if (event.type === 'ABSORPTION' || event.type === 'ICE') score += 15;
      
      // 2. Longevity
      if (age > 300000) score += 15; // > 5 min
      else if (age < 120000) score -= 10; // < 2 min

      // 3. Liquidity Pull on Break (Spoofing the support)
      // If REM dropped > 50% right before break, it's a pull/fail
      if (remDrop > 0.5) score += 25;
      else if (remDrop < 0.1) score -= 20; // High liquidity remaining means it was chewed through, not failed (Absorbed break)

      // 4. Failed Pushes (Did it hold before?)
      if (event.failedPushes > 2) score += 20;
      else if (event.failedPushes === 0) score -= 15; // First touch break is usually just momentum

      return Math.min(100, Math.max(0, score));
  }
}
