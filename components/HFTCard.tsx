
import React, { useEffect, useRef, useState, useMemo } from 'react';
import { Activity, Clock, AlertTriangle, Zap, Droplets, Skull, Wind, Layers } from 'lucide-react';

interface HFTCardProps {
  symbol: string;
}

const MAX_HISTORY = 50;

type HFTState = 
  | 'QUIET' 
  | 'FLOW_BUILDING' 
  | 'AGGRESSIVE_INITIATION' 
  | 'ABSORPTION' 
  | 'TOXIC_FLOW' 
  | 'LIQUIDITY_VACUUM';

export const HFTCard: React.FC<HFTCardProps> = ({ symbol }) => {
  // --- Raw Metric State ---
  const [price, setPrice] = useState<number>(0);
  const [currentTps, setCurrentTps] = useState(0);
  const [currentImbalance, setCurrentImbalance] = useState(0);
  const [buyPressure, setBuyPressure] = useState(0); // -1 to 1
  const [toxicity, setToxicity] = useState(0); // 0 to 1

  // --- HFT Context State ---
  const [hftState, setHftState] = useState<HFTState>('QUIET');
  const [stateDuration, setStateDuration] = useState(0); // ms
  
  // Refs for accumulation & State Logic
  const stateRef = useRef<{ state: HFTState; start: number }>({ state: 'QUIET', start: Date.now() });
  const tradeCountRef = useRef(0);
  const buyVolRef = useRef(0);
  const sellVolRef = useRef(0);
  const largeOrderCountRef = useRef(0);
  const totalOrderCountRef = useRef(0);

  // --- WebSockets ---
  useEffect(() => {
    // 1. Aggregated Trades Stream
    const wsTrade = new WebSocket(`wss://fstream.binance.com/ws/${symbol.toLowerCase()}@aggTrade`);
    
    wsTrade.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      const p = parseFloat(msg.p);
      const q = parseFloat(msg.q);
      const isMarketMaker = msg.m; 

      setPrice(p);
      
      // Update Counters
      tradeCountRef.current += 1;
      totalOrderCountRef.current += 1;

      const usdValue = p * q;
      if (usdValue > 10000) largeOrderCountRef.current += 1;

      if (isMarketMaker) sellVolRef.current += q;
      else buyVolRef.current += q;
    };

    // 2. Depth Stream (Imbalance)
    const wsDepth = new WebSocket(`wss://fstream.binance.com/ws/${symbol.toLowerCase()}@depth5@100ms`);
    
    wsDepth.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      const bidVol = msg.b.reduce((acc: number, item: string[]) => acc + parseFloat(item[1]), 0);
      const askVol = msg.a.reduce((acc: number, item: string[]) => acc + parseFloat(item[1]), 0);
      
      const total = bidVol + askVol;
      if (total > 0) {
        // Imbalance = (Bid - Ask) / Total -> -1 to 1
        setCurrentImbalance((bidVol - askVol) / total);
      }
    };

    // --- The HFT Brain (500ms Tick) ---
    const interval = setInterval(() => {
      // 1. Calculate Raw Metrics
      const instantTps = tradeCountRef.current * 2; // Trades per sec
      setCurrentTps(prev => prev * 0.7 + instantTps * 0.3); // Smooth
      tradeCountRef.current = 0; 

      const bV = buyVolRef.current;
      const sV = sellVolRef.current;
      const totalVol = bV + sV;
      let pressure = 0;
      if (totalVol > 0) pressure = (bV - sV) / totalVol; // -1 to 1
      setBuyPressure(prev => prev * 0.8 + pressure * 0.2); // Decay
      
      buyVolRef.current = 0;
      sellVolRef.current = 0;

      const orders = totalOrderCountRef.current;
      const large = largeOrderCountRef.current;
      let tox = 0;
      if (orders > 0) tox = large / orders;
      const normalizedTox = Math.min(tox * 5, 1.0); 
      setToxicity(prev => prev * 0.8 + normalizedTox * 0.2);
      
      largeOrderCountRef.current = 0;
      totalOrderCountRef.current = 0;

      // 2. Derive HFT State
      let newState: HFTState = 'QUIET';
      const tps = currentTps; // Use somewhat smoothed TPS for stability
      const absPressure = Math.abs(buyPressure);
      const absImbalance = Math.abs(currentImbalance);

      if (normalizedTox > 0.6) {
          newState = 'TOXIC_FLOW';
      } else if (absImbalance > 0.65 && tps < 5) {
          newState = 'LIQUIDITY_VACUUM';
      } else if (tps > 25) {
          if (absPressure > 0.4) newState = 'AGGRESSIVE_INITIATION';
          else newState = 'ABSORPTION';
      } else if (tps > 10) {
          newState = 'FLOW_BUILDING';
      } else {
          newState = 'QUIET';
      }

      // 3. Handle Persistence (State Stability)
      const now = Date.now();
      if (newState !== stateRef.current.state) {
          // Add a small hysteresis/debounce logic could go here, but for now strict switch
          stateRef.current = { state: newState, start: now };
          setHftState(newState);
      }
      setStateDuration(now - stateRef.current.start);

    }, 500);

    return () => {
      wsTrade.close();
      wsDepth.close();
      clearInterval(interval);
    };
  }, [symbol, currentTps, buyPressure, currentImbalance]); // Deps for state calculation context

  // --- Semantic Helpers ---

  const formatDuration = (ms: number) => {
      if (ms < 1000) return '0s';
      if (ms < 60000) return `${(ms/1000).toFixed(0)}s`;
      return `${(ms/60000).toFixed(1)}m`;
  };

  const getTpsSemantics = (val: number) => {
      if (val < 5) return { label: 'Low', color: 'text-gray-500' };
      if (val < 20) return { label: 'Elevated', color: 'text-blue-400' };
      return { label: 'Extreme', color: 'text-purple-400' };
  };

  const tpsMeta = getTpsSemantics(currentTps);

  const getFlowQuality = () => {
      if (toxicity > 0.5) return { label: 'Toxic', color: 'text-orange-500', bg: 'bg-orange-900/20' };
      if (Math.abs(buyPressure) > 0.5 && toxicity < 0.2) return { label: 'Clean', color: 'text-emerald-500', bg: 'bg-emerald-900/20' };
      return { label: 'Mixed', color: 'text-gray-400', bg: 'bg-gray-800' };
  };

  const flowQuality = getFlowQuality();

  const getStateStyle = (s: HFTState) => {
      switch(s) {
          case 'AGGRESSIVE_INITIATION': return { color: 'text-emerald-400', icon: <Zap size={14} />, border: 'border-emerald-500/50' };
          case 'ABSORPTION': return { color: 'text-purple-400', icon: <Layers size={14} />, border: 'border-purple-500/50' };
          case 'TOXIC_FLOW': return { color: 'text-orange-500', icon: <Skull size={14} />, border: 'border-orange-500/50' };
          case 'LIQUIDITY_VACUUM': return { color: 'text-red-400', icon: <Wind size={14} />, border: 'border-red-500/50' };
          case 'FLOW_BUILDING': return { color: 'text-blue-400', icon: <Activity size={14} />, border: 'border-blue-500/50' };
          default: return { color: 'text-gray-500', icon: <Clock size={14} />, border: 'border-gray-700' };
      }
  };

  const stateStyle = getStateStyle(hftState);

  return (
    <div className="bg-[#0b0e11] border border-gray-800 rounded-xl p-4 flex flex-col gap-4 relative overflow-hidden transition-all hover:border-gray-700 h-[220px]">
      
      {/* 1. Identity & Price */}
      <div className="flex justify-between items-start">
        <div>
          <h3 className="text-sm font-bold text-gray-200 flex items-center gap-2">
            {symbol.replace('USDT', '')}
          </h3>
          <div className="text-xs text-gray-500 font-mono mt-0.5">${price.toFixed(price < 1 ? 4 : 2)}</div>
        </div>
        
        {/* HFT STATE BADGE (Center of Attention) */}
        <div className={`px-2 py-1 rounded border flex items-center gap-2 ${stateStyle.border} bg-gray-900/50`}>
            <span className={stateStyle.color}>{stateStyle.icon}</span>
            <span className={`text-[10px] font-bold uppercase tracking-wide ${stateStyle.color}`}>
                {hftState.replace('_', ' ')}
            </span>
        </div>
      </div>

      {/* 2. Primary Context: Activity & Persistence */}
      <div className="grid grid-cols-2 gap-2 bg-gray-900/30 rounded-lg p-2 border border-gray-800/50">
          <div className="flex flex-col">
              <span className="text-[9px] text-gray-500 uppercase font-bold">Activity (TPS)</span>
              <div className="flex items-baseline gap-1.5 mt-0.5">
                  <span className={`text-sm font-mono font-bold ${tpsMeta.color}`}>{tpsMeta.label}</span>
                  <span className="text-[10px] text-gray-600 font-mono">({currentTps.toFixed(0)})</span>
              </div>
          </div>
          <div className="flex flex-col items-end">
              <span className="text-[9px] text-gray-500 uppercase font-bold">State Duration</span>
              <div className="flex items-center gap-1 mt-0.5">
                  <Clock size={10} className="text-gray-600" />
                  <span className="text-sm font-mono font-bold text-gray-300">
                      {formatDuration(stateDuration)}
                  </span>
              </div>
          </div>
      </div>

      {/* 3. Secondary Context: Imbalance & Flow Quality */}
      <div className="grid grid-cols-2 gap-4 mt-1">
          {/* Imbalance (Directional) */}
          <div className="flex flex-col gap-1">
              <div className="flex justify-between items-center">
                  <span className="text-[9px] text-gray-500 uppercase font-bold">Imbalance</span>
                  <span className={`text-[9px] font-mono font-bold ${currentImbalance > 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {Math.abs(currentImbalance).toFixed(2)} {currentImbalance > 0 ? 'BID' : 'ASK'}
                  </span>
              </div>
              <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden flex relative">
                  <div className="absolute left-1/2 top-0 bottom-0 w-[1px] bg-gray-600 z-10"></div>
                  <div 
                    className={`h-full transition-all duration-300 ${currentImbalance > 0 ? 'bg-green-500 origin-left' : 'bg-red-500 origin-right'}`}
                    style={{ 
                        width: `${Math.abs(currentImbalance) * 50}%`,
                        marginLeft: currentImbalance > 0 ? '50%' : `${(1 - Math.abs(currentImbalance)) * 50}%`
                    }}
                  />
              </div>
          </div>

          {/* Flow Quality (Composite) */}
          <div className="flex flex-col gap-1">
               <div className="flex justify-between items-center">
                  <span className="text-[9px] text-gray-500 uppercase font-bold">Flow Quality</span>
                  <span className={`text-[9px] font-bold ${flowQuality.color}`}>{flowQuality.label}</span>
               </div>
               
               {/* Visual Quality Bar */}
               <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden flex">
                    {/* Pressure (Green/Red) */}
                    <div className={`h-full transition-all duration-500 ${buyPressure > 0 ? 'bg-emerald-500' : 'bg-rose-500'}`} style={{ width: `${Math.abs(buyPressure) * 100}%` }}></div>
                    {/* Toxicity (Orange overlay) - Not perfect physics but visualizes contamination */}
                    <div className="h-full bg-orange-500 opacity-80" style={{ width: `${toxicity * 100}%` }}></div>
               </div>
          </div>
      </div>

    </div>
  );
};
