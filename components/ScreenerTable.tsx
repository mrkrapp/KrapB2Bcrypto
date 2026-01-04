import React, { useState, useMemo, useRef, useEffect } from 'react';
import { ScreenerRow, SortConfig, SortDirection } from '../types';
import { ArrowUp, ArrowDown, TrendingUp, ArrowUpDown, ChevronRight, Zap, Star, Filter, Columns, Check } from 'lucide-react';

interface ScreenerTableProps {
  data: ScreenerRow[];
  onSelectSymbol: (symbol: string) => void;
  selectedSymbol: string;
  timeframeLabel: string;
  favorites: Set<string>;
  onToggleFavorite: (symbol: string) => void;
  showFavoritesOnly: boolean;
  onToggleShowFavorites: () => void;
  
  // Column Selection Props
  visibleColumns: {
      trend: boolean;
      lead: boolean;
      fuel: boolean;
      funding: boolean;
      vol24: boolean;
      volTF: boolean;
      chgTF: boolean;
      day: boolean;
      week: boolean;
  };
  onToggleColumn: (key: string) => void;
}

const formatNumber = (num: number, decimals: number = 2) => {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(num);
};

const formatCurrency = (num: number) => {
  if (Math.abs(num) >= 1_000_000_000) return '$' + (num / 1_000_000_000).toFixed(2) + 'B';
  if (Math.abs(num) >= 1_000_000) return '$' + (num / 1_000_000).toFixed(2) + 'M';
  if (Math.abs(num) >= 1_000) return '$' + (num / 1_000).toFixed(1) + 'K';
  return '$' + num.toFixed(0);
};

const formatCompact = (num: number) => {
  if (Math.abs(num) >= 1_000_000) return (num / 1_000_000).toFixed(2) + 'M';
  if (Math.abs(num) >= 1_000) return (num / 1_000).toFixed(2) + 'K';
  return num.toFixed(2);
};

const formatFunding = (rate: number) => {
  const percent = rate * 100;
  return (percent > 0 ? '+' : '') + percent.toFixed(4) + '%';
};

const ScreenerTable: React.FC<ScreenerTableProps> = ({ 
  data, 
  onSelectSymbol, 
  selectedSymbol, 
  timeframeLabel,
  favorites,
  onToggleFavorite,
  showFavoritesOnly,
  onToggleShowFavorites,
  visibleColumns,
  onToggleColumn
}) => {
  const [sortConfig, setSortConfig] = useState<SortConfig>({ key: 'vol24h', direction: 'desc' });
  const [showColMenu, setShowColMenu] = useState(false);
  const colMenuRef = useRef<HTMLDivElement>(null);

  // Close column menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (colMenuRef.current && !colMenuRef.current.contains(event.target as Node)) {
        setShowColMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSort = (key: keyof ScreenerRow) => {
    setSortConfig((current) => {
      if (current.key === key) {
        return { key, direction: current.direction === 'asc' ? 'desc' : 'asc' };
      }
      return { key, direction: 'desc' };
    });
  };

  const processedData = useMemo(() => {
    // 1. Filter
    let filtered = data;
    if (showFavoritesOnly) {
      filtered = data.filter(r => favorites.has(r.symbol));
    }

    // 2. Sort
    const sorted = [...filtered];
    sorted.sort((a, b) => {
      const aFav = favorites.has(a.symbol) ? 1 : 0;
      const bFav = favorites.has(b.symbol) ? 1 : 0;
      
      if (aFav !== bFav) return bFav - aFav;

      const aValue = a[sortConfig.key];
      const bValue = b[sortConfig.key];

      if (typeof aValue === 'string' && typeof bValue === 'string') {
        return sortConfig.direction === 'asc' 
          ? aValue.localeCompare(bValue) 
          : bValue.localeCompare(aValue);
      }

      if (typeof aValue === 'number' && typeof bValue === 'number') {
         return sortConfig.direction === 'asc' ? aValue - bValue : bValue - aValue;
      }
      return 0;
    });
    return sorted;
  }, [data, sortConfig, favorites, showFavoritesOnly]);

  const renderSortIcon = (key: keyof ScreenerRow) => {
    if (sortConfig.key !== key) return <ArrowUpDown size={10} className="ml-1 opacity-20" />;
    return sortConfig.direction === 'asc' ? <ArrowUp size={10} className="ml-1 text-blue-500" /> : <ArrowDown size={10} className="ml-1 text-blue-500" />;
  };

  const Th = ({ k, label, align = 'right', visible = true }: { k: keyof ScreenerRow, label: string, align?: 'left'|'right'|'center', visible?: boolean }) => {
    if (!visible) return null;
    return (
      <th 
        className={`px-3 py-3 cursor-pointer hover:text-white transition-colors select-none text-${align} whitespace-nowrap`}
        onClick={() => handleSort(k)}
      >
        <div className={`flex items-center gap-1 ${align === 'right' ? 'justify-end' : align === 'center' ? 'justify-center' : 'justify-start'}`}>
          {label}
          {renderSortIcon(k)}
        </div>
      </th>
    );
  };

  const colLabels: Record<string, string> = {
      trend: "Trend",
      lead: "Lead Market",
      fuel: "Fuel (Net Flow)",
      funding: "Funding Rate",
      vol24: "24h Volume",
      volTF: `Vol ${timeframeLabel}`,
      chgTF: `Chg ${timeframeLabel}`,
      day: "24h Change",
      week: "7d Change"
  };

  return (
    <div className="bg-[#0d1117] rounded-xl border border-gray-800/50 overflow-hidden shadow-2xl flex flex-col h-full">
      <div className="p-4 border-b border-gray-800/50 flex justify-between items-center bg-[#0d1117]">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-gray-200 mr-2">
            Binance Futures
          </h3>
          <button 
            onClick={onToggleShowFavorites}
            className={`flex items-center gap-1.5 px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wide border transition-all ${showFavoritesOnly ? 'bg-yellow-500/20 border-yellow-500 text-yellow-500' : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-gray-200'}`}
          >
            <Filter size={10} />
            {showFavoritesOnly ? 'Favorites' : 'All'}
          </button>
          
          {/* Column Selector */}
          <div className="relative" ref={colMenuRef}>
            <button 
                onClick={() => setShowColMenu(!showColMenu)}
                className={`flex items-center gap-1.5 px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wide border transition-all ${showColMenu ? 'bg-blue-600/20 border-blue-500 text-blue-400' : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-gray-200'}`}
            >
                <Columns size={10} />
                Cols
            </button>
            
            {showColMenu && (
                <div className="absolute top-full left-0 mt-2 w-48 bg-gray-900 border border-gray-700 rounded-lg shadow-xl z-50 overflow-hidden animate-in fade-in slide-in-from-top-2">
                    <div className="p-2 space-y-0.5">
                        {Object.entries(colLabels).map(([key, label]) => (
                            <button
                                key={key}
                                onClick={() => onToggleColumn(key)}
                                className="w-full flex items-center justify-between px-3 py-2 text-xs text-left rounded hover:bg-gray-800 text-gray-300 transition-colors"
                            >
                                <span>{label}</span>
                                {visibleColumns[key as keyof typeof visibleColumns] && <Check size={12} className="text-blue-500" />}
                            </button>
                        ))}
                    </div>
                </div>
            )}
          </div>
        </div>
        <span className="text-xs text-gray-500 font-mono px-2 py-1 bg-gray-900 rounded border border-gray-800">
          {processedData.length}
        </span>
      </div>
      
      <div className="overflow-x-auto overflow-y-auto scrollbar-thin scrollbar-thumb-gray-800 scrollbar-track-transparent flex-1">
        <table className="w-full text-sm text-left relative border-collapse">
          <thead className="bg-[#0d1117] text-gray-500 uppercase font-bold text-[10px] tracking-wider sticky top-0 z-10 shadow-[0_1px_0_0_rgba(31,41,55,0.5)]">
            <tr>
              <th className="w-8 px-2 py-3 text-center">
                 <Star size={10} className="mx-auto" />
              </th>
              <Th k="symbol" label="Symbol" align="left" />
              
              <Th k="trendStrength" label="Trend" align="center" visible={visibleColumns.trend} />
              
              {visibleColumns.lead && <th className="px-3 py-3 text-center cursor-default">LEAD</th>}
              
              <Th k="netInflow" label="Fuel" align="right" visible={visibleColumns.fuel} />
              <Th k="fundingRate" label="Funding" visible={visibleColumns.funding} />
              <Th k="vol24h" label="Vol 24h" visible={visibleColumns.vol24} />
              
              {/* Dynamic Columns */}
              <Th k="tfVolume" label={`Vol ${timeframeLabel}`} visible={visibleColumns.volTF} />
              <Th k="tfChange" label={`Chg ${timeframeLabel}`} visible={visibleColumns.chgTF} />
              
              <Th k="chg24h" label="Day" visible={visibleColumns.day} />
              <Th k="weekChange" label="Week" visible={visibleColumns.week} />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800/30">
            {processedData.map((row) => {
              const isFav = favorites.has(row.symbol);
              return (
                <tr 
                  key={row.symbol}
                  className={`group hover:bg-gray-900/50 cursor-pointer transition-colors duration-150 ${selectedSymbol === row.symbol ? 'bg-blue-900/10' : ''}`}
                  onClick={() => onSelectSymbol(row.symbol)}
                >
                  {/* Star Icon (Toggle) */}
                  <td className="px-2 py-3 text-center" onClick={(e) => { e.stopPropagation(); onToggleFavorite(row.symbol); }}>
                     <Star 
                       size={14} 
                       className={`mx-auto transition-all hover:scale-110 ${isFav ? 'text-yellow-400 fill-yellow-400' : 'text-gray-700 hover:text-gray-400'}`} 
                     />
                  </td>

                  {/* Symbol */}
                  <td className="px-3 py-3 font-bold text-gray-200">
                    <div className="flex flex-col">
                      <span className="text-sm tracking-tight">{row.symbol.replace('USDT', '')}<span className="text-gray-500 font-normal">USDT</span></span>
                      <span className="text-[9px] text-gray-500 font-mono mt-0.5">PERP</span>
                    </div>
                  </td>

                  {/* Trend Strength */}
                  {visibleColumns.trend && (
                      <td className="px-3 py-3">
                          <div className="flex items-center justify-center">
                              <span className={`text-xs font-mono font-bold ${row.trendStrength > 50 ? 'text-blue-400' : 'text-gray-500'}`}>{row.trendStrength.toFixed(1)}</span>
                          </div>
                      </td>
                  )}
                  
                  {/* Lead Market (Heuristic) */}
                  {visibleColumns.lead && (
                      <td className="px-3 py-3 text-center">
                        <div className="flex justify-center gap-1">
                            <span className={`text-[9px] px-1 rounded font-bold ${row.fundingRate > 0.005 ? 'bg-purple-900/30 text-purple-400 border border-purple-800' : 'text-gray-700 opacity-20'}`}>FUT</span>
                        </div>
                      </td>
                  )}

                  {/* Fuel Injection (Net Flow) */}
                  {visibleColumns.fuel && (
                      <td className="px-3 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                            {row.netInflow > 0 && <Zap size={10} className="text-yellow-500 fill-yellow-500 animate-pulse" />}
                            <span className={`font-mono text-xs ${row.netInflow > 0 ? 'text-green-400' : 'text-red-400'}`}>
                              {formatCurrency(row.netInflow)}
                            </span>
                        </div>
                      </td>
                  )}

                  {/* Funding */}
                  {visibleColumns.funding && (
                      <td className={`px-3 py-3 text-right font-mono text-xs font-medium ${row.fundingRate > 0.005 ? 'text-green-400' : row.fundingRate < 0 ? 'text-red-400' : 'text-gray-400'}`}>
                        {formatFunding(row.fundingRate)}
                      </td>
                  )}

                  {/* Vol 24h */}
                  {visibleColumns.vol24 && (
                      <td className="px-3 py-3 text-right text-gray-300 font-mono text-xs">
                        {formatCompact(row.vol24h)}
                      </td>
                  )}
                  
                  {/* Dynamic Vol */}
                  {visibleColumns.volTF && (
                      <td className="px-3 py-3 text-right text-gray-400 font-mono text-xs">
                        {formatCompact(row.tfVolume)}
                      </td>
                  )}

                  {/* Dynamic Change */}
                  {visibleColumns.chgTF && (
                      <td className={`px-3 py-3 text-right font-mono text-xs ${row.tfChange >= 0 ? 'text-green-500/80' : 'text-red-500/80'}`}>
                        {row.tfChange > 0 ? '+' : ''}{row.tfChange.toFixed(2)}%
                      </td>
                  )}

                  {/* Day (24h Chg) */}
                  {visibleColumns.day && (
                      <td className={`px-3 py-3 text-right font-bold font-mono text-xs ${row.chg24h >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {row.chg24h > 0 ? '+' : ''}{row.chg24h.toFixed(2)}%
                      </td>
                  )}

                  {/* Week (7d Chg) */}
                  {visibleColumns.week && (
                      <td className={`px-3 py-3 text-right font-bold font-mono text-xs ${row.weekChange >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {row.weekChange > 0 ? '+' : ''}{row.weekChange.toFixed(2)}%
                      </td>
                  )}
                </tr>
              );
            })}
            {processedData.length === 0 && (
              <tr>
                <td colSpan={14} className="p-12 text-center text-gray-500">
                   {showFavoritesOnly ? 'No favorites selected. Click the star icon to pin.' : 'Loading data...'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default ScreenerTable;