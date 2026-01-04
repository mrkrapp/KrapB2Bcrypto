import React from 'react';
import { HFTCard } from './HFTCard';

interface HFTEngineProps {
  activeSymbols: string[];
}

const HFTEngine: React.FC<HFTEngineProps> = ({ activeSymbols }) => {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {activeSymbols.map(symbol => (
        <HFTCard key={symbol} symbol={symbol} />
      ))}
      
      {/* Add Button Placeholder (Visual only) */}
      <div className="border border-dashed border-gray-800 rounded-lg flex flex-col items-center justify-center p-8 text-gray-600 hover:text-gray-400 hover:border-gray-600 cursor-pointer transition-colors min-h-[400px]">
        <span className="text-4xl mb-2">+</span>
        <span className="text-xs uppercase tracking-widest">Add Symbol</span>
      </div>
    </div>
  );
};

export default HFTEngine;