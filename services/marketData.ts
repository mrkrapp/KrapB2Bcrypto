import { Candle, ConnectionStatus, ScreenerRow, Timeframe, ScreenerTimeframe, Trade, OrderBookLevel } from '../types';
import { calculateScreenerMetrics } from '../utils/analytics';

// Switch to Binance Futures API to match "Perpetuals" context of screenshot
const BINANCE_API_URL = 'https://fapi.binance.com/fapi/v1';
const BINANCE_WS_URL = 'wss://fstream.binance.com/ws'; // Raw stream endpoint
const BINANCE_COMBINED_STREAM_URL = 'wss://fstream.binance.com/stream'; // Combined stream endpoint

/**
 * Fetches the top liquid USDT pairs from Binance Futures.
 * Returns a list of symbols (e.g., ['BTCUSDT', 'ETHUSDT', ...])
 */
export const fetchTopSymbols = async (limit: number = 100): Promise<string[]> => {
  try {
    const response = await fetch(`${BINANCE_API_URL}/ticker/24hr`);
    if (!response.ok) throw new Error('Failed to fetch ticker data');
    const data = await response.json();

    // Filter for USDT pairs and sort by Quote Volume (most liquid first)
    const sorted = data
      .filter((ticker: any) => ticker.symbol.endsWith('USDT'))
      .sort((a: any, b: any) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
      .slice(0, limit)
      .map((ticker: any) => ticker.symbol);

    return sorted;
  } catch (error) {
    console.error('Error fetching top symbols:', error);
    return ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'DOGEUSDT', 'XRPUSDT', 'ADAUSDT', 'AVAXUSDT'];
  }
};

/**
 * Fetches all funding rates from premiumIndex endpoint
 */
export const fetchFundingRates = async (): Promise<Map<string, number>> => {
  try {
    const response = await fetch(`${BINANCE_API_URL}/premiumIndex`);
    if (!response.ok) throw new Error('Failed to fetch funding rates');
    const data = await response.json();
    const map = new Map<string, number>();
    data.forEach((item: any) => {
      // lastFundingRate is a string, e.g. "0.00010000"
      map.set(item.symbol, parseFloat(item.lastFundingRate));
    });
    return map;
  } catch (error) {
    console.error('Error fetching funding rates:', error);
    return new Map();
  }
};

/**
 * Fetches candles for a specific time range. 
 */
export const fetchDailyCandles = async (
    symbol: string, 
    startTime: number, 
    endTime: number,
    interval: Timeframe = '15m'
): Promise<Candle[]> => {
  const allCandles: Candle[] = [];
  let currentStart = startTime;
  
  let timePerCandle = 1000 * 60 * 15; // 15m default
  if (interval === '5m') timePerCandle = 1000 * 60 * 5;
  if (interval === '1h') timePerCandle = 1000 * 60 * 60;
  if (interval === '4h') timePerCandle = 1000 * 60 * 60 * 4;
  if (interval === '1d') timePerCandle = 1000 * 60 * 60 * 24;

  const CHUNK_SIZE = timePerCandle * 1000; 

  try {
    while (currentStart < endTime) {
      const currentEnd = Math.min(currentStart + CHUNK_SIZE, endTime);
      if (currentStart >= currentEnd) break;

      const response = await fetch(
        `${BINANCE_API_URL}/klines?symbol=${symbol.toUpperCase()}&interval=${interval}&startTime=${currentStart}&endTime=${currentEnd}&limit=1500`
      );

      if (!response.ok) throw new Error(`Failed to fetch history: ${response.statusText}`);

      const data = await response.json();
      if (!Array.isArray(data) || data.length === 0) break;

      const chunkCandles = data.map((d: any) => ({
        timestamp: d[0],
        open: parseFloat(d[1]),
        high: parseFloat(d[2]),
        low: parseFloat(d[3]),
        close: parseFloat(d[4]),
        volume: parseFloat(d[5]),
        takerBuyVolume: parseFloat(d[9]), 
        isClosed: true,
      }));

      allCandles.push(...chunkCandles);
      const lastTimestamp = chunkCandles[chunkCandles.length - 1].timestamp;
      currentStart = lastTimestamp + 1; // Advance
      
      if (chunkCandles.length < 500 && currentStart < endTime) break;
    }

    const uniqueCandles = Array.from(new Map(allCandles.map(c => [c.timestamp, c])).values());
    return uniqueCandles.sort((a, b) => a.timestamp - b.timestamp);
  } catch (error) {
    console.error('Error fetching daily candles:', error);
    return [];
  }
};

