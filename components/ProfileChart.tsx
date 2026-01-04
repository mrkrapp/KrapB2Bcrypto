
import React, { useEffect, useRef, useState, useMemo } from 'react';
import * as d3 from 'd3';
import { Candle, ProfileMetrics, OrderBlock, DrawingLine, SessionLevels, AuctionContext, CVDState } from '../types';
import { ZoomOut, Layers, Activity, Zap, TrendingUp, TrendingDown, Target, AlertTriangle } from 'lucide-react';
import { enrichCandlesWithContext, calculateSessionLevels, calculateAuctionContext, determineCVDState } from '../utils/analytics';

interface ProfileChartProps {
  candles: Candle[];
  profile: ProfileMetrics;
  orderBlocks?: OrderBlock[];
  width?: number;
  height?: number;
  showVolume?: boolean;
  showOrderBlocks?: boolean;
}

const ProfileChart: React.FC<ProfileChartProps> = ({ 
  candles: rawCandles, 
  profile, 
  orderBlocks = [], 
  width = 1000, 
  height = 500,
  showVolume = true,
  showOrderBlocks = true
}) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  
  // 1. Data Processing
  const candles = useMemo(() => enrichCandlesWithContext(rawCandles), [rawCandles]);
  const sessionLevels = useMemo(() => calculateSessionLevels(candles), [candles]);
  
  // 2. State & Context Stability Logic
  // We use a Ref to store the "Stable State" to prevent flickering
  const lastPrice = candles.length > 0 ? candles[candles.length - 1].close : 0;
  const stableContext = useRef<AuctionContext>({ mode: 'BALANCED', confidence: 0, scenario: '', bias: 'neutral' });
  const lastStateChange = useRef<number>(0);
  
  // Compute Current Instant State
  const instantContext = useMemo(() => 
     calculateAuctionContext(lastPrice, profile, sessionLevels.vwap || lastPrice, candles.slice(-20)), 
  [lastPrice, profile, sessionLevels.vwap, candles]);
  
  // Apply Stability Rule (State lock for 2 seconds unless confidence is super high)
  const now = Date.now();
  if (instantContext.mode !== stableContext.current.mode) {
      if (now - lastStateChange.current > 2000 || instantContext.confidence > 80) {
          stableContext.current = instantContext;
          lastStateChange.current = now;
      }
  } else {
      // Always update confidence/scenario if mode is same
      stableContext.current = instantContext;
  }
  
  const auctionContext = stableContext.current;
  const cvdState: CVDState = useMemo(() => determineCVDState(candles), [candles]);

  // Interaction State
  const [mousePos, setMousePos] = useState<{x: number, y: number} | null>(null);
  const [hoverData, setHoverData] = useState<Candle | null>(null);

  // Layers Visibility
  const [layers, setLayers] = useState({
    vwap: true,
    delta: true,
    profile: true,
    levels: true,
    divergences: true
  });

  const transformRef = useRef<d3.ZoomTransform>(d3.zoomIdentity);

  // Layout Constants
  const DELTA_PANEL_HEIGHT = 100;
  const margin = { top: 60, right: 90, bottom: 20, left: 10 }; // Top margin increased for Header
  const mainHeight = height - margin.top - margin.bottom - (layers.delta ? DELTA_PANEL_HEIGHT + 10 : 0);
  const plotWidth = width - margin.left - margin.right;
  const deltaTop = margin.top + mainHeight + 10;

  // --- D3 Render Effect ---
  useEffect(() => {
    if (!svgRef.current || candles.length === 0) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll(".chart-content").remove(); 
    
    // Clip Path
    if (svg.select("#clip").empty()) {
       svg.append("defs").append("clipPath")
        .attr("id", "clip")
        .append("rect")
        .attr("width", plotWidth)
        .attr("height", mainHeight);
       
       svg.select("defs").append("clipPath")
        .attr("id", "clip-delta")
        .append("rect")
        .attr("width", plotWidth)
        .attr("height", DELTA_PANEL_HEIGHT);
    }

    // --- Scales ---
    const xMin = d3.min(candles, d => d.timestamp) || 0;
    const xMax = d3.max(candles, d => d.timestamp) || 0;
    const timePadding = (xMax - xMin) * 0.05; 
    
    const xScale = d3.scaleTime()
      .domain([new Date(xMin), new Date(xMax + timePadding)]) 
      .range([0, plotWidth]);

    const yMin = d3.min(candles, d => d.low) || 0;
    const yMax = d3.max(candles, d => d.high) || 0;
    const yRange = yMax - yMin;
    const yPadding = yRange * 0.1;

    const yScale = d3.scaleLinear()
      .domain([yMin - yPadding, yMax + yPadding])
      .range([mainHeight, 0]);

    // Delta Scales
    const deltaMax = d3.max(candles, d => Math.abs(d.delta || 0)) || 1;
    const deltaScale = d3.scaleLinear()
        .domain([-deltaMax, deltaMax])
        .range([DELTA_PANEL_HEIGHT, 0]);

    const cvdExtent = d3.extent(candles, d => d.cvd || 0) as [number, number];
    const cvdScale = d3.scaleLinear()
        .domain(cvdExtent)
        .range([DELTA_PANEL_HEIGHT, 0]);

    // --- Main Group ---
    const g = svg.append("g")
      .attr("class", "chart-content")
      .attr("transform", `translate(${margin.left},${margin.top})`);
      
    // --- Zoom Behavior ---
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.5, 20])
      .extent([[0, 0], [plotWidth, height]])
      .translateExtent([[0, -Infinity], [plotWidth, Infinity]])
      .on("zoom", (event) => {
         transformRef.current = event.transform;
         render();
      });

    svg.call(zoom).on("dblclick.zoom", null);
    svg.call(zoom.transform, transformRef.current);

    // --- RENDER FUNCTION ---
    function render() {
       g.selectAll("*").remove(); 
       
       const t = transformRef.current;
       const newXScale = t.rescaleX(xScale);
       
       const [visStart, visEnd] = newXScale.domain();
       const visibleCandles = candles.filter(c => c.timestamp >= visStart.getTime() && c.timestamp <= visEnd.getTime());
       
       let currentYScale = yScale;
       if (visibleCandles.length > 0) {
          const visYMin = d3.min(visibleCandles, d => d.low) || yMin;
          const visYMax = d3.max(visibleCandles, d => d.high) || yMax;
          const visPadding = (visYMax - visYMin) * 0.1;
          currentYScale = d3.scaleLinear()
             .domain([visYMin - visPadding, visYMax + visPadding])
             .range([mainHeight, 0]);
       }

       const candleWidth = Math.max(1, (plotWidth / ((visEnd.getTime() - visStart.getTime()) / (candles[1]?.timestamp - candles[0]?.timestamp || 1))) * 0.6);

       // --- Layer 0: Grid ---
       const xAxis = d3.axisBottom(newXScale).ticks(5).tickSize(-mainHeight).tickPadding(10);
       const yAxis = d3.axisRight(currentYScale).ticks(8).tickSize(plotWidth).tickPadding(10);

       const gridGroup = g.append("g").attr("class", "grid-layer opacity-10");
       gridGroup.append("g")
         .attr("transform", `translate(0,${mainHeight})`)
         .call(xAxis)
         .call(g => g.select(".domain").remove());

       gridGroup.append("g")
         .call(yAxis)
         .call(g => g.select(".domain").remove())
         .selectAll("line")
         .attr("stroke", "#4b5563")
         .attr("stroke-dasharray", "2,2");
       
       gridGroup.selectAll("text")
         .attr("x", plotWidth + 10)
         .style("text-anchor", "start")
         .style("fill", "#9ca3af")
         .style("font-size", "10px");

       // --- Layer 1: Auction Profile (Semantic Context) ---
       if (layers.profile) {
           const profileGroup = g.append("g").attr("class", "profile-layer").attr("clip-path", "url(#clip)");
           const maxVol = d3.max(profile.levels, d => d.volume) || 1;
           const profileWidth = plotWidth * 0.15;
           const profileX = plotWidth - profileWidth;

           const xProfile = d3.scaleLinear().domain([0, maxVol]).range([0, profileWidth]);

           profile.levels.forEach(level => {
               const y = currentYScale(level.price);
               if (y < 0 || y > mainHeight) return;

               const isVA = level.price <= profile.vah && level.price >= profile.val;
               const opacity = isVA ? 0.15 : 0.05; 
               
               profileGroup.append("rect")
                 .attr("x", profileX)
                 .attr("y", y)
                 .attr("width", xProfile(level.volume))
                 .attr("height", Math.max(1, Math.abs(currentYScale(level.price) - currentYScale(level.price + (profile.levels[1]?.price - profile.levels[0]?.price) || 1))))
                 .attr("fill", isVA ? "#3b82f6" : "#64748b")
                 .attr("opacity", opacity);
           });
       }

       // --- Layer 2: Semantic Zones (Order Blocks with Status) ---
       if (showOrderBlocks) {
           const zoneGroup = g.append("g").attr("class", "zone-layer").attr("clip-path", "url(#clip)");
           orderBlocks.forEach(ob => {
               const yTop = currentYScale(ob.top);
               const yBottom = currentYScale(ob.bottom);
               const h = Math.abs(yTop - yBottom);
               
               if (yBottom < 0 || yTop > mainHeight) return;

               const color = ob.type === 'bullish' ? '#22c55e' : '#ef4444';
               // Opacity based on Strength Confidence
               const opacity = ob.strength / 400; 

               zoneGroup.append("rect")
                  .attr("x", 0)
                  .attr("y", yTop)
                  .attr("width", plotWidth)
                  .attr("height", h)
                  .attr("fill", color)
                  .attr("opacity", opacity);

               // Semantic Label
               const label = ob.type === 'bullish' ? 'DEMAND' : 'SUPPLY';
               const status = ob.status === 'TESTED' ? '(Weakening)' : '(Holding)';
               
               zoneGroup.append("text")
                  .attr("x", 10)
                  .attr("y", yTop + 10)
                  .text(`${label} ${status}`)
                  .attr("fill", color)
                  .attr("font-size", "9px")
                  .attr("font-weight", "600")
                  .attr("opacity", 0.8);
           });
       }

       // --- Layer 3: Candles ---
       const candleGroup = g.append("g").attr("class", "candle-layer").attr("clip-path", "url(#clip)");
       visibleCandles.forEach(d => {
         const isUp = d.close >= d.open;
         const color = isUp ? "#22c55e" : "#ef4444"; 
         const x = newXScale(new Date(d.timestamp));
         const yOpen = currentYScale(d.open);
         const yClose = currentYScale(d.close);
         const yHigh = currentYScale(d.high);
         const yLow = currentYScale(d.low);

         candleGroup.append("line")
           .attr("x1", x).attr("x2", x)
           .attr("y1", yHigh).attr("y2", yLow)
           .attr("stroke", color).attr("stroke-width", 1);

         const bodyHeight = Math.max(1, Math.abs(yOpen - yClose));
         candleGroup.append("rect")
           .attr("x", x - candleWidth / 2)
           .attr("y", Math.min(yOpen, yClose))
           .attr("width", candleWidth)
           .attr("height", bodyHeight)
           .attr("fill", color);

         // Divergence Markers (Semantic Edge)
         if (layers.divergences && d.divergence) {
             const isBearish = d.divergence === 'bearish';
             const markerY = isBearish ? yHigh - 12 : yLow + 12;
             const markerColor = isBearish ? '#facc15' : '#38bdf8'; 
             
             const symbol = d3.symbol().type(d3.symbolTriangle).size(25);
             candleGroup.append("path")
                .attr("d", symbol)
                .attr("transform", `translate(${x}, ${markerY}) rotate(${isBearish ? 180 : 0})`)
                .attr("fill", markerColor);
         }
       });

       // --- Layer 4: VWAP (Context Aware) ---
       if (layers.vwap) {
           const vwapGroup = g.append("g").attr("class", "vwap-layer").attr("clip-path", "url(#clip)");
           const lineGen = d3.line<Candle>()
             .x(d => newXScale(new Date(d.timestamp)))
             .y(d => currentYScale(d.vwap || 0))
             .defined(d => !!d.vwap);
             
           vwapGroup.append("path")
             .datum(visibleCandles)
             .attr("fill", "none")
             .attr("stroke", "#f59e0b")
             .attr("stroke-width", 1.5)
             .attr("d", lineGen);

           [1, 2].forEach(sd => {
               const upperGen = d3.line<Candle>()
                 .x(d => newXScale(new Date(d.timestamp)))
                 .y(d => currentYScale((d.vwap || 0) + (d.vwapStd || 0) * sd))
                 .defined(d => !!d.vwap);
               const lowerGen = d3.line<Candle>()
                 .x(d => newXScale(new Date(d.timestamp)))
                 .y(d => currentYScale((d.vwap || 0) - (d.vwapStd || 0) * sd))
                 .defined(d => !!d.vwap);

               vwapGroup.append("path").datum(visibleCandles).attr("d", upperGen).attr("fill", "none").attr("stroke", "#f59e0b").attr("stroke-opacity", 0.3).attr("stroke-dasharray", "4,4");
               vwapGroup.append("path").datum(visibleCandles).attr("d", lowerGen).attr("fill", "none").attr("stroke", "#f59e0b").attr("stroke-opacity", 0.3).attr("stroke-dasharray", "4,4");
           });
       }

       // --- Layer 5: Semantic Levels Labels (Narrative) ---
       if (layers.levels) {
           const levelsGroup = g.append("g").attr("class", "context-levels").attr("clip-path", "url(#clip)");
           
           const drawLabel = (yVal: number, color: string, mainText: string, subText: string) => {
               const y = currentYScale(yVal);
               if (y < 0 || y > mainHeight) return;
               
               levelsGroup.append("line")
                 .attr("x1", 0).attr("x2", plotWidth)
                 .attr("y1", y).attr("y2", y)
                 .attr("stroke", color)
                 .attr("stroke-width", 1)
                 .attr("stroke-dasharray", "2,2")
                 .attr("opacity", 0.4);
                 
               levelsGroup.append("text")
                 .attr("x", plotWidth + 5)
                 .attr("y", y - 2)
                 .text(mainText)
                 .attr("fill", color)
                 .attr("font-size", "10px")
                 .attr("font-weight", "bold")
                 .style("text-anchor", "start");
                
               levelsGroup.append("text")
                 .attr("x", plotWidth + 5)
                 .attr("y", y + 8)
                 .text(subText)
                 .attr("fill", color)
                 .attr("font-size", "8px")
                 .attr("opacity", 0.7)
                 .style("text-anchor", "start");
           };

           // Semantic States logic
           const inVA = lastPrice <= profile.vah && lastPrice >= profile.val;
           
           drawLabel(profile.vah, "#3b82f6", "VAH", inVA ? "Resistance (Top of Balance)" : lastPrice > profile.vah ? "Support (Breakout)" : "Resistance");
           drawLabel(profile.val, "#3b82f6", "VAL", inVA ? "Support (Bottom of Balance)" : lastPrice < profile.val ? "Resistance (Breakdown)" : "Support");
           drawLabel(profile.poc, "#ef4444", "POC", Math.abs(lastPrice-profile.poc)/lastPrice < 0.001 ? "High Acceptance" : "Magnet");
           
           if(sessionLevels.vwap) {
              const vwapControl = lastPrice > sessionLevels.vwap ? "Buyers Defending" : "Sellers Defending";
              drawLabel(sessionLevels.vwap, "#f59e0b", "VWAP", vwapControl);
           }
       }

       // --- Layer 6: Delta / CVD Panel with Narrative ---
       if (layers.delta) {
           const deltaGroup = g.append("g")
             .attr("class", "delta-panel")
             .attr("transform", `translate(0, ${deltaTop})`)
             .attr("clip-path", "url(#clip-delta)");

           deltaGroup.append("line")
             .attr("x1", 0).attr("x2", plotWidth)
             .attr("y1", deltaScale(0)).attr("y2", deltaScale(0))
             .attr("stroke", "#4b5563").attr("stroke-width", 1);

           visibleCandles.forEach(d => {
              const x = newXScale(new Date(d.timestamp));
              const val = d.delta || 0;
              const y = deltaScale(Math.max(0, val));
              const h = Math.abs(deltaScale(val) - deltaScale(0));
              
              deltaGroup.append("rect")
                .attr("x", x - candleWidth/2)
                .attr("y", val >= 0 ? deltaScale(val) : deltaScale(0))
                .attr("width", candleWidth)
                .attr("height", h)
                .attr("fill", val >= 0 ? "#22c55e" : "#ef4444")
                .attr("opacity", 0.6);
           });

           const cvdLine = d3.line<Candle>()
             .x(d => newXScale(new Date(d.timestamp)))
             .y(d => cvdScale(d.cvd || 0));

           deltaGroup.append("path")
             .datum(visibleCandles)
             .attr("fill", "none")
             .attr("stroke", "#fbbf24")
             .attr("stroke-width", 1.5)
             .attr("d", cvdLine);
             
           // Semantic CVD Label
           deltaGroup.append("text")
             .attr("x", 5)
             .attr("y", 10)
             .text(`CVD FLOW: ${cvdState}`)
             .attr("fill", "#fbbf24")
             .attr("font-size", "9px")
             .attr("font-weight", "bold");
       }
       
       // --- Crosshair ---
       const mouseLayer = g.append("g").attr("class", "mouse-layer");
       mouseLayer.append("rect")
         .attr("width", plotWidth)
         .attr("height", height)
         .attr("fill", "transparent")
         .on("mousemove", (event) => {
             const [mx, my] = d3.pointer(event);
             const date = newXScale.invert(mx);
             const idx = d3.bisector((d: Candle) => d.timestamp).center(candles, date.getTime());
             const d = candles[idx];
             setHoverData(d || null);
             setMousePos({x: mx + margin.left, y: my + margin.top});
         })
         .on("mouseleave", () => {
             setHoverData(null);
             setMousePos(null);
         });
         
       if (mousePos && hoverData) {
           g.append("line")
             .attr("x1", mousePos.x - margin.left).attr("x2", mousePos.x - margin.left)
             .attr("y1", 0).attr("y2", height)
             .attr("stroke", "#6b7280").attr("stroke-dasharray", "4,4").attr("stroke-width", 1);
             
           if (mousePos.y < mainHeight + margin.top) {
               g.append("line")
                 .attr("x1", 0).attr("x2", plotWidth)
                 .attr("y1", mousePos.y - margin.top).attr("y2", mousePos.y - margin.top)
                 .attr("stroke", "#6b7280").attr("stroke-dasharray", "4,4").attr("stroke-width", 1);
           }
       }
    }

    render();

  }, [candles, profile, width, height, layers, orderBlocks, auctionContext, cvdState, lastPrice, sessionLevels]);

  // --- UI Components ---

  const getAuctionBadge = () => {
      const { mode, confidence, bias } = auctionContext;
      const colorClass = bias === 'bullish' ? 'text-green-400' : bias === 'bearish' ? 'text-red-400' : 'text-gray-300';
      
      return (
          <div className="flex flex-col items-center">
              <div className={`flex items-center gap-2 text-sm font-bold uppercase tracking-wider ${colorClass}`}>
                 {mode === 'BALANCED' && <Layers size={16} />}
                 {mode === 'INITIATIVE_BUY' && <TrendingUp size={16} />}
                 {mode === 'INITIATIVE_SELL' && <TrendingDown size={16} />}
                 {mode === 'FAILED_AUCTION_HIGH' && <AlertTriangle size={16} />}
                 {mode === 'FAILED_AUCTION_LOW' && <Zap size={16} />}
                 <span>{mode.replace(/_/g, ' ')}</span>
              </div>
              
              {/* Confidence Bar */}
              <div className="w-full h-1 bg-gray-800 rounded-full mt-1 overflow-hidden">
                  <div className={`h-full transition-all duration-500 ${colorClass.replace('text-','bg-')}`} style={{ width: `${confidence}%` }}></div>
              </div>
          </div>
      );
  };

  return (
    <div className="relative bg-[#0d1117] rounded-lg shadow-xl overflow-hidden border border-gray-800 w-full h-full font-mono" ref={wrapperRef}>
      
      {/* 1. Header with Auction State & Scenario */}
      <div className="absolute top-0 left-0 w-full z-20 pointer-events-none p-4 flex flex-col items-center">
          <div className="bg-gray-950/80 backdrop-blur-md border border-gray-800 px-6 py-2 rounded-xl shadow-2xl flex flex-col items-center gap-1 transition-all">
              {getAuctionBadge()}
              <div className="text-[11px] text-gray-400 font-sans mt-1 text-center max-w-[300px] leading-tight animate-in fade-in slide-in-from-top-1">
                  {auctionContext.scenario}
              </div>
          </div>
      </div>

      {/* 2. Tooltip (Decision Support) */}
      {hoverData && mousePos && (
         <div 
            className="absolute z-50 bg-[#161b22] border border-gray-700 p-3 rounded-lg shadow-2xl text-xs pointer-events-none flex flex-col gap-2 min-w-[180px]"
            style={{ 
                left: mousePos.x < width / 2 ? mousePos.x + 20 : mousePos.x - 200, 
                top: Math.min(mousePos.y, height - 200)
            }}
         >
            <div className="flex justify-between items-center border-b border-gray-800 pb-2">
                <span className="font-bold text-white text-sm">{hoverData.close.toFixed(2)}</span>
                <span className="text-gray-500 text-[10px]">{new Date(hoverData.timestamp).toLocaleTimeString()}</span>
            </div>
            
            <div className="space-y-1">
                <div className="flex justify-between">
                    <span className="text-gray-500">Auction:</span>
                    <span className={`font-bold ${
                        hoverData.close > profile.vah ? 'text-green-400' : 
                        hoverData.close < profile.val ? 'text-red-400' : 'text-blue-400'
                    }`}>
                        {hoverData.close > profile.vah ? 'Extension' : hoverData.close < profile.val ? 'Rejection' : 'Balance'}
                    </span>
                </div>
                <div className="flex justify-between">
                    <span className="text-gray-500">Delta:</span>
                    <span className={`font-bold ${(hoverData.delta || 0) > 0 ? 'text-green-400' : 'text-red-400'}`}>
                         {(hoverData.delta || 0) > 0 ? '+' : ''}{(hoverData.delta || 0).toFixed(0)}
                    </span>
                </div>
                 <div className="flex justify-between">
                    <span className="text-gray-500">CVD:</span>
                    <span className="text-yellow-500 font-mono">{(hoverData.cvd || 0).toFixed(0)}</span>
                </div>
            </div>

            {hoverData.divergence && (
                <div className={`mt-1 px-2 py-1 rounded text-center font-bold text-[10px] uppercase border ${hoverData.divergence === 'bearish' ? 'bg-yellow-900/30 text-yellow-500 border-yellow-700' : 'bg-cyan-900/30 text-cyan-400 border-cyan-700'}`}>
                    {hoverData.divergence} Divergence
                </div>
            )}
         </div>
      )}

      {/* 3. Layer Controls */}
      <div className="absolute top-4 left-4 flex flex-col gap-1 z-10">
          <button onClick={() => setLayers(p => ({...p, profile: !p.profile}))} className={`p-1.5 rounded border ${layers.profile ? 'bg-blue-600/20 border-blue-600 text-blue-400' : 'bg-gray-800 border-gray-700 text-gray-500'}`} title="Toggle Profile"><Activity size={14} /></button>
          <button onClick={() => setLayers(p => ({...p, vwap: !p.vwap}))} className={`p-1.5 rounded border ${layers.vwap ? 'bg-orange-600/20 border-orange-600 text-orange-400' : 'bg-gray-800 border-gray-700 text-gray-500'}`} title="Toggle VWAP"><Layers size={14} /></button>
          <button onClick={() => setLayers(p => ({...p, delta: !p.delta}))} className={`p-1.5 rounded border ${layers.delta ? 'bg-green-600/20 border-green-600 text-green-400' : 'bg-gray-800 border-gray-700 text-gray-500'}`} title="Toggle Delta Panel"><Zap size={14} /></button>
      </div>

      <div className="absolute top-4 right-4 flex gap-2 z-10">
         <button 
           onClick={() => {
              transformRef.current = d3.zoomIdentity;
              const svg = d3.select(svgRef.current);
              svg.call(d3.zoom().transform as any, d3.zoomIdentity);
           }} 
           className="p-2 bg-gray-800 rounded hover:bg-gray-700 text-gray-300 border border-gray-700 shadow-md"
           title="Reset Zoom"
         >
            <ZoomOut size={16} />
         </button>
      </div>

      <svg
        ref={svgRef}
        width={width}
        height={height}
        className="block w-full h-full cursor-crosshair"
      />
    </div>
  );
};

export default ProfileChart;
