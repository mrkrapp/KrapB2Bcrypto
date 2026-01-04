import React, { useEffect, useRef, useState } from 'react';
import { Trade } from '../types';
import { ArrowDown, ArrowUp } from 'lucide-react';

interface TapeProps {
  trades: Trade[];
}

const Tape: React.FC<TapeProps> = ({ trades }) => {
  // Using a virtualized-like list logic: only render last 50
  // Note: 'trades' prop coming in is already managed/buffered by parent
  
  return (
    <div className="flex flex-col h-full bg-[#0d1117] border-l border-gray-800 w-64">
      <div className="px-3 py-2 border-b border-gray-800 bg-gray-900/50 flex justify-between items-center">
        <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Time & Sales</span>
        <span className="text-[10px] text-gray-600 font-mono">LIVE</span>
      </div>
      
      <div className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-gray-800">
        <div className="flex flex-col">
          {trades.length === 0 && <div className="p-4 text-center text-xs text-gray-600">Waiting for trades...</div>}
          {trades.map((trade) => {
            const sideColor = trade.isBuyerMaker ? 'text-red-500' : 'text-green-500';
            const bgClass = trade.isLarge 
              ? trade.isBuyerMaker ? 'bg-red-900/20' : 'bg-green-900/20' 
              : '';
            
            return (
              <div 
                key={trade.id} 
                className={`flex items-center justify-between px-3 py-0.5 text-[11px] font-mono border-b border-gray-800/30 ${bgClass}`}
              >
                <div className="flex items-center gap-2 w-20">
                    <span className="text-gray-500">{new Date(trade.time).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute:'2-digit', second:'2-digit' })}</span>
                </div>
                <div className={`flex-1 text-right ${sideColor} font-medium`}>
                   {trade.price.toFixed(2)}
                </div>
                <div className={`w-16 text-right ${trade.isLarge ? 'font-bold text-white' : 'text-gray-400'}`}>
                   {trade.qty.toFixed(trade.qty < 1 ? 4 : 2)}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default Tape;