
import React, { useEffect, useRef, useState, useMemo } from 'react';
import { subscribeToOrderFlow } from '../services/marketData';
import { OrderBookLevel, Trade, EnrichedLevel, PersistentEvent, PersistenceWindow } from '../types';
import { analyzeDOM } from '../utils/domAnalytics';
import { EventEngine } from '../utils/eventEngine';
import Tape from './Tape';
import VerticalDOM from './VerticalDOM';
import OrderBookDelta from './OrderBookDelta';
import { Filter, Layers, Zap, Thermometer, Shield, BarChart2, Clock, History, Trash2 } from 'lucide-react';

interface OrderFlowDashboardProps {
  symbol: string;
}

const OrderFlowDashboard: React.FC<OrderFlowDashboardProps> = ({ symbol }) => {
  
  // --- State Buffers ---
  const tradesBuffer = useRef<Trade[]>([]);
  const rawBidsRef = useRef<OrderBookLevel[]>([]);
  const rawAsksRef = useRef<OrderBookLevel[]>([]);
  
  // Historical State for Analytics
  const prevBidsState = useRef<Map<number, EnrichedLevel>>(new Map());
  const prevAsksState = useRef<Map<number, EnrichedLevel>>(new Map());

  // --- Persistent Event Engine ---
  const eventEngine = useRef(new EventEngine());

  // UI State
  const [trades, setTrades] = useState<Trade[]>([]);
  const [bids, setBids] = useState<EnrichedLevel[]>([]);
  const [asks, setAsks] = useState<EnrichedLevel[]>([]);
  const [lastPrice, setLastPrice] = useState(0);
  const [persistentEvents, setPersistentEvents] = useState<PersistentEvent[]>([]);

  // Filters & Config
  const [filterThreshold, setFilterThreshold] = useState(0); 
  const [showIcebergs, setShowIcebergs] = useState(true);
  const [view, setView] = useState<'dom' | 'delta'>('dom');
  const [persistenceWindow, setPersistenceWindow] = useState<PersistenceWindow>(30);
  const [showHistorical, setShowHistorical] = useState(true);
  
  // Computed Stats
  const spread = useMemo(() => {
      if (bids.length > 0 && asks.length > 0) {
          const bestBid = rawBidsRef.current[0]?.price || 0;
          const bestAsk = rawAsksRef.current[0]?.price || 0;
          return Math.abs(bestAsk - bestBid);
      }
      return 0;
  }, [bids, asks]);

  // Update Engine Config
  useEffect(() => {
    eventEngine.current.setWindow(persistenceWindow);
  }, [persistenceWindow]);

  useEffect(() => {
    // Reset buffers when symbol changes
    tradesBuffer.current = [];
    rawBidsRef.current = [];
    rawAsksRef.current = [];
    prevBidsState.current.clear();
    prevAsksState.current.clear();
    // Note: We might want to keep events across symbol changes? No, clear them.
    eventEngine.current = new EventEngine();
    eventEngine.current.setWindow(persistenceWindow);

    const unsubscribe = subscribeToOrderFlow(
      symbol,
      (newTrade) => {
        setLastPrice(newTrade.price);
        tradesBuffer.current.unshift(newTrade);
        if (tradesBuffer.current.length > 500) tradesBuffer.current.pop();
      },
      (newBids, newAsks) => {
        rawBidsRef.current = newBids;
        rawAsksRef.current = newAsks;
      }
    );

    // --- Analytics Loop (100ms) ---
    const interval = setInterval(() => {
        const now = Date.now();
        const recentTrades = tradesBuffer.current.filter(t => (now - t.time) < 1500); 

        // 1. Instant Analysis
        const enrichedBids = analyzeDOM(rawBidsRef.current, prevBidsState.current, recentTrades, 'bid');
        const enrichedAsks = analyzeDOM(rawAsksRef.current, prevAsksState.current, recentTrades, 'ask');

        prevBidsState.current = new Map(enrichedBids.map(l => [l.price, l]));
        prevAsksState.current = new Map(enrichedAsks.map(l => [l.price, l]));

        // 2. Persistent Engine Update
        const events = eventEngine.current.process(enrichedBids, enrichedAsks, rawBidsRef.current[0]?.price || 0);

        setTrades([...tradesBuffer.current]);
        setBids(enrichedBids);
        setAsks(enrichedAsks);
        setPersistentEvents(events);

    }, 100);

    return () => {
        unsubscribe();
        clearInterval(interval);
    };
  }, [symbol]);

  return (
    <div className="flex h-[calc(100vh-140px)] gap-1 bg-[#0d1117] overflow-hidden">
        {/* Left Toolbar */}
        <div className="w-12 border-r border-gray-800 flex flex-col items-center py-4 gap-4 bg-[#0b0e11]">
             <button 
                className={`p-2 rounded-lg transition-all ${view === 'dom' ? 'bg-blue-600/20 text-blue-500' : 'text-gray-600 hover:text-gray-400'}`}
                onClick={() => setView('dom')}
                title="Depth of Market"
             >
                 <Layers size={20} />
             </button>

             <button 
                className={`p-2 rounded-lg transition-all ${view === 'delta' ? 'bg-purple-600/20 text-purple-400' : 'text-gray-600 hover:text-gray-400'}`}
                onClick={() => setView('delta')}
                title="Order Book Delta"
             >
                 <BarChart2 size={20} />
             </button>
             
             <div className="w-8 h-[1px] bg-gray-800 my-1"></div>

             <button 
                className={`p-2 rounded-lg transition-all ${filterThreshold > 0 ? 'bg-yellow-500/20 text-yellow-500 shadow-[0_0_10px_rgba(234,179,8,0.2)]' : 'text-gray-600 hover:text-gray-400'}`}
                onClick={() => setFilterThreshold(filterThreshold === 0 ? 10000 : 0)} 
                title="Whale Filter"
             >
                 <Filter size={20} />
                 <span className="text-[8px] font-bold block mt-1">BIG</span>
             </button>

             <button 
                className={`p-2 rounded-lg transition-all ${showIcebergs ? 'bg-cyan-500/20 text-cyan-400 shadow-[0_0_10px_rgba(34,211,238,0.2)]' : 'text-gray-600 hover:text-gray-400'}`}
                onClick={() => setShowIcebergs(!showIcebergs)}
                title="Iceberg Detection"
             >
                 <Shield size={20} />
                 <span className="text-[8px] font-bold block mt-1">ICE</span>
             </button>

             <div className="w-8 h-[1px] bg-gray-800 my-1"></div>
             
             {/* Event Persistence Controls */}
             <div className="flex flex-col gap-2 items-center">
                 <button 
                    onClick={() => setShowHistorical(!showHistorical)}
                    className={`p-2 rounded-lg transition-all ${showHistorical ? 'bg-orange-600/20 text-orange-400' : 'text-gray-600'}`}
                    title="Show Historical Events"
                 >
                     <History size={20} />
                 </button>

                 <button 
                    onClick={() => setPersistenceWindow(prev => prev === 15 ? 30 : prev === 30 ? 60 : 15)}
                    className="flex flex-col items-center justify-center p-1 rounded-lg hover:bg-gray-800 text-gray-500 font-mono"
                    title="Persistence Window"
                 >
                     <Clock size={16} />
                     <span className="text-[9px] font-bold mt-1">{persistenceWindow}m</span>
                 </button>
                 
                 <button
                    onClick={() => { eventEngine.current = new EventEngine(); eventEngine.current.setWindow(persistenceWindow); }}
                    className="p-2 rounded-lg hover:bg-red-900/20 text-gray-600 hover:text-red-400"
                    title="Clear Events"
                 >
                    <Trash2 size={16} />
                 </button>
             </div>
        </div>

        {/* Center Panel */}
        <div className="flex-1 relative border-r border-gray-800 bg-[#0d1117]">
            {/* DOM View */}
            <div className={`absolute inset-0 z-10 ${view === 'dom' ? 'visible pointer-events-auto' : 'invisible pointer-events-none'}`}>
                <VerticalDOM 
                    bids={bids} 
                    asks={asks} 
                    lastPrice={lastPrice} 
                    filterThreshold={filterThreshold} 
                    showIcebergs={showIcebergs}
                    spread={spread}
                    events={showHistorical ? persistentEvents : []}
                />
            </div>

            {/* Delta View */}
            <div className={`absolute inset-0 z-10 ${view === 'delta' ? 'visible pointer-events-auto' : 'invisible pointer-events-none'}`}>
                <OrderBookDelta 
                    bids={bids}
                    asks={asks}
                    symbol={symbol}
                    lastPrice={lastPrice}
                    trades={trades}
                />
            </div>
        </div>

        {/* Tape */}
        <div className="w-72 bg-[#0b0e11]">
             <Tape trades={trades} />
        </div>
    </div>
  );
};

export default OrderFlowDashboard;