/**
 * Helper for batching promises
 * Optimized for speed: Increased batch size and reduced delay
 */
const batchPromises = async <T>(
  items: string[], 
  batchSize: number, 
  fn: (item: string) => Promise<T | null>
): Promise<T[]> => {
  const results: T[] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(fn));
    results.push(...(batchResults.filter(r => r !== null) as T[]));
    // Reduced delay to 50ms to speed up loading while staying safe from rate limits
    if (i + batchSize < items.length) await new Promise(r => setTimeout(r, 50)); 
  }
  return results;
};

/**
 * Fetches metrics for the screener.
 * Optimized batch parameters for faster response.
 */
export const fetchScreenerMetrics = async (symbols: string[], timeframe: ScreenerTimeframe = '15m'): Promise<ScreenerRow[]> => {
  
  const fundingMap = await fetchFundingRates();
  
  let vol24hMap = new Map<string, number>();

  // Fetch 24h Ticker for base Volume and Chg24h (which is always 24h)
  try {
     const tRes = await fetch(`${BINANCE_API_URL}/ticker/24hr`);
     const tData = await tRes.json();
     tData.forEach((t: any) => {
         vol24hMap.set(t.symbol, parseFloat(t.quoteVolume));
     });
  } catch (e) {
      console.warn("Failed to fetch 24h volume snapshot", e);
  }

  const fetchSymbolMetrics = async (symbol: string): Promise<ScreenerRow | null> => {
    try {
      // 1. Fetch Klines for the Selected Timeframe (Trend, Dynamic Vol, Dynamic Chg)
      // Limit 60 to calculate RSI/Trend. 
      const klinesRes = await fetch(`${BINANCE_API_URL}/klines?symbol=${symbol}&interval=${timeframe}&limit=60`);
      const klinesData = await klinesRes.json();
      
      // 2. Fetch 1d klines for Week Change (Last 7 days)
      const dailyRes = await fetch(`${BINANCE_API_URL}/klines?symbol=${symbol}&interval=1d&limit=8`);
      const dailyData = await dailyRes.json();

      if (!Array.isArray(klinesData) || klinesData.length < 2) return null;

      const candles: Candle[] = klinesData.map((d: any) => ({
        timestamp: d[0],
        open: parseFloat(d[1]),
        high: parseFloat(d[2]),
        low: parseFloat(d[3]),
        close: parseFloat(d[4]),
        volume: parseFloat(d[5]),
        takerBuyVolume: parseFloat(d[9]),
        isClosed: true,
      }));

      // Week Change
      let weekChange = 0;
      if (Array.isArray(dailyData) && dailyData.length >= 7) {
          const today = parseFloat(dailyData[dailyData.length - 1][4]);
          const weekAgo = parseFloat(dailyData[0][4]); 
          weekChange = ((today - weekAgo) / weekAgo) * 100;
      }

      // Dynamic Timeframe Metrics
      const lastCandle = candles[candles.length - 1];
      // Volume for the current timeframe candle
      const tfVolume = lastCandle.volume; 
      // Change % for the current timeframe candle (Close vs Open)
      const tfChange = ((lastCandle.close - lastCandle.open) / lastCandle.open) * 100;

      // Net Inflow (Proxy based on recent candles of selected TF)
      let netFlow = 0;
      candles.slice(-5).forEach(c => {
         const buyVol = c.takerBuyVolume;
         const sellVol = c.volume - c.takerBuyVolume;
         netFlow += (buyVol - sellVol) * c.close;
      });

      const row = calculateScreenerMetrics(symbol, candles, 0);
      
      // Inject data
      row.fundingRate = fundingMap.get(symbol) || 0;
      row.vol24h = vol24hMap.get(symbol) || 0;
      row.weekChange = weekChange;
      row.netInflow = netFlow; 
      
      // Overwrite dynamic fields
      row.tfChange = tfChange;
      row.tfVolume = tfVolume;
      
      return row;
    } catch (e) {
      console.error(`Error fetching screener data for ${symbol}`, e);
      return null;
    }
  };

  // Increased batch size to 25 to fetch faster (Binance limit is generous for public endpoints)
  return batchPromises(symbols, 25, fetchSymbolMetrics);
};

