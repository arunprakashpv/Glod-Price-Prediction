require('dotenv').config({ path: '.env.local' });
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const db = require('./services/db');
const neonAuth = require('./services/neon_auth');
const aiGateway = require('./services/ai_gateway');
const realtimeService = require('./services/realtime');
const orgService = require('./services/organisations');
const backtestService = require('./services/backtest_engine');
const macroService = require('./services/macro');
const historySync = require('./services/history_sync');

const PORT = process.env.PORT || 3333;
const PUBLIC_DIR = path.join(__dirname, 'public');

// MIME types for static assets
const MIME_TYPES = {
  '.html': 'text/html; charset=UTF-8',
  '.css': 'text/css; charset=UTF-8',
  '.js': 'application/javascript; charset=UTF-8',
  '.json': 'application/json; charset=UTF-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

// State store with realistic baseline financial data
// Gold prices around $2,680 - $2,740 / oz in late 2024-2026 range
const FORECAST_FILE = path.join(__dirname, 'data', 'forecast.json');

let marketState = {
  lastUpdated: new Date().toISOString(),
  gold: {
    symbol: 'XAU/USD',
    name: 'Gold Spot / US Dollar',
    price: 2718.45,
    change24h: 18.60,
    changePercent24h: 0.69,
    high24h: 2728.10,
    low24h: 2694.30,
    unit: 'USD / oz',
    signal: 'BULLISH',
    rationale: 'Acting as financial shock absorber amid currency volatility and elevated real yields'
  },
  usd_inr: {
    symbol: 'USD/INR',
    name: 'USD to Indian Rupee',
    price: 84.22,
    change24h: 0.08,
    changePercent24h: 0.10,
    high24h: 84.35,
    low24h: 84.15,
    unit: 'INR per USD',
    correlation: 0.88,
    impact: 'Rupee depreciation increases the landed cost of imported bullion in India',
    signal: 'BULLISH_INR_GOLD'
  },
  crude_oil: {
    symbol: 'CL=F (WTI)',
    name: 'Crude Oil WTI',
    price: 74.85,
    change24h: 1.42,
    changePercent24h: 1.93,
    high24h: 75.30,
    low24h: 72.90,
    unit: 'USD / bbl',
    correlation: 0.74,
    inflationImpact: 'Elevated inflation pressure supporting gold hedge demand',
    signal: 'BULLISH'
  },
  usd_index: {
    symbol: 'DX-Y.NYB',
    name: 'U.S. Dollar Index (DXY)',
    price: 103.42,
    change24h: -0.48,
    changePercent24h: -0.46,
    high24h: 104.12,
    low24h: 103.28,
    unit: 'Points',
    correlation: -0.83,
    fxImpact: 'Softening USD reduces foreign buyer hurdle (EUR, INR), expanding gold demand',
    signal: 'BULLISH'
  },
  treasury_yield: {
    symbol: '^TNX (10Y)',
    name: 'US 10-Year Treasury Yield',
    price: 4.18,
    change24h: -0.06,
    changePercent24h: -1.42,
    realYield: 1.84, // 10Y Yield - 2.34% 10Y Breakeven Inflation
    breakevenInflation: 2.34,
    unit: '%',
    correlation: -0.79,
    opportunityCostImpact: 'Falling real yields diminish the opportunity cost of holding non-yielding gold',
    signal: 'BULLISH'
  },
  vix: {
    symbol: '^VIX',
    name: 'CBOE Volatility Index',
    price: 19.85,
    change24h: 1.95,
    changePercent24h: 10.89,
    high24h: 21.20,
    low24h: 17.60,
    unit: 'Index Points',
    correlation: 0.67,
    safeHavenImpact: 'Elevated equity uncertainty prompts flight to safe haven assets',
    signal: 'BULLISH'
  }
};

let currentBenchmark22kRate = 13140;

// Restore saved live macro cache if available
try {
  const macroCache = macroService.loadMacroCache();
  if (macroCache && macroCache.market) {
    Object.assign(marketState, macroCache.market);
  }
} catch (e) {}

// Restore saved benchmark rate from forecast or persisted organisations cache
try {
  const orgData = orgService.getOrganisationsData();
  const activeOrg = orgData?.organisations?.find(o => o.id === orgData.activeBenchmarkId) || orgData?.organisations?.[0];
  if (activeOrg && activeOrg.rate22k_1g) {
    currentBenchmark22kRate = activeOrg.rate22k_1g;
  } else if (fs.existsSync(FORECAST_FILE)) {
    const raw = fs.readFileSync(FORECAST_FILE, 'utf8');
    const existing = JSON.parse(raw);
    if (existing && existing.marketBenchmark && existing.marketBenchmark.rate22kPerGram) {
      currentBenchmark22kRate = existing.marketBenchmark.rate22kPerGram;
    }
  }
} catch (e) {}

// Calculate Indian Retail Prices calibrated to Jeweller Benchmark (e.g. GRT Jewellers ₹13,385/g)
function calculateIndianPrices(goldUsd, usdInr, base22kRate = currentBenchmark22kRate) {
  const retail22k1g = Math.round(base22kRate);
  const retail22k10g = retail22k1g * 10;
  const retail22k8g = retail22k1g * 8; // 1 Sovereign / Pavan
  const retail24k1g = Math.round(retail22k1g * (24 / 22));
  const retail24k10g = retail24k1g * 10;
  const retail18k1g = Math.round(retail22k1g * (18 / 22));
  const retail18k10g = retail18k1g * 10;

  // Implied international conversion
  const perGramUsd = goldUsd / 31.1034768;
  const landedInrPerGram = perGramUsd * usdInr * 1.06 * 1.03;

  return {
    source: 'GRT Jewellers (grtjewels.com) & Indian Retail Benchmark',
    benchmark22kRate: retail22k1g,
    usdInr,
    dutyPct: 6.0,
    gstPct: 3.0,
    impliedMcxRate: Math.round(landedInrPerGram),
    purity24k: {
      per10g: retail24k10g,
      per1g: retail24k1g,
      label: '24K (999 Pure) - Investment Coins & Bars'
    },
    purity22k: {
      per10g: retail22k10g,
      per1g: retail22k1g,
      per8gSovereign: retail22k8g,
      label: `22K (916 Hallmark) - Standard Jewellery (GRT Rate: ₹${retail22k1g.toLocaleString('en-IN')}/g)`
    },
    purity18k: {
      per10g: retail18k10g,
      per1g: retail18k1g,
      label: '18K (750 Purity) - Diamond & Modern Jewellery'
    }
  };
}

// Generate retail buy/wait advice for Indian consumers
function getRetailAdvice(score, isPerfectStorm, rupeeRate) {
  if (score >= 80) {
    return {
      action: 'WAIT_FOR_DIP',
      badge: 'HIGH MOMENTUM // WAIT OR STAGGER',
      color: '#ef4444',
      advice: 'Gold is in a strong breakout rally driven by international catalysts. Retail prices in India are elevated. If you need jewellery immediately, negotiate making charges or buy only 30-50% now and wait 3-7 days for a consolidation dip to buy the rest.'
    };
  } else if (score >= 60) {
    return {
      action: 'ACCUMULATE_COINS',
      badge: 'ACCUMULATE TRANCHES',
      color: '#f59e0b',
      advice: 'Bullish macro tailwinds are forming. Good window to accumulate 24K coins or bullion bars. For jewellery, lock in 22K rates with advance booking if your jeweller offers rate-fix schemes.'
    };
  } else if (score >= 40) {
    return {
      action: 'OPTIMAL_BUY_ZONE',
      badge: 'OPTIMAL BUYING WINDOW',
      color: '#10b981',
      advice: 'Market is in neutral consolidation. Downside risk is low, and prices are stable. This is a favorable entry zone for festive and wedding jewellery purchases before the next macro breakout.'
    };
  } else {
    return {
      action: 'WAIT_AND_WATCH',
      badge: 'CORRECTION WATCH',
      color: '#38bdf8',
      advice: 'Macro headwinds (strong dollar / elevated real yields) are exerting downward pressure on gold. Better retail discounts and lower 10g prices likely in the coming 7-14 days.'
    };
  }
}

// Generate 30 days of realistic historical normalized series
function generateHistoricalSeries() {
  const days = 30;
  const series = [];
  const now = new Date();
  
  let g = 0;
  let o = 0;
  let u = 0;
  let y = 0;
  let v = 0;
  let inrG = 0;

  for (let i = days; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
    const dateStr = d.toISOString().split('T')[0];

    // Build correlated daily random walks
    const marketShock = (Math.random() - 0.5) * 1.5;
    const inflationShock = (Math.random() - 0.48) * 1.8;
    const dollarShock = -(marketShock * 0.4) + (Math.random() - 0.52) * 0.8;
    const yieldShock = dollarShock * 0.5 + (Math.random() - 0.52) * 0.9;
    
    // Gold moves inversely to USD and Yield, positively with Oil and Volatility
    const goldDelta = (-dollarShock * 0.7) + (-yieldShock * 0.5) + (inflationShock * 0.5) + (marketShock > 0.5 ? 0.8 : -0.2);
    const inrDelta = goldDelta + (Math.random() - 0.49) * 0.2; // Rupee factor
    
    g += goldDelta;
    o += inflationShock;
    u += dollarShock;
    y += yieldShock;
    v += (marketShock * 2.2);
    inrG += inrDelta;

    series.push({
      date: dateStr,
      gold: parseFloat(g.toFixed(2)),
      goldInr: parseFloat(inrG.toFixed(2)),
      oil: parseFloat(o.toFixed(2)),
      usd: parseFloat(u.toFixed(2)),
      yields: parseFloat(y.toFixed(2)),
      vix: parseFloat(v.toFixed(2))
    });
  }
  return series;
}

let historicalData = generateHistoricalSeries();
try {
  const macroCache = macroService.loadMacroCache();
  if (macroCache && Array.isArray(macroCache.historical) && macroCache.historical.length >= 2) {
    historicalData = macroCache.historical;
  }
} catch (e) {}

// Dynamic computation of the Breakout Score & Pillar Alignments
function calculateBreakoutMatrix(state) {
  const histMacro = macroService.loadHistoricalMacro();
  const base = histMacro?.latestBaselines || {};

  const goldPrice = state.gold?.price || 3984.7;
  const yieldPrice = state.treasury_yield?.price || 4.998;
  const usdInrPrice = state.usd_inr?.price || 93.68;
  const dxyPrice = state.usd_index?.price || 103.01;

  const core = macroService.computeCoreMacroScore({
    goldPrice,
    goldSma20: state.gold?.sma20 || base.gold?.sma20 || goldPrice,
    goldSma50: state.gold?.sma50 || base.gold?.sma50 || goldPrice,
    goldChg1dPct: state.gold?.changePercent24h ?? base.gold?.chg1dPct ?? 0,
    yieldPrice,
    yieldSma20: state.treasury_yield?.sma20 || base.treasury_yield?.sma20 || yieldPrice,
    yieldSma50: state.treasury_yield?.sma50 || base.treasury_yield?.sma50 || yieldPrice,
    yieldChg1dPct: state.treasury_yield?.changePercent24h ?? base.treasury_yield?.chg1dPct ?? 0,
    usdInrPrice,
    usdInrSma20: state.usd_inr?.sma20 || base.usd_inr?.sma20 || usdInrPrice,
    usdInrSma50: state.usd_inr?.sma50 || base.usd_inr?.sma50 || usdInrPrice,
    usdInrChg1dPct: state.usd_inr?.changePercent24h ?? base.usd_inr?.chg1dPct ?? 0,
    dxyPrice,
    dxySma20: state.usd_index?.sma20 || base.usd_index?.sma20 || dxyPrice,
    dxySma50: state.usd_index?.sma50 || base.usd_index?.sma50 || dxyPrice,
    dxyChg1dPct: state.usd_index?.changePercent24h ?? base.usd_index?.chg1dPct ?? 0
  });

  const totalScore = core.totalScore;
  const { pillars: pScores, deviations } = core;

  // Core >= 8/10 Drivers only (XAU/USD 9.5, US10Y 8.5, USD/INR 8.0, DXY 8.0)
  const pillars = [
    {
      id: 'gold',
      name: 'Global Spot Gold Trend (9.5/10)',
      symbol: 'XAU/USD',
      score: Math.round(pScores.spotGold),
      rawScore: pScores.spotGold,
      max: 25,
      isAligned: pScores.spotGold >= 14,
      weight: '27.9%',
      direction: deviations.goldDev20Pct >= 0
        ? `Bullish (+${deviations.goldDev20Pct}% vs 20-DMA)`
        : `Pullback (${deviations.goldDev20Pct}% vs 20-DMA)`,
      status: pScores.spotGold >= 15.5 ? 'BULLISH' : (pScores.spotGold >= 10.5 ? 'NEUTRAL' : 'BEARISH')
    },
    {
      id: 'yields',
      name: 'US 10Y Real / Treasury Yield (8.5/10)',
      symbol: 'US10Y / Real',
      score: Math.round(pScores.realYield),
      rawScore: pScores.realYield,
      max: 25,
      isAligned: pScores.realYield >= 14,
      weight: '25.0%',
      direction: deviations.yieldDiff20Bps <= 0
        ? `Favorable (${deviations.yieldDiff20Bps} bps vs 20-DMA)`
        : `Headwind (+${deviations.yieldDiff20Bps} bps vs 20-DMA)`,
      status: pScores.realYield >= 15.5 ? 'BULLISH' : (pScores.realYield >= 10.5 ? 'NEUTRAL' : 'BEARISH')
    },
    {
      id: 'usd_inr',
      name: 'USD / INR Landed Rate Floor (8.0/10)',
      symbol: 'USD/INR',
      score: Math.round(pScores.usdInr),
      rawScore: pScores.usdInr,
      max: 25,
      isAligned: pScores.usdInr >= 14,
      weight: '23.5%',
      direction: deviations.usdInrDev20Pct >= 0
        ? `Supportive (+${deviations.usdInrDev20Pct}% INR Weak)`
        : `INR Firming (${deviations.usdInrDev20Pct}% vs 20-DMA)`,
      status: pScores.usdInr >= 15.5 ? 'BULLISH' : (pScores.usdInr >= 10.5 ? 'NEUTRAL' : 'BEARISH')
    },
    {
      id: 'usd',
      name: 'US Dollar Index DXY (8.0/10)',
      symbol: 'DXY',
      score: Math.round(pScores.usdIndex),
      rawScore: pScores.usdIndex,
      max: 25,
      isAligned: pScores.usdIndex >= 14,
      weight: '23.5%',
      direction: deviations.dxyDev20Pct <= 0
        ? `Favorable (${deviations.dxyDev20Pct}% USD Soft)`
        : `Headwind (+${deviations.dxyDev20Pct}% vs 20-DMA)`,
      status: pScores.usdIndex >= 15.5 ? 'BULLISH' : (pScores.usdIndex >= 10.5 ? 'NEUTRAL' : 'BEARISH')
    }
  ];

  const alignedCount = pillars.filter(p => p.isAligned).length;

  let regime = '';
  let regimeClass = '';
  let interpretation = '';

  if (totalScore >= 80 && alignedCount >= 3) {
    regime = 'PERFECT STORM BREAKOUT IMMINENT';
    regimeClass = 'perfect-storm';
    interpretation = 'All 4 Core >= 8/10 drivers are aligned: surging XAU/USD above 20-DMA, softening DXY, falling US 10Y yields, and Rupee floor pressure driving strong Indian gold upside.';
  } else if (totalScore >= 60) {
    regime = 'STRONG BULLISH CONVERGENCE';
    regimeClass = 'strong-bullish';
    interpretation = 'Core >= 8/10 macro pillars (Spot Gold, US 10Y, USD/INR, DXY) favor upward INR gold tailwinds above rolling 20-DMA baselines.';
  } else if (totalScore >= 43) {
    regime = 'NEUTRAL / COMPETING FORCES';
    regimeClass = 'neutral';
    interpretation = 'Mixed signals across Core >= 8/10 drivers (e.g., USD/INR or yields offsetting global XAU/USD momentum). Rangebound consolidation favored.';
  } else if (totalScore >= 30) {
    regime = 'BEARISH HEADWINDS';
    regimeClass = 'mild-bearish';
    interpretation = 'Core >= 8/10 headwinds active: XAU/USD trading below 20-DMA, firmer DXY, firmer Rupee, or sticky US 10Y yields cooling short-term domestic rallies.';
  } else {
    regime = 'STRONG MACRO HEADWIND';
    regimeClass = 'strong-bearish';
    interpretation = 'All Core >= 8/10 drivers weigh on near-term INR bullion: XAU/USD below 20/50-DMA alongside firmer USD/DXY and firmer INR creating dip/pullback pressure.';
  }

  return {
    score: totalScore,
    maxScore: 100,
    regime,
    regimeClass,
    alignedCount,
    totalPillars: 4,
    isPerfectStorm: totalScore >= 80 && alignedCount >= 3,
    modelTier: 'CORE_8_PLUS_ONLY',
    deviations,
    pillars,
    interpretation,
    calculatedAt: new Date().toISOString()
  };
}

// Micro-tick update generator for live streaming simulation
function tickMarket() {
  const tickMultiplier = 0.05;

  // Gold micro fluctuation
  const gDelta = (Math.random() - 0.48) * 0.85 * tickMultiplier;
  marketState.gold.price = +(marketState.gold.price + gDelta).toFixed(2);
  marketState.gold.high24h = Math.max(marketState.gold.high24h, marketState.gold.price);
  marketState.gold.low24h = Math.min(marketState.gold.low24h, marketState.gold.price);

  // USD/INR micro fluctuation
  const inrDelta = (Math.random() - 0.49) * 0.02 * tickMultiplier;
  marketState.usd_inr.price = +(marketState.usd_inr.price + inrDelta).toFixed(2);

  // Crude Oil
  const oDelta = (Math.random() - 0.49) * 0.12 * tickMultiplier;
  marketState.crude_oil.price = +(marketState.crude_oil.price + oDelta).toFixed(2);

  // US Dollar Index
  const uDelta = (Math.random() - 0.51) * 0.04 * tickMultiplier;
  marketState.usd_index.price = +(marketState.usd_index.price + uDelta).toFixed(2);

  // 10Y Yield
  const yDelta = (Math.random() - 0.51) * 0.01 * tickMultiplier;
  marketState.treasury_yield.price = +(marketState.treasury_yield.price + yDelta).toFixed(3);
  marketState.treasury_yield.realYield = +(marketState.treasury_yield.price - marketState.treasury_yield.breakevenInflation).toFixed(2);

  // VIX
  const vDelta = (Math.random() - 0.49) * 0.15 * tickMultiplier;
  marketState.vix.price = Math.max(10, +(marketState.vix.price + vDelta).toFixed(2));

  marketState.lastUpdated = new Date().toISOString();
}

// Tick periodically
setInterval(tickMarket, 4000);

// =====================================================================
// AUTONOMOUS 3-HOUR BULLION FORECAST ENGINE
// Evaluates Macro Matrix & Updates Multi-Horizon Retail Targets
// Runs continuously every 3 hours; no API key required
// =====================================================================
function formatSignedInr(diff) {
  return `${diff >= 0 ? '+' : '-'}₹${Math.abs(Math.round(diff)).toLocaleString('en-IN')}`;
}

function generateAndSaveForecast(base22kRate = currentBenchmark22kRate) {
  const now = new Date();
  const nextCheck = new Date(now.getTime() + 3 * 60 * 60 * 1000);
  const breakout = calculateBreakoutMatrix(marketState);
  const score = breakout.score;
  const goldPrice = marketState.gold.price;
  const usdInr = marketState.usd_inr.price;
  const realYield = marketState.treasury_yield.realYield ?? 2.0;

  let techSetup = null;
  try {
    techSetup = backtestService.getBacktestResults()?.currentMarketSetup || null;
  } catch (e) {}

  currentBenchmark22kRate = Math.round(base22kRate);
  const rate22kPerGram = currentBenchmark22kRate;
  const rate22kSovereign = rate22kPerGram * 8;
  const rate24k10g = Math.round(rate22kPerGram * (24 / 22)) * 10;
  const rate24k1g = Math.round(rate22kPerGram * (24 / 22));

  // Dynamic Macro Delta Adjustment strictly using >= 8/10 Core Drivers:
  // Spot Gold (9.5/10), US 10Y Real/Nominal Yield (8.5/10), USD/INR (8.0/10), DXY (8.0/10)
  const coreTilt = ((score - 50) / 50) * 0.014;
  const landed22kPreTax = ((goldPrice * usdInr) / 31.1034768) * (22 / 24);
  const landed22kWithDuty = landed22kPreTax * 1.09; // 6% customs + 3% GST baseline
  const parityGapPct = landed22kWithDuty > 0 ? ((landed22kWithDuty - rate22kPerGram) / rate22kPerGram) : 0;
  // Soft pull toward landed import parity when domestic spread diverges beyond +/- 8%
  const excessParityAdj = Math.abs(parityGapPct) > 0.08
    ? Math.max(-0.008, Math.min(0.008, (parityGapPct - Math.sign(parityGapPct) * 0.08) * 0.25))
    : 0;
  const macroMomentum = Math.max(-0.025, Math.min(0.025, coreTilt + excessParityAdj));

  // Intraday micro-volatility tick
  const liveTick = ((Date.now() % 10000) / 10000 - 0.5) * 0.0010;

  // 3-Day Horizon (Short-term tactical window)
  const rsi14 = techSetup?.rsi14 ?? 50;
  const isOverbought = techSetup?.waitForDipTriggered || rsi14 >= 68;
  const isOversold = rsi14 <= 38;
  const d3Bias = isOversold ? 0.006 : (isOverbought ? -0.011 : -0.003);
  const d3Low22k = Math.round(rate22kPerGram * (1 + d3Bias - 0.006 + macroMomentum * 0.45 + liveTick));
  const d3High22k = Math.round(rate22kPerGram * (1 + d3Bias + 0.004 + macroMomentum * 0.45 + liveTick));
  const d3Confidence = Math.min(89, Math.max(68, Math.round(74 + Math.abs(score - 50) * 0.3)));

  // 7-Day Horizon (Weekly consolidation / trend)
  const d7Low22k = Math.round(rate22kPerGram * (1 - 0.008 + macroMomentum * 0.70 + liveTick * 0.8));
  const d7High22k = Math.round(rate22kPerGram * (1 + 0.008 + macroMomentum * 0.70 + liveTick * 0.8));
  const d7Confidence = Math.min(86, Math.max(68, Math.round(72 + Math.abs(score - 50) * 0.22)));

  // 14-Day Horizon (Fortnightly)
  const d14Low22k = Math.round(rate22kPerGram * (1 - 0.005 + macroMomentum * 0.95 + (score >= 58 ? 0.004 : -0.004)));
  const d14High22k = Math.round(rate22kPerGram * (1 + 0.015 + macroMomentum * 1.15 + liveTick * 0.6));
  const d14Confidence = Math.min(88, Math.max(70, Math.round(75 + Math.abs(score - 50) * 0.22)));

  // 30-Day Horizon (Monthly macro bias)
  const d30Low22k = Math.round(rate22kPerGram * (1 + (score >= 55 ? 0.005 : -0.009) + macroMomentum * 1.35));
  const d30High22k = Math.round(rate22kPerGram * (1 + 0.030 + macroMomentum * 1.55 + liveTick * 0.5));
  const d30Confidence = Math.min(91, Math.max(72, Math.round(79 + Math.abs(score - 50) * 0.20)));

  const d3MidDiff = ((d3Low22k + d3High22k) / 2) - rate22kPerGram;
  const d3Direction = d3MidDiff <= -15 ? 'DOWN_DIP' : (d3MidDiff >= 20 ? 'UP_SURGE' : 'RANGEBOUND_ACCUMULATE');
  const d3Title = d3Direction === 'DOWN_DIP'
    ? 'SHORT-TERM PULLBACK EXPECTED (WAIT 2–3 DAYS)'
    : (d3Direction === 'UP_SURGE' ? 'OVERSOLD BOUNCE WINDOW (ACCUMULATE NOW)' : 'NEAR-TERM CONSOLIDATION (STAGGER BUYS)');
  const d3Icon = d3Direction === 'DOWN_DIP' ? '📉' : (d3Direction === 'UP_SURGE' ? '📈' : '⚖️');

  const corridorLow = Math.round((d7Low22k) / 50) * 50;
  const corridorHigh = Math.round((d7High22k) / 50) * 50;
  const upperBreakout = Math.round((rate22kPerGram * 1.022) / 50) * 50;
  const supportLevel = Math.round((rate22kPerGram * 0.988) / 50) * 50;

  const techNote = techSetup
    ? ` MJDTA daily RSI(14) stands at ${rsi14} vs 20-DMA ₹${(techSetup.sma20 || rate22kPerGram).toLocaleString('en-IN')}/g (as of ${techSetup.asOfDate}).`
    : '';
  const devTxt = breakout.deviations
    ? `XAU/USD ${breakout.deviations.goldDev20Pct >= 0 ? '+' : ''}${breakout.deviations.goldDev20Pct}% vs 20-DMA, USD/INR ${breakout.deviations.usdInrDev20Pct >= 0 ? '+' : ''}${breakout.deviations.usdInrDev20Pct}%, DXY ${breakout.deviations.dxyDev20Pct >= 0 ? '+' : ''}${breakout.deviations.dxyDev20Pct}%, 10Y ${breakout.deviations.yieldDiff20Bps >= 0 ? '+' : ''}${breakout.deviations.yieldDiff20Bps} bps`
    : '';

  const forecastData = {
    lastUpdated: now.toISOString(),
    nextUpdate: nextCheck.toISOString(),
    intervalHours: 3,
    analyst: 'AURUM Autonomous 3-Hour Macro Bullion Desk',
    updateMethod: 'Core >= 8/10 Drivers (XAU/USD 9.5, US10Y 8.5, USD/INR 8.0, DXY 8.0) + MJDTA Technicals',
    asOfDate: techSetup?.asOfDate || now.toISOString().slice(0, 10),
    marketBenchmark: {
      retailer: 'Active Retail Benchmark',
      rate22kPerGram,
      rate22kSovereign,
      rate24k10g,
      rate24k1g,
      usdInr,
      spotGoldUsd: goldPrice,
      landed22kWithDuty: Math.round(landed22kWithDuty),
      macroBreakoutScore: score,
      macroIndicators: {
        dxy: marketState.usd_index.price,
        usdInr,
        crudeOil: marketState.crude_oil.price,
        realYield: marketState.treasury_yield.realYield,
        nominal10Y: marketState.treasury_yield.price,
        vix: marketState.vix.price
      }
    },
    horizons: {
      '3d': {
        days: 3,
        label: 'Next 3 Days (Immediate Dip Window)',
        direction: d3Direction,
        directionTitle: d3Title,
        directionIcon: d3Icon,
        confidencePct: d3Confidence,
        expected22kRange: `₹${d3Low22k.toLocaleString('en-IN')} - ₹${d3High22k.toLocaleString('en-IN')} / g`,
        expected22kPerGramLow: d3Low22k,
        expected22kPerGramHigh: d3High22k,
        expectedSovereignRange: `₹${(d3Low22k * 8).toLocaleString('en-IN')} - ₹${(d3High22k * 8).toLocaleString('en-IN')} (8g)`,
        expected24k10gRange: `₹${(Math.round(d3Low22k * 24 / 22) * 10).toLocaleString('en-IN')} - ₹${(Math.round(d3High22k * 24 / 22) * 10).toLocaleString('en-IN')}`,
        priceChangeEst: `Projected move between ${formatSignedInr(d3Low22k - rate22kPerGram)} and ${formatSignedInr(d3High22k - rate22kPerGram)} per gram`,
        buyerStrategyAction: d3Direction === 'DOWN_DIP' ? 'WAIT 2 TO 3 DAYS BEFORE BUYING' : (d3Direction === 'UP_SURGE' ? 'ACCUMULATE AT CURRENT SUPPORT' : 'BUY 50% NOW, 50% ON DIP'),
        savingEstimateSovereign: d3Low22k < rate22kPerGram
          ? `Potential dip saving up to ₹${((rate22kPerGram - d3Low22k) * 8).toLocaleString('en-IN')} on 1 Sovereign (8g)`
          : `Upside exposure up to +₹${((d3High22k - rate22kPerGram) * 8).toLocaleString('en-IN')} per Sovereign`,
        rationale: `Core >= 8/10 drivers (${devTxt}) place Spot Gold at $${goldPrice.toFixed(0)}/oz and USD/INR at ₹${usdInr.toFixed(2)} (duty-paid import parity ~₹${Math.round(landed22kWithDuty).toLocaleString('en-IN')}/g).${techNote} Over the next 72 hours, retail rates are modeled within ₹${d3Low22k.toLocaleString('en-IN')}–₹${d3High22k.toLocaleString('en-IN')}/g.`,
        shoppingTip: d3Direction === 'DOWN_DIP'
          ? 'If buying jewellery, use this 2–3 day window to compare VA/making charges across stores and execute on dips near ₹' + d3Low22k.toLocaleString('en-IN') + '/g.'
          : 'Oversold/support dynamics limit deeper near-term downside; locking 22K rate-protection or partial coin tranches is favored.'
      },
      '7d': {
        days: 7,
        label: 'Next 7 Days (Weekly Outlook)',
        direction: 'RANGEBOUND_ACCUMULATE',
        directionTitle: 'CONSOLIDATION CORRIDOR (STAGGERED ACCUMULATION)',
        directionIcon: '⚖️',
        confidencePct: d7Confidence,
        expected22kRange: `₹${d7Low22k.toLocaleString('en-IN')} - ₹${d7High22k.toLocaleString('en-IN')} / g`,
        expected22kPerGramLow: d7Low22k,
        expected22kPerGramHigh: d7High22k,
        expectedSovereignRange: `₹${(d7Low22k * 8).toLocaleString('en-IN')} - ₹${(d7High22k * 8).toLocaleString('en-IN')} (8g)`,
        expected24k10gRange: `₹${(Math.round(d7Low22k * 24 / 22) * 10).toLocaleString('en-IN')} - ₹${(Math.round(d7High22k * 24 / 22) * 10).toLocaleString('en-IN')}`,
        priceChangeEst: `Rangebound between ${formatSignedInr(d7Low22k - rate22kPerGram)} and ${formatSignedInr(d7High22k - rate22kPerGram)} per gram`,
        buyerStrategyAction: 'STAGGER PURCHASES (50% NOW, 50% ON DIP)',
        savingEstimateSovereign: 'Reduce timing risk with rupee-cost averaging',
        rationale: `Global XAU/USD ($${goldPrice.toFixed(0)}/oz) and USD/INR (₹${usdInr.toFixed(2)}) anchor Indian landed bullion parity while US 10Y yields (${marketState.treasury_yield.price.toFixed(2)}%) and DXY (${marketState.usd_index.price.toFixed(2)}) govern breakout velocity. Expected weekly corridor sits around ₹${corridorLow.toLocaleString('en-IN')}–₹${corridorHigh.toLocaleString('en-IN')}/g.`,
        shoppingTip: 'Ask your jeweller about advance booking rate-protection plans so you lock today or lower if the rate dips before delivery.'
      },
      '14d': {
        days: 14,
        label: 'Next 14 Days (Fortnightly)',
        direction: score >= 55 ? 'UP_SURGE' : 'RANGEBOUND_ACCUMULATE',
        directionTitle: score >= 55 ? 'MODERATE UPWARD PRESSURE (ACCUMULATE DIPS)' : 'COMPETING MACRO FORCES (SELECTIVE ENTRY)',
        directionIcon: '📈',
        confidencePct: d14Confidence,
        expected22kRange: `₹${d14Low22k.toLocaleString('en-IN')} - ₹${d14High22k.toLocaleString('en-IN')} / g`,
        expected22kPerGramLow: d14Low22k,
        expected22kPerGramHigh: d14High22k,
        expectedSovereignRange: `₹${(d14Low22k * 8).toLocaleString('en-IN')} - ₹${(d14High22k * 8).toLocaleString('en-IN')} (8g)`,
        expected24k10gRange: `₹${(Math.round(d14Low22k * 24 / 22) * 10).toLocaleString('en-IN')} - ₹${(Math.round(d14High22k * 24 / 22) * 10).toLocaleString('en-IN')}`,
        priceChangeEst: `Projected move between ${formatSignedInr(d14Low22k - rate22kPerGram)} and ${formatSignedInr(d14High22k - rate22kPerGram)} per gram`,
        buyerStrategyAction: 'ACCUMULATE TRANCHES ON WEAKNESS',
        savingEstimateSovereign: `Upside range up to ${formatSignedInr((d14High22k - rate22kPerGram) * 8)} per Sovereign`,
        rationale: `With US 10Y Treasury yields at ${marketState.treasury_yield.price.toFixed(2)}% (real ${realYield.toFixed(2)}%) and DXY at ${marketState.usd_index.price.toFixed(2)}, any softening in yields/USD or Rupee depreciation above ₹${usdInr.toFixed(2)} transmits directly into higher domestic showroom quotes.`,
        shoppingTip: `If wedding jewellery is needed over the next two weeks, lock orders during intraday dips before any push toward ₹${upperBreakout.toLocaleString('en-IN')}/g.`
      },
      '30d': {
        days: 30,
        label: 'Next 30 Days (Monthly Outlook)',
        direction: 'SECULAR_BULLISH',
        directionTitle: score >= 60 ? 'SECULAR BREAKOUT BIAS (BUY DIPS AGGRESSIVELY)' : 'STRUCTURAL SUPPORT INTACT (ACCUMULATE ON PULLBACKS)',
        directionIcon: '🚀',
        confidencePct: d30Confidence,
        expected22kRange: `₹${d30Low22k.toLocaleString('en-IN')} - ₹${d30High22k.toLocaleString('en-IN')} / g`,
        expected22kPerGramLow: d30Low22k,
        expected22kPerGramHigh: d30High22k,
        expectedSovereignRange: `₹${(d30Low22k * 8).toLocaleString('en-IN')} - ₹${(d30High22k * 8).toLocaleString('en-IN')} (8g)`,
        expected24k10gRange: `₹${(Math.round(d30Low22k * 24 / 22) * 10).toLocaleString('en-IN')} - ₹${(Math.round(d30High22k * 24 / 22) * 10).toLocaleString('en-IN')}`,
        priceChangeEst: `Projected 30-day shift between ${formatSignedInr(d30Low22k - rate22kPerGram)} and ${formatSignedInr(d30High22k - rate22kPerGram)} per gram`,
        buyerStrategyAction: 'LONG-TERM BUY BIAS ACTIVE',
        savingEstimateSovereign: `Potential appreciation up to ${formatSignedInr((d30High22k - rate22kPerGram) * 8)} per Sovereign`,
        rationale: `The Core >= 8/10 Macro Matrix (Score: ${score}/100) synthesizes XAU/USD trend ($${goldPrice.toFixed(0)}/oz), US 10Y yields (${marketState.treasury_yield.price.toFixed(2)}%), USD/INR (₹${usdInr.toFixed(2)}), and DXY (${marketState.usd_index.price.toFixed(2)}). Pullbacks toward ₹${supportLevel.toLocaleString('en-IN')}/g offer favorable medium-term risk/reward.`,
        shoppingTip: 'For long-term coin/bar investors, systematic accumulation on multi-day pullbacks beats chasing green spikes.'
      }
    },
    history: []
  };

  // Preserve past history if existing
  try {
    if (fs.existsSync(FORECAST_FILE)) {
      const existing = JSON.parse(fs.readFileSync(FORECAST_FILE, 'utf8'));
      if (existing && Array.isArray(existing.history)) {
        forecastData.history = existing.history;
      }
    }
  } catch (e) {}

  // Prepend current check to history (keep latest 20)
  forecastData.history.unshift({
    timestamp: now.toISOString(),
    grtRate22k: rate22kPerGram,
    score,
    macroSnapshot: {
      dxy: marketState.usd_index.price,
      crude: marketState.crude_oil.price,
      realYield: marketState.treasury_yield.realYield,
      vix: marketState.vix.price
    },
    call3d: `₹${d3Low22k.toLocaleString('en-IN')} - ₹${d3High22k.toLocaleString('en-IN')}`,
    call7d: `₹${d7Low22k.toLocaleString('en-IN')} - ₹${d7High22k.toLocaleString('en-IN')}`,
    status: 'VERIFIED_ACTIVE'
  });
  forecastData.history.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  if (forecastData.history.length > 20) {
    forecastData.history = forecastData.history.slice(0, 20);
  }

  // Ensure data dir exists
  try {
    const dataDir = path.dirname(FORECAST_FILE);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    fs.writeFileSync(FORECAST_FILE, JSON.stringify(forecastData, null, 2), 'utf8');
  } catch (e) {
    // Read-only filesystem in serverless environments (Vercel)
  }
  console.log(`[AURUM 3-HOUR ENGINE] Forecast updated at ${now.toLocaleTimeString()} (Next: ${nextCheck.toLocaleTimeString()})`);
  return forecastData;
}

function loadOrCreateForecast(base22kRate = currentBenchmark22kRate) {
  try {
    if (fs.existsSync(FORECAST_FILE)) {
      const raw = fs.readFileSync(FORECAST_FILE, 'utf8');
      const data = JSON.parse(raw);
      if (data && data.horizons) {
        if (data.marketBenchmark && data.marketBenchmark.rate22kPerGram) {
          currentBenchmark22kRate = data.marketBenchmark.rate22kPerGram;
        }
        return data;
      }
    }
  } catch (e) {
    console.warn('Could not read forecast file, generating fresh one:', e.message);
  }
  return generateAndSaveForecast(base22kRate);
}

// 3-Hour Autonomous Timer (10,800,000 ms)
const THREE_HOURS_MS = 3 * 60 * 60 * 1000;
setInterval(() => {
  console.log('[AURUM 3-HOUR ENGINE] Executing automated 3-hour scheduled market check...');
  generateAndSaveForecast(currentBenchmark22kRate);
}, THREE_HOURS_MS);

// Load or generate forecast on boot with active benchmark
let currentForecastCache = generateAndSaveForecast(currentBenchmark22kRate);

async function syncAllLiveFeeds() {
  const results = { macroUpdated: false, macroHistoryUpdated: false, historyUpdated: false, orgsUpdated: false };

  // Refresh full 2006-2026 Core (>=8/10) macro history if missing or >6h stale
  const existingHistMacro = macroService.loadHistoricalMacro();
  const macroAgeHrs = existingHistMacro?.lastSyncedAt
    ? (Date.now() - new Date(existingHistMacro.lastSyncedAt).getTime()) / (1000 * 60 * 60)
    : Infinity;
  const shouldSyncMacroHist = !existingHistMacro || !Array.isArray(existingHistMacro.dailySeries) || existingHistMacro.dailySeries.length < 4000 || macroAgeHrs > 6;

  const [macroRes, histRes, orgRes, macroHistRes] = await Promise.allSettled([
    macroService.syncLiveMacro(),
    historySync.syncMissedDates(),
    orgService.syncTop3Organisations(),
    shouldSyncMacroHist ? macroService.syncHistoricalMacroSince2006() : Promise.resolve(null)
  ]);

  if (macroRes.status === 'fulfilled' && macroRes.value) {
    Object.assign(marketState, macroRes.value.market);
    if (Array.isArray(macroRes.value.historical) && macroRes.value.historical.length >= 2) {
      historicalData = macroRes.value.historical;
    }
    results.macroUpdated = true;
    results.macro = macroRes.value.market;
  } else if (macroRes.status === 'rejected') {
    console.warn('[Macro Sync Warning]:', macroRes.reason?.message || macroRes.reason);
  }

  if (macroHistRes.status === 'fulfilled' && macroHistRes.value) {
    backtestService.invalidateCache();
    results.macroHistoryUpdated = true;
    results.macroHistoryPoints = macroHistRes.value.alignedCount;
  } else if (macroHistRes.status === 'rejected') {
    console.warn('[Macro 20Yr History Sync Warning]:', macroHistRes.reason?.message || macroHistRes.reason);
  }

  if (histRes.status === 'fulfilled' && histRes.value) {
    backtestService.invalidateCache();
    results.historyUpdated = histRes.value.updated;
    results.history = histRes.value;
  } else if (histRes.status === 'rejected') {
    console.warn('[MJDTA History Sync Warning]:', histRes.reason?.message || histRes.reason);
  }

  if (orgRes.status === 'fulfilled' && orgRes.value) {
    const active = orgRes.value.organisations.find(o => o.id === orgRes.value.activeBenchmarkId) || orgRes.value.organisations[0];
    if (active && active.rate22k_1g) {
      currentBenchmark22kRate = active.rate22k_1g;
    }
    results.orgsUpdated = true;
    results.organisations = orgRes.value;
  } else if (orgRes.status === 'rejected') {
    console.warn('[Org Sync Warning]:', orgRes.reason?.message || orgRes.reason);
  }

  currentForecastCache = generateAndSaveForecast(currentBenchmark22kRate);
  return results;
}

// Autonomous background sync (Only in standalone node environment, not in Vercel serverless)
if (!process.env.VERCEL) {
  syncAllLiveFeeds().catch(e => console.warn('[Startup Sync Warning]:', e.message));

  const ORG_SYNC_INTERVAL_MS = 15 * 60 * 1000;
  setInterval(() => {
    console.log('[AURUM ENGINE] Running scheduled 15-minute live macro, history & org sync...');
    syncAllLiveFeeds().catch(e => console.warn('[Scheduled Sync Warning]:', e.message));
  }, ORG_SYNC_INTERVAL_MS);
}

// HTTP Server Request Handler
async function handleRequest(req, res) {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;

  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // API: System & Neon Services Health Status
  if (pathname === '/api/status' && req.method === 'GET') {
    const dbConnected = await db.isDbConnected();
    let counts = { mjdta: 0, macro: 0, organisations: 0, kv: 0 };
    if (dbConnected && db.sql) {
      try {
        const [mRes] = await db.sql`SELECT COUNT(*)::int as count FROM mjdta_history;`;
        const [macRes] = await db.sql`SELECT COUNT(*)::int as count FROM macro_history;`;
        const [oRes] = await db.sql`SELECT COUNT(*)::int as count FROM organisations;`;
        const [kRes] = await db.sql`SELECT COUNT(*)::int as count FROM app_kv_store;`;
        counts = {
          mjdta: mRes?.count || 0,
          macro: macRes?.count || 0,
          organisations: oRes?.count || 0,
          kv: kRes?.count || 0
        };
      } catch (e) {}
    }

    const authCfg = await neonAuth.getAuthConfig();
    const rtCfg = await realtimeService.getRealtimeConfig();

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ONLINE',
      timestamp: new Date().toISOString(),
      branch: process.env.NEON_BRANCH || 'production',
      branchId: process.env.NEON_BRANCH_ID || null,
      services: {
        postgres: {
          status: dbConnected ? 'CONNECTED' : 'DISCONNECTED',
          engine: 'Lakebase Postgres 18.7 (Neon)',
          tables: counts
        },
        auth: {
          status: authCfg.status,
          provider: authCfg.provider,
          baseUrl: authCfg.baseUrl
        },
        aiGateway: {
          status: process.env.NEON_AI_GATEWAY_TOKEN ? 'CONFIGURED' : 'UNAVAILABLE',
          baseUrl: process.env.NEON_AI_GATEWAY_BASE_URL || null
        },
        realtime: {
          status: rtCfg.status,
          url: rtCfg.url
        },
        functions: {
          status: 'DEPLOYED',
          hostSuffix: process.env.NEON_FUNCTION_HOST_SUFFIX || null,
          endpoints: [
            { name: 'hello', url: process.env.NEON_FUNCTION_HOST_SUFFIX ? `https://${process.env.NEON_BRANCH_ID || 'branch'}-hello.${process.env.NEON_FUNCTION_HOST_SUFFIX}/` : null }
          ]
        }
      }
    }));
    return;
  }

  // API: Neon Auth Config
  if (pathname === '/api/auth/config' && req.method === 'GET') {
    const config = await neonAuth.getAuthConfig();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(config));
    return;
  }

  // API: Neon AI Gateway Status
  if (pathname === '/api/ai/status' && req.method === 'GET') {
    const aiStatus = await aiGateway.queryGatewayModels();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(aiStatus));
    return;
  }

  // API: Neon AI Gateway Market Commentary
  if (pathname === '/api/ai/forecast-commentary' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body || '{}');
        const analysis = await aiGateway.generateMarketAnalysis({
          gold: currentBenchmark22kRate,
          usdInr: marketState.usd_inr?.price,
          bias: currentForecastCache?.recommendation?.macroBias || 'NEUTRAL',
          ...payload
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, ...analysis }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // API: Neon Realtime Config
  if (pathname === '/api/realtime/config' && req.method === 'GET') {
    const rtConfig = await realtimeService.getRealtimeConfig();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(rtConfig));
    return;
  }

  // API: Neon Functions Status
  if (pathname === '/api/functions/status' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'DEPLOYED',
      hostSuffix: process.env.NEON_FUNCTION_HOST_SUFFIX || null,
      functions: [
        {
          name: 'hello',
          source: './hello.ts',
          url: process.env.NEON_FUNCTION_HOST_SUFFIX ? `https://${process.env.NEON_BRANCH_ID || 'branch'}-hello.${process.env.NEON_FUNCTION_HOST_SUFFIX}/` : null
        }
      ]
    }));
    return;
  }

  // API: Get Top 3 Indian Bullion Organisations
  if (pathname === '/api/organisations' && req.method === 'GET') {
    const orgData = orgService.getOrganisationsData();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(orgData));
    return;
  }

  // API: Manually Sync Live Bullion Rates (Fast, resilient for serverless & local)
  if (pathname === '/api/organisations/sync' && req.method === 'POST') {
    try {
      const updated = await orgService.syncTop3Organisations();
      const active = updated?.organisations?.find(o => o.id === updated.activeBenchmarkId) || updated?.organisations?.[0];
      if (active && active.rate22k_1g) {
        currentBenchmark22kRate = active.rate22k_1g;
      }
      currentForecastCache = generateAndSaveForecast(currentBenchmark22kRate);
      const updatedIndian = calculateIndianPrices(marketState.gold.price, marketState.usd_inr.price, currentBenchmark22kRate);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        message: 'Live bullion association rates synced successfully',
        data: updated,
        currentBenchmark22kRate,
        india: updatedIndian
      }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // API: Backfill any missed MJDTA dates up to today and recompute backtest
  if (pathname === '/api/history/sync-missed' && req.method === 'POST') {
    try {
      const syncOut = await historySync.syncMissedDates();
      backtestService.invalidateCache();
      const backtest = backtestService.getBacktestResults();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        sync: syncOut,
        backtestSummary: backtest.summary,
        currentMarketSetup: backtest.currentMarketSetup
      }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // API: Select Active Benchmark Organisation
  if (pathname === '/api/organisations/select' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const parsed = JSON.parse(body || '{}');
        const selected = orgService.setActiveBenchmark(parsed.id);
        if (selected && selected.rate22k_1g) {
          currentBenchmark22kRate = selected.rate22k_1g;
          const freshForecast = generateAndSaveForecast(currentBenchmark22kRate);
          const updatedIndian = calculateIndianPrices(marketState.gold.price, marketState.usd_inr.price, currentBenchmark22kRate);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: true,
            activeBenchmark: selected,
            benchmark22kRate: currentBenchmark22kRate,
            india: updatedIndian,
            forecast: freshForecast,
            message: `Active benchmark switched to ${selected.name} (₹${selected.rate22k_1g.toLocaleString('en-IN')}/g)`
          }));
          return;
        }
      } catch (e) {}
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid organisation id' }));
    });
    return;
  }

  // API: Get 20-Year Strategy Backtest Results
  if (pathname === '/api/backtest' && req.method === 'GET') {
    try {
      const results = backtestService.getBacktestResults();
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache, no-store, must-revalidate'
      });
      res.end(JSON.stringify(results));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // API: Download 2006-2026 MJDTA Historical CSV
  if (pathname === '/api/history/download' && req.method === 'GET') {
    try {
      const historyPath = path.join(__dirname, 'data', 'mjdta_history_2006_2026.json');
      if (fs.existsSync(historyPath)) {
        const raw = fs.readFileSync(historyPath, 'utf8');
        const parsed = JSON.parse(raw);
        let csv = 'Date,Gold_22K_Per_Gram,Gold_22K_Per_Sovereign_8g,Gold_24K_Per_Gram,Silver_Per_Gram,Daily_Change_INR,Pct_Change\n';
        const descendingSeries = [...parsed.dailySeries].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
        descendingSeries.forEach(d => {
          csv += `${d.date},${d.gold22k_1g},${d.gold22k_8g || d.gold22k_1g * 8},${d.gold24k_1g},${d.silver_1g || 0},${d.change || 0},${d.pctChange || 0}\n`;
        });
        res.writeHead(200, {
          'Content-Type': 'text/csv',
          'Content-Disposition': 'attachment; filename="mjdta_gold_history_2006_2026.csv"',
          'Cache-Control': 'no-cache'
        });
        res.end(csv);
        return;
      }
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Error generating CSV: ' + err.message);
      return;
    }
  }

  // API: Get Live Jeweller Benchmark Rate
  if (pathname === '/api/benchmark' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      benchmark22kRate: currentBenchmark22kRate,
      retailer: 'GRT Jewellers (grtjewels.com)'
    }));
    return;
  }

  // API: Update Live Jeweller Benchmark Rate & Sync Entire Terminal
  if (pathname === '/api/benchmark/update' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const parsed = JSON.parse(body || '{}');
        const rate = parseFloat(parsed.rate22k || parsed.base22kRate);
        if (rate && rate > 1000) {
          currentBenchmark22kRate = Math.round(rate);
          const freshForecast = generateAndSaveForecast(currentBenchmark22kRate);
          const updatedIndian = calculateIndianPrices(marketState.gold.price, marketState.usd_inr.price, currentBenchmark22kRate);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: true,
            benchmark22kRate: currentBenchmark22kRate,
            india: updatedIndian,
            forecast: freshForecast,
            message: `GRT Jewellers Benchmark updated to ₹${currentBenchmark22kRate.toLocaleString('en-IN')}/g`
          }));
          return;
        }
      } catch (err) {}
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid rate parameter' }));
    });
    return;
  }

  // API: Get Full Indicators & Breakout Matrix + Indian Pricing
  if (pathname === '/api/indicators') {
    const breakout = calculateBreakoutMatrix(marketState);
    const indianPrices = calculateIndianPrices(marketState.gold.price, marketState.usd_inr.price, currentBenchmark22kRate);
    const retailAdvice = getRetailAdvice(breakout.score, breakout.isPerfectStorm, marketState.usd_inr.price);

    let empiricalCorr = null;
    try {
      empiricalCorr = backtestService.getBacktestResults()?.macroCorrelations || null;
    } catch (e) {}

    const fallbackMatrix = [
      { asset: 'Gold (XAU/USD)', gold: 1.00, inr: 0.90, usd: -0.45, yield: -0.18, usdInr: -0.12 },
      { asset: 'Indian Gold (INR)', gold: 0.90, inr: 1.00, usd: -0.35, yield: -0.14, usdInr: 0.25 },
      { asset: 'US Dollar (DXY)', gold: -0.45, inr: -0.35, usd: 1.00, yield: 0.35, usdInr: 0.32 },
      { asset: 'US 10Y Yield', gold: -0.18, inr: -0.14, usd: 0.35, yield: 1.00, usdInr: 0.10 },
      { asset: 'USD / INR', gold: -0.12, inr: 0.25, usd: 0.32, yield: 0.10, usdInr: 1.00 }
    ];

    const responsePayload = {
      market: marketState,
      india: indianPrices,
      retailAdvice,
      breakout,
      coreWeights: macroService.CORE_FACTOR_WEIGHTS,
      secondaryWeights: macroService.SECONDARY_FACTOR_WEIGHTS,
      historical: historicalData,
      correlationMatrix: empiricalCorr?.matrix || fallbackMatrix,
      correlationMeta: empiricalCorr ? {
        timeframe: empiricalCorr.timeframe,
        sampleSize: empiricalCorr.sampleSize,
        method: empiricalCorr.method
      } : null,
      macroRationale: {
        spotGold: "Core Driver (9.5 / 10 | 27.9% Weight): XAU/USD sets the primary global bullion trend. Sustained closes above 20-DMA and 50-DMA confirm institutional accumulation and flow directly into MCX/Chennai parity.",
        treasuryYields: "Core Driver (8.5 / 10 | 25.0% Weight): Gold pays no yield, so falling US 10Y Treasury yields lower the opportunity cost of holding non-yielding bullion.",
        indianRupee: "Core Driver (8.0 / 10 | 23.5% Weight): India imports ~90% of its gold requirement. A weakening Rupee (rising USD/INR) mechanically lifts landed 22K INR rates even when XAU/USD consolidates.",
        usdIndex: "Core Driver (8.0 / 10 | 23.5% Weight): Because bullion is priced in dollars, a softer DXY expands global purchasing power while DXY surges cap spot rallies.",
        crudeOil: "Secondary Context Only (5.5 / 10): Tracked for long-run inflation context and excluded from primary Core >=8/10 breakout & prediction weights.",
        vixPanic: "Secondary Context Only (4.5 / 10): Short-lived fear spikes create brief noise; excluded from primary Core >=8/10 breakout & prediction weights."
      }
    };

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(responsePayload));
    return;
  }

  // API: Get Latest 3-Hour Autonomous Forecast
  if (pathname === '/api/forecast' && req.method === 'GET') {
    const forecast = loadOrCreateForecast();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(forecast));
    return;
  }

  // API: Force Immediate 3-Hour Evaluation & Refresh
  if (pathname === '/api/forecast/refresh' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const parsed = JSON.parse(body || '{}');
        const rate = parsed.base22kRate ? Math.round(parsed.base22kRate) : currentBenchmark22kRate;
        const freshForecast = generateAndSaveForecast(rate);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          message: 'Autonomous 3-hour forecast evaluation executed successfully',
          forecast: freshForecast
        }));
      } catch (err) {
        const freshForecast = generateAndSaveForecast(currentBenchmark22kRate);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          message: 'Forecast refreshed with default GRT benchmark rate',
          forecast: freshForecast
        }));
      }
    });
    return;
  }

  // API: Custom Scenario Simulation (Core >=8/10 Macro Drivers)
  if (pathname === '/api/simulate' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const params = JSON.parse(body || '{}');
        const customState = JSON.parse(JSON.stringify(marketState));
        const baselines = macroService.loadHistoricalMacro()?.latestBaselines || {};

        const baseGold = baselines.gold?.sma20 || marketState.gold.sma20 || marketState.gold.price;
        const baseYield = baselines.treasury_yield?.sma20 || marketState.treasury_yield.sma20 || marketState.treasury_yield.price;
        const baseInr = baselines.usd_inr?.sma20 || marketState.usd_inr.sma20 || marketState.usd_inr.price;
        const baseDxy = baselines.usd_index?.sma20 || marketState.usd_index.sma20 || marketState.usd_index.price;

        if (params.goldPrice !== undefined) {
          customState.gold.price = parseFloat(params.goldPrice);
          customState.gold.changePercent24h = baseGold > 0 ? ((customState.gold.price - baseGold) / baseGold) * 100 : 0;
        }
        const incomingYield = params.yield10y !== undefined ? params.yield10y : params.realYield;
        if (incomingYield !== undefined) {
          customState.treasury_yield.price = parseFloat(incomingYield);
          customState.treasury_yield.changePercent24h = baseYield > 0 ? ((customState.treasury_yield.price - baseYield) / baseYield) * 100 : 0;
        }
        if (params.usdInr !== undefined) {
          customState.usd_inr.price = parseFloat(params.usdInr);
          customState.usd_inr.changePercent24h = baseInr > 0 ? ((customState.usd_inr.price - baseInr) / baseInr) * 100 : 0;
        }
        if (params.dxyPrice !== undefined) {
          customState.usd_index.price = parseFloat(params.dxyPrice);
          customState.usd_index.changePercent24h = baseDxy > 0 ? ((customState.usd_index.price - baseDxy) / baseDxy) * 100 : 0;
        }

        const simulatedBreakout = calculateBreakoutMatrix(customState);

        // Estimate Spot Gold impact strictly from Core >=8/10 drivers relative to live baseline
        const liveDxy = marketState.usd_index.price || baseDxy || 100;
        const liveYield = marketState.treasury_yield.price || baseYield || 4.5;
        const liveGold = marketState.gold.price || baseGold || 4000;

        const dxyDeltaPct = ((customState.usd_index.price - liveDxy) / liveDxy) * 100;
        const yieldDeltaPctPts = customState.treasury_yield.price - liveYield;
        const spotUserShiftPct = ((customState.gold.price - liveGold) / liveGold) * 100;

        const estGoldChangePct = (
          spotUserShiftPct +
          (-dxyDeltaPct * 0.95) +
          (-yieldDeltaPctPts * 3.8)
        );

        const projectedGoldPrice = +(liveGold * (1 + (estGoldChangePct / 100))).toFixed(2);
        const liveInr = marketState.usd_inr.price || baseInr || customState.usd_inr.price;
        const fxScale = liveInr > 0 ? (customState.usd_inr.price / liveInr) : 1;
        const sim22kRate = Math.round(currentBenchmark22kRate * (1 + (estGoldChangePct / 100)) * fxScale);
        const projectedIndian = calculateIndianPrices(projectedGoldPrice, customState.usd_inr.price, sim22kRate);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          simulatedBreakout,
          projectedGoldPrice,
          estGoldChangePct: +estGoldChangePct.toFixed(2),
          baselineGoldPrice: liveGold,
          projectedIndian
        }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON payload' }));
      }
    });
    return;
  }

  // Static File Serving
  let safePath = path.normalize(pathname).replace(/^(\.\.[\/\\])+/, '');
  if (safePath === '/' || safePath === '') {
    safePath = '/index.html';
  }

  const filePath = path.join(PUBLIC_DIR, safePath);
  const ext = path.extname(filePath).toLowerCase();

  fs.readFile(filePath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('404 Not Found');
      } else {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('500 Server Error: ' + err.code);
      }
    } else {
      res.writeHead(200, {
        'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      });
      res.end(content);
    }
  });
}

const server = http.createServer(handleRequest);

let currentPort = PORT;

function startServer(p) {
  server.listen(p, () => {
    const addr = server.address();
    const actualPort = addr ? addr.port : p;
    console.log(`================================================================`);
    console.log(`🌟 AURUM MATRIX LIVE SERVER STARTED ON PORT ${actualPort}`);
    console.log(`🇮🇳 Indian Retail Bullion Pricing & Autonomous 3-Hour Engine`);
    console.log(`📡 URL: http://localhost:${actualPort}`);
    console.log(`================================================================`);
  });
}

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    currentPort += 1;
    console.log(`Port busy, retrying on ${currentPort}...`);
    setTimeout(() => {
      startServer(currentPort);
    }, 200);
  } else {
    console.error('Server error:', e);
  }
});

if (require.main === module) {
  startServer(currentPort);
}

module.exports = handleRequest;
module.exports.server = server;
module.exports.handleRequest = handleRequest;