export const subscribeToTicker = (
  symbol: string,
  onCandle: (candle: Candle) => void,
  onStatus: (status: ConnectionStatus) => void,
  interval: string = '15m'
) => {
  const ws = new WebSocket(`${BINANCE_WS_URL}/${symbol.toLowerCase()}@kline_${interval}`);
  
  ws.onopen = () => onStatus(ConnectionStatus.CONNECTED);
  ws.onmessage = (event) => {
    try {
      const message = JSON.parse(event.data);
      if (message.e === 'kline') {
        const k = message.k;
        onCandle({
          timestamp: k.t,
          open: parseFloat(k.o),
          high: parseFloat(k.h),
          low: parseFloat(k.l),
          close: parseFloat(k.c),
          volume: parseFloat(k.v),
          takerBuyVolume: parseFloat(k.V),
          isClosed: k.x,
        });
      }
    } catch (e) {
      console.error('Ticker WS parse error', e);
    }
  };
  ws.onerror = (err) => {
    console.error('WebSocket error:', err);
    onStatus(ConnectionStatus.ERROR);
  };
  ws.onclose = () => onStatus(ConnectionStatus.DISCONNECTED);
  return () => ws.close();
};

/**
 * Subscribes to the All Market Ticker Stream.
 * Returns a cleanup function.
 */
export const subscribeToAllMarketTicker = (
  onData: (data: Map<string, { price: number; chg24h: number; vol24h: number }>) => void
) => {
  const ws = new WebSocket(`${BINANCE_WS_URL}/!ticker@arr`);
  
  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (Array.isArray(data)) {
        const updateMap = new Map<string, { price: number; chg24h: number; vol24h: number }>();
        data.forEach((t: any) => {
          if (t.s.endsWith('USDT')) {
            updateMap.set(t.s, {
              price: parseFloat(t.c),
              chg24h: parseFloat(t.P), 
              vol24h: parseFloat(t.q) 
            });
          }
        });
        onData(updateMap);
      }
    } catch (e) {
      // ignore parse errors for keep-alive etc
    }
  };

  return () => ws.close();
};

// --- Order Flow Subscriptions ---

export const subscribeToOrderFlow = (
  symbol: string,
  onTrade: (trade: Trade) => void,
  onDepth: (bids: OrderBookLevel[], asks: OrderBookLevel[]) => void
) => {
  const lowerSymbol = symbol.toLowerCase();
  
  // Use COMBINED STREAM endpoint: /stream?streams=...
  // NOTE: Combined stream events are wrapped in {"stream": "...", "data": ...}
  const ws = new WebSocket(`${BINANCE_COMBINED_STREAM_URL}?streams=${lowerSymbol}@aggTrade/${lowerSymbol}@depth20@100ms`);

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      
      // Valid combined stream message has 'stream' and 'data' properties
      if (!msg.stream || !msg.data) return;

      const stream = msg.stream;
      const data = msg.data;

      if (stream.endsWith('@aggTrade')) {
        const isLarge = parseFloat(data.q) * parseFloat(data.p) > 10000; // > $10k threshold for large
        onTrade({
          id: data.a,
          price: parseFloat(data.p),
          qty: parseFloat(data.q),
          time: data.T,
          isBuyerMaker: data.m, 
          isLarge
        });
      } else if (stream.endsWith('@depth20@100ms')) {
        // Map Bids
        const bids: OrderBookLevel[] = data.b.map((item: string[]) => ({
          price: parseFloat(item[0]),
          qty: parseFloat(item[1]),
          total: 0,
          depthRatio: 0
        }));
        
        // Map Asks
        const asks: OrderBookLevel[] = data.a.map((item: string[]) => ({
          price: parseFloat(item[0]),
          qty: parseFloat(item[1]),
          total: 0,
          depthRatio: 0
        }));

        // Calculate totals for ratio
        const maxBidQty = Math.max(...bids.map(b => b.qty), 0.0001);
        const maxAskQty = Math.max(...asks.map(a => a.qty), 0.0001);
        const globalMax = Math.max(maxBidQty, maxAskQty);

        bids.forEach(b => b.depthRatio = b.qty / globalMax);
        asks.forEach(a => a.depthRatio = a.qty / globalMax);

        onDepth(bids, asks);
      }
    } catch (e) {
      console.error('OrderFlow WS parse error', e);
    }
  };

  ws.onerror = (e) => console.error('OrderFlow WS Error', e);

  return () => ws.close();
}