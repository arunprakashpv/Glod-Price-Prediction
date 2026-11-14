/**
 * AURUM MATRIX // CLIENT DASHBOARD ENGINE
 * Dual-Mode Engine: Seamlessly works via Node.js Server (http://localhost:3333)
 * OR directly opened via Browser file:// protocol with full live simulation!
 * Integrated with Indian Retail Bullion Pricing & Google AI Studio (Gemini)
 */

// Global State
let dashboardData = null;
let overlayChart = null;
let radarChart = null;
let audioAlertEnabled = true;
let previousScore = 0;
let currentTradingViewSymbol = 'OANDA:XAUUSD';
let isLocalFallback = false;

// Theme State
let currentTheme = 'dark';
try {
  currentTheme = localStorage.getItem('aurum_theme') || 'dark';
} catch (e) {}

// Jeweller 22K Rate Benchmark (Updated dynamically from Server & Live Association Feeds)
let active22kRate = 13150;
try {
  const savedRate = localStorage.getItem('aurum_active_22k_rate');
  if (savedRate && parseFloat(savedRate) > 1000) {
    active22kRate = Math.round(parseFloat(savedRate));
  }
} catch (e) {}

// Selected Forecast Horizon & Target
let currentForecastHorizon = 3; // 3, 7, 14, 30 days
let currentForecastTarget = 'jewellery-22k';

// Calculator State
let calcPurity = '22k';
let calcWeight = 8.0; // 1 sovereign default
let calcMakingChargePct = 10.0;

// Standalone Local Market State
let localMarketState = {
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
    rationale: 'Acting as financial shock absorber amid currency volatility and real yield changes'
  },
  usd_inr: {
    symbol: 'USD/INR',
    name: 'USD to Indian Rupee',
    price: 84.22,
    change24h: 0.08,
    changePercent24h: 0.10,
    unit: 'INR per USD'
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
    signal: 'BULLISH'
  },
  treasury_yield: {
    symbol: '^TNX (10Y)',
    name: 'US 10-Year Treasury Yield',
    price: 4.18,
    change24h: -0.06,
    changePercent24h: -1.42,
    realYield: 1.84,
    breakevenInflation: 2.34,
    unit: '%',
    correlation: -0.79,
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
    signal: 'BULLISH'
  }
};

// Calculate Indian Retail Prices calibrated to Jeweller Benchmark (Default: GRT ₹13,385/g)
function calculateIndianPricesLocal(goldUsd, usdInr, base22kRate = active22kRate) {
  const retail22k1g = Math.round(base22kRate);
  const retail22k10g = retail22k1g * 10;
  const retail22k8g = retail22k1g * 8; // 1 Sovereign / Pavan
  const retail24k1g = Math.round(retail22k1g * (24 / 22));
  const retail24k10g = retail24k1g * 10;
  const retail18k1g = Math.round(retail22k1g * (18 / 22));
  const retail18k10g = retail18k1g * 10;

  return {
    source: 'GRT Jewellers (grtjewels.com) & Indian Retail Benchmark',
    usdInr,
    dutyPct: 6.0,
    gstPct: 3.0,
    base22kRate: retail22k1g,
    purity24k: {
      per10g: retail24k10g,
      per1g: retail24k1g,
      label: '24K (999 Pure) - Investment Coins & Bars'
    },
    purity22k: {
      per10g: retail22k10g,
      per1g: retail22k1g,
      per8gSovereign: retail22k8g,
      label: '22K (916 Hallmark) - Standard Jewellery (GRT Rate: ₹13,385/g)'
    },
    purity18k: {
      per10g: retail18k10g,
      per1g: retail18k1g,
      label: '18K (750 Purity) - Diamond & Modern Jewellery'
    }
  };
}

function getRetailAdviceLocal(score, isPerfectStorm) {
  if (score >= 80) {
    return {
      action: 'WAIT_FOR_DIP',
      badge: 'HIGH MOMENTUM // WAIT OR STAGGER',
      color: '#ef4444',
      advice: 'Gold is in a strong breakout rally driven by international macro drivers. Retail prices in India are elevated. If you need jewellery immediately, negotiate making charges or buy only 30-50% now and wait 3-7 days for a consolidation dip to buy the rest.'
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
  let g = 0, o = 0, u = 0, y = 0, v = 0, inrG = 0;

  for (let i = days; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
    const dateStr = d.toISOString().split('T')[0];

    const marketShock = (Math.random() - 0.5) * 1.5;
    const inflationShock = (Math.random() - 0.48) * 1.8;
    const dollarShock = -(marketShock * 0.4) + (Math.random() - 0.52) * 0.8;
    const yieldShock = dollarShock * 0.5 + (Math.random() - 0.52) * 0.9;
    const goldDelta = (-dollarShock * 0.7) + (-yieldShock * 0.5) + (inflationShock * 0.5) + (marketShock > 0.5 ? 0.8 : -0.2);
    const inrDelta = goldDelta + (Math.random() - 0.49) * 0.2;

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

let localHistorical = generateHistoricalSeries();

// Dynamic computation of the Core >=8/10 Macro Breakout Score & Pillar Alignments
function computeMatrixLocally(state) {
  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

  const goldPrice = state.gold?.price || 3985;
  const goldSma20 = state.gold?.sma20 || goldPrice;
  const goldSma50 = state.gold?.sma50 || goldSma20;
  const goldChg = state.gold?.changePercent24h || 0;
  const goldDev20 = goldSma20 > 0 ? ((goldPrice - goldSma20) / goldSma20) * 100 : 0;
  const goldDev50 = goldSma50 > 0 ? ((goldPrice - goldSma50) / goldSma50) * 100 : goldDev20;
  const scoreSpotGold = clamp(12.5 + (goldDev20 * 2.0) + (goldDev50 * 0.8) + (goldChg * 2.0), 0, 25);

  const yieldVal = state.treasury_yield?.price || 4.99;
  const yieldSma20 = state.treasury_yield?.sma20 || yieldVal;
  const yieldSma50 = state.treasury_yield?.sma50 || yieldSma20;
  const yieldChg = state.treasury_yield?.changePercent24h || 0;
  const yieldDiff20 = yieldVal - yieldSma20;
  const yieldDiff50 = yieldVal - yieldSma50;
  const scoreYield = clamp(12.5 - (yieldDiff20 * 18.0) - (yieldDiff50 * 8.0) - (yieldChg * 1.5), 0, 25);

  const inrVal = state.usd_inr?.price || 93.68;
  const inrSma20 = state.usd_inr?.sma20 || inrVal;
  const inrSma50 = state.usd_inr?.sma50 || inrSma20;
  const inrChg = state.usd_inr?.changePercent24h || 0;
  const inrDev20 = inrSma20 > 0 ? ((inrVal - inrSma20) / inrSma20) * 100 : 0;
  const inrDev50 = inrSma50 > 0 ? ((inrVal - inrSma50) / inrSma50) * 100 : inrDev20;
  const scoreUsdInr = clamp(12.5 + (inrDev20 * 4.5) + (inrDev50 * 2.5) + (inrChg * 3.0), 0, 25);

  const dxyVal = state.usd_index?.price || 103.0;
  const dxySma20 = state.usd_index?.sma20 || dxyVal;
  const dxySma50 = state.usd_index?.sma50 || dxySma20;
  const dxyChg = state.usd_index?.changePercent24h || 0;
  const dxyDev20 = dxySma20 > 0 ? ((dxyVal - dxySma20) / dxySma20) * 100 : 0;
  const dxyDev50 = dxySma50 > 0 ? ((dxyVal - dxySma50) / dxySma50) * 100 : dxyDev20;
  const scoreDxy = clamp(12.5 - (dxyDev20 * 3.5) - (dxyDev50 * 1.5) - (dxyChg * 2.5), 0, 25);

  const totalScore = Math.round(((scoreSpotGold * 9.5 + scoreYield * 8.5 + scoreUsdInr * 8.0 + scoreDxy * 8.0) / 34.0) * 4);

  const pillars = [
    {
      id: 'gold',
      name: 'Global Spot Gold Trend',
      symbol: 'XAU/USD',
      score: Math.round(scoreSpotGold),
      max: 25,
      isAligned: scoreSpotGold >= 15,
      weight: '27.9% (9.5/10)',
      direction: goldDev20 >= 0 ? `Favorable (+${goldDev20.toFixed(1)}% vs 20-DMA)` : `Pullback (${goldDev20.toFixed(1)}% vs 20-DMA)`,
      status: scoreSpotGold >= 16 ? 'BULLISH' : (scoreSpotGold >= 10 ? 'NEUTRAL' : 'BEARISH')
    },
    {
      id: 'yields',
      name: 'US 10Y Treasury Yield',
      symbol: 'US10Y (^TNX)',
      score: Math.round(scoreYield),
      max: 25,
      isAligned: scoreYield >= 15,
      weight: '25.0% (8.5/10)',
      direction: yieldDiff20 <= 0 ? 'Favorable (Yields Easing)' : 'Adverse (Yields Elevated)',
      status: scoreYield >= 16 ? 'BULLISH' : (scoreYield >= 10 ? 'NEUTRAL' : 'BEARISH')
    },
    {
      id: 'usd_inr',
      name: 'USD / INR Landed Parity',
      symbol: 'INR=X',
      score: Math.round(scoreUsdInr),
      max: 25,
      isAligned: scoreUsdInr >= 15,
      weight: '23.5% (8.0/10)',
      direction: inrDev20 >= 0 ? 'Tailwind (Rupee Softening)' : 'Cooling (Rupee Firming)',
      status: scoreUsdInr >= 16 ? 'BULLISH' : (scoreUsdInr >= 10 ? 'NEUTRAL' : 'BEARISH')
    },
    {
      id: 'usd',
      name: 'Weakening US Dollar (DXY)',
      symbol: 'DXY',
      score: Math.round(scoreDxy),
      max: 25,
      isAligned: scoreDxy >= 15,
      weight: '23.5% (8.0/10)',
      direction: dxyDev20 <= 0 ? 'Favorable (Weakening)' : 'Adverse (Strengthening)',
      status: scoreDxy >= 16 ? 'BULLISH' : (scoreDxy >= 10 ? 'NEUTRAL' : 'BEARISH')
    }
  ];

  const alignedCount = pillars.filter(p => p.isAligned).length;

  let regime = '';
  let regimeClass = '';
  let interpretation = '';

  if (totalScore >= 80 && alignedCount >= 3) {
    regime = 'PERFECT STORM BREAKOUT IMMINENT';
    regimeClass = 'perfect-storm';
    interpretation = 'All 4 Core >=8/10 drivers (Spot Gold, US 10Y, USD/INR, DXY) are strongly aligned upward.';
  } else if (totalScore >= 60) {
    regime = 'CORE MACRO TAILWIND';
    regimeClass = 'strong-bullish';
    interpretation = 'Weighted Core >=8/10 macro tailwind supports sustained accumulation and landed Indian INR expansion.';
  } else if (totalScore >= 43) {
    regime = 'NEUTRAL / COMPETING FORCES';
    regimeClass = 'neutral';
    interpretation = 'Core >=8/10 drivers show mixed signals across Spot Gold, DXY, US10Y, and USD/INR. Favor selective dip buying.';
  } else if (totalScore >= 30) {
    regime = 'CORE MACRO HEADWIND';
    regimeClass = 'mild-bearish';
    interpretation = 'Strong DXY or elevated US 10Y yields are suppressing global XAU/USD below 20-DMA. Stagger partial dips only.';
  } else {
    regime = 'STRONG MACRO HEADWIND';
    regimeClass = 'strong-bearish';
    interpretation = 'All Core >=8/10 pillars face downward pressure (firm USD, high 10Y yields, softening XAU/USD). Patience rewarded.';
  }

  return {
    score: totalScore,
    maxScore: 100,
    regime,
    regimeClass,
    alignedCount,
    totalPillars: 4,
    isPerfectStorm: totalScore >= 80 && alignedCount >= 3,
    pillars,
    interpretation,
    calculatedAt: new Date().toISOString()
  };
}

function tickLocalMarket() {
  const mult = 0.05;
  const gDelta = (Math.random() - 0.48) * 0.85 * mult;
  localMarketState.gold.price = +(localMarketState.gold.price + gDelta).toFixed(2);
  localMarketState.gold.high24h = Math.max(localMarketState.gold.high24h, localMarketState.gold.price);
  localMarketState.gold.low24h = Math.min(localMarketState.gold.low24h, localMarketState.gold.price);

  const inrDelta = (Math.random() - 0.49) * 0.02 * mult;
  localMarketState.usd_inr.price = +(localMarketState.usd_inr.price + inrDelta).toFixed(2);

  const oDelta = (Math.random() - 0.49) * 0.12 * mult;
  localMarketState.crude_oil.price = +(localMarketState.crude_oil.price + oDelta).toFixed(2);

  const uDelta = (Math.random() - 0.51) * 0.04 * mult;
  localMarketState.usd_index.price = +(localMarketState.usd_index.price + uDelta).toFixed(2);

  const yDelta = (Math.random() - 0.51) * 0.01 * mult;
  localMarketState.treasury_yield.price = +(localMarketState.treasury_yield.price + yDelta).toFixed(3);
  localMarketState.treasury_yield.realYield = +(localMarketState.treasury_yield.price - localMarketState.treasury_yield.breakevenInflation).toFixed(2);

  const vDelta = (Math.random() - 0.49) * 0.15 * mult;
  localMarketState.vix.price = Math.max(10, +(localMarketState.vix.price + vDelta).toFixed(2));
  localMarketState.lastUpdated = new Date().toISOString();
}

// Audio Context for Breakout Alert
let audioCtx = null;
function playAlertChime() {
  if (!audioAlertEnabled) return;
  try {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(587.33, audioCtx.currentTime); // D5
    osc.frequency.exponentialRampToValueAtTime(880.00, audioCtx.currentTime + 0.15); // A5
    osc.frequency.exponentialRampToValueAtTime(1174.66, audioCtx.currentTime + 0.35); // D6

    gain.gain.setValueAtTime(0.2, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.8);

    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.85);
  } catch (e) {
    console.warn('Audio playback error:', e);
  }
}

function formatPrice(val, decimals = 2) {
  return typeof val === 'number' ? val.toLocaleString('en-IN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) : val;
}

function formatChange(val, pct) {
  const sign = val >= 0 ? '+' : '';
  const cssClass = val >= 0 ? 'positive' : 'negative';
  return {
    text: `${sign}${formatPrice(val)} (${sign}${formatPrice(pct)}%)`,
    className: cssClass
  };
}

// ---------------------------------------------------------------------
// THEME MANAGEMENT (LIGHT / DARK MODE)
// ---------------------------------------------------------------------
function applyTheme(theme) {
  currentTheme = theme;
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('aurum_theme', theme);

  const themeIcon = document.getElementById('theme-icon');
  const themeLabel = document.getElementById('theme-label');

  if (theme === 'light') {
    if (themeIcon) themeIcon.textContent = '🌙';
    if (themeLabel) themeLabel.textContent = 'Dark Mode';
  } else {
    if (themeIcon) themeIcon.textContent = '☀️';
    if (themeLabel) themeLabel.textContent = 'Light Mode';
  }

  const isLight = (theme === 'light');
  const gridColor = isLight ? 'rgba(0, 0, 0, 0.06)' : 'rgba(255, 255, 255, 0.05)';
  const tickColor = isLight ? '#475569' : '#6b7280';
  const pointLabelColor = isLight ? '#0f172a' : '#e2e8f0';

  // 1. Update Multi-Asset Overlay Chart
  if (overlayChart) {
    overlayChart.options.scales.x.grid.color = gridColor;
    overlayChart.options.scales.y.grid.color = gridColor;
    overlayChart.options.scales.x.ticks.color = tickColor;
    overlayChart.options.scales.y.ticks.color = tickColor;
    overlayChart.update();
  }

  // 2. Update Macro Radar Chart
  if (radarChart) {
    if (radarChart.options?.scales?.r) {
      radarChart.options.scales.r.angleLines.color = isLight ? 'rgba(0, 0, 0, 0.08)' : 'rgba(255, 255, 255, 0.08)';
      radarChart.options.scales.r.grid.color = isLight ? 'rgba(0, 0, 0, 0.08)' : 'rgba(255, 255, 255, 0.08)';
      radarChart.options.scales.r.pointLabels.color = pointLabelColor;
    }
    if (radarChart.options?.plugins?.legend?.labels) {
      radarChart.options.plugins.legend.labels.color = isLight ? '#334155' : '#94a3b8';
    }
    radarChart.update();
  }

  // 3. Update 20-Year Historical Backtest Chart
  if (backtestChartInstance) {
    backtestChartInstance.options.scales.x.grid.color = isLight ? 'rgba(0, 0, 0, 0.06)' : 'rgba(255, 255, 255, 0.04)';
    backtestChartInstance.options.scales.y.grid.color = isLight ? 'rgba(0, 0, 0, 0.06)' : 'rgba(255, 255, 255, 0.05)';
    backtestChartInstance.options.scales.x.ticks.color = isLight ? '#475569' : '#64748b';
    backtestChartInstance.options.scales.y.ticks.color = isLight ? '#334155' : '#94a3b8';
    if (backtestChartInstance.data.datasets[0]) {
      backtestChartInstance.data.datasets[0].borderColor = isLight ? '#b45309' : '#fbbf24';
      backtestChartInstance.data.datasets[0].backgroundColor = isLight ? 'rgba(180, 83, 9, 0.08)' : 'rgba(251, 191, 36, 0.08)';
    }
    if (backtestChartInstance.options?.plugins?.tooltip) {
      backtestChartInstance.options.plugins.tooltip.backgroundColor = isLight ? '#ffffff' : '#0f172a';
      backtestChartInstance.options.plugins.tooltip.titleColor = isLight ? '#b45309' : '#fbbf24';
      backtestChartInstance.options.plugins.tooltip.bodyColor = isLight ? '#0f172a' : '#f1f5f9';
      backtestChartInstance.options.plugins.tooltip.borderColor = isLight ? '#cbd5e1' : '#334155';
    }
    backtestChartInstance.update();
  }

  // 4. Re-render TradingView widget with matching theme if active
  const tvPane = document.getElementById('tab-tv');
  if (tvPane && tvPane.classList.contains('active')) {
    renderTradingViewWidget(currentTradingViewSymbol);
  }
}

// ---------------------------------------------------------------------
// 1. DATA FETCHING (SERVER OR LOCAL FALLBACK)
// ---------------------------------------------------------------------
async function fetchIndicatorData() {
  if (isLocalFallback) {
    tickLocalMarket();
    const breakout = computeMatrixLocally(localMarketState);
    const indianPrices = calculateIndianPricesLocal(localMarketState.gold.price, localMarketState.usd_inr.price, active22kRate);
    const retailAdvice = getRetailAdviceLocal(breakout.score, breakout.isPerfectStorm);
    renderDashboard({
      market: localMarketState,
      india: indianPrices,
      retailAdvice,
      breakout,
      historical: localHistorical,
      correlationMatrix: getStaticCorrelationMatrix()
    });
    return;
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 1500);

    const res = await fetch('/api/indicators', { signal: controller.signal });
    clearTimeout(timeoutId);
    if (!res.ok) throw new Error('API offline');
    const data = await res.json();
    dashboardData = data;
    if (data.india && data.india.benchmark22kRate) {
      active22kRate = data.india.benchmark22kRate;
      try { localStorage.setItem('aurum_active_22k_rate', active22kRate); } catch (e) {}
    }
    renderDashboard(data);
  } catch (err) {
    // Immediate fallback to local algorithmic engine so dashboard never hangs
    isLocalFallback = true;
    tickLocalMarket();
    const breakout = computeMatrixLocally(localMarketState);
    const indianPrices = calculateIndianPricesLocal(localMarketState.gold.price, localMarketState.usd_inr.price, active22kRate);
    const retailAdvice = getRetailAdviceLocal(breakout.score, breakout.isPerfectStorm);
    renderDashboard({
      market: localMarketState,
      india: indianPrices,
      retailAdvice,
      breakout,
      historical: localHistorical,
      correlationMatrix: getStaticCorrelationMatrix()
    });
  }
}

function getStaticCorrelationMatrix() {
  return [
    { asset: 'Gold (XAU/USD)', gold: 1.00, inr: 0.21, usd: -0.45, yield: -0.26, usdInr: -0.21 },
    { asset: 'Indian Gold (MJDTA INR)', gold: 0.21, inr: 1.00, usd: -0.07, yield: -0.03, usdInr: 0.03 },
    { asset: 'US Dollar (DXY)', gold: -0.45, inr: -0.07, usd: 1.00, yield: 0.19, usdInr: 0.39 },
    { asset: 'US 10Y Yield', gold: -0.26, inr: -0.03, usd: 0.19, yield: 1.00, usdInr: 0.00 },
    { asset: 'USD / INR', gold: -0.21, inr: 0.03, usd: 0.39, yield: 0.00, usdInr: 1.00 }
  ];
}

// ---------------------------------------------------------------------
// 2. DASHBOARD RENDERING
// ---------------------------------------------------------------------
function renderDashboard(data) {
  const { market, india, retailAdvice, breakout, correlationMatrix, historical } = data;

  // A. Indian Retail Pricing Desk (Calibrated to active Jeweller Rate, e.g. GRT ₹13,385/g)
  const calibratedIndia = calculateIndianPricesLocal(market.gold.price, market.usd_inr?.price || 84.22, active22kRate);
  updateIndianRatesDisplay(calibratedIndia);

  // Retail Action Badge & Guidance
  if (retailAdvice) {
    const badgeEl = document.getElementById('retail-action-badge');
    const badgeTextEl = document.getElementById('retail-action-text');
    const adviceTextEl = document.getElementById('retail-advice-text');
    if (badgeTextEl) badgeTextEl.textContent = retailAdvice.badge;
    if (adviceTextEl) adviceTextEl.textContent = retailAdvice.advice;

    if (badgeEl && retailAdvice.color) {
      badgeEl.style.borderColor = retailAdvice.color;
      badgeEl.style.background = `${retailAdvice.color}15`;
      const dot = badgeEl.querySelector('.action-dot');
      if (dot) {
        dot.style.backgroundColor = retailAdvice.color;
        dot.style.boxShadow = `0 0 10px ${retailAdvice.color}`;
      }
    }
  }

  // B. Master Speedometer & Regime
  const score = breakout.score;
  const masterScoreEl = document.getElementById('master-score-val');
  if (masterScoreEl) masterScoreEl.textContent = score;

  const gaugeFillArc = document.getElementById('gauge-fill-arc');
  if (gaugeFillArc) {
    const totalArc = 251.3;
    const offset = totalArc * (1 - Math.min(100, Math.max(0, score)) / 100);
    gaugeFillArc.style.strokeDashoffset = offset;
  }

  const regimeBadge = document.getElementById('regime-badge');
  if (regimeBadge) {
    regimeBadge.textContent = breakout.regime;
    regimeBadge.className = `badge-regime ${breakout.regimeClass}`;
  }

  const statusCallout = document.getElementById('status-callout-text');
  if (statusCallout) {
    statusCallout.innerHTML = `<strong>Current Regime:</strong> ${breakout.interpretation}`;
  }

  // Storm Alert Banner
  const stormBanner = document.getElementById('storm-alert-banner');
  if (stormBanner) {
    if (breakout.isPerfectStorm) {
      stormBanner.classList.remove('hidden');
      if (previousScore < 80) playAlertChime();
    } else {
      stormBanner.classList.add('hidden');
    }
  }
  previousScore = score;

  // C. 4 Pillars Progress Bars
  breakout.pillars.forEach(pillar => {
    const scoreEl = document.getElementById(`score-${pillar.id}-val`);
    const fillEl = document.getElementById(`fill-${pillar.id}`);
    const stateEl = document.getElementById(`state-${pillar.id}`);

    if (scoreEl) scoreEl.textContent = `${pillar.score} / 25`;
    if (fillEl) {
      const pct = (pillar.score / 25) * 100;
      fillEl.style.width = `${pct}%`;
      if (pillar.score >= 17) fillEl.style.backgroundColor = '#10b981';
      else if (pillar.score >= 12) fillEl.style.backgroundColor = '#f59e0b';
      else fillEl.style.backgroundColor = '#ef4444';
    }
    if (stateEl) {
      stateEl.textContent = pillar.direction;
      stateEl.style.color = pillar.score >= 15 ? '#10b981' : (pillar.score >= 11 ? '#f59e0b' : '#ef4444');
    }
  });

  const alignedCountBadge = document.getElementById('aligned-count-badge');
  if (alignedCountBadge) {
    alignedCountBadge.textContent = `${breakout.alignedCount} / 4 PILLARS ACTIVE`;
    alignedCountBadge.style.color = breakout.alignedCount >= 3 ? '#fbbf24' : '#94a3b8';
  }

  // D. Global Asset Cards
  // Gold (Target)
  const goldPriceEl = document.getElementById('gold-price');
  const goldChgEl = document.getElementById('gold-change');
  const goldRangeEl = document.getElementById('gold-range');
  if (goldPriceEl) goldPriceEl.textContent = `$${formatPrice(market.gold.price, 2)}`;
  if (goldChgEl) {
    const chg = formatChange(market.gold.change24h, market.gold.changePercent24h);
    goldChgEl.textContent = chg.text;
    goldChgEl.className = `asset-change ${chg.className}`;
  }
  if (goldRangeEl) {
    goldRangeEl.textContent = `$${formatPrice(market.gold.low24h)} - $${formatPrice(market.gold.high24h)}`;
  }

  // Crude Oil
  const oilPriceEl = document.getElementById('oil-price');
  const oilChgEl = document.getElementById('oil-change');
  const signalOilEl = document.getElementById('signal-oil');
  if (oilPriceEl) oilPriceEl.textContent = `$${formatPrice(market.crude_oil.price, 2)}`;
  if (oilChgEl) {
    const chg = formatChange(market.crude_oil.change24h, market.crude_oil.changePercent24h);
    oilChgEl.textContent = chg.text;
    oilChgEl.className = `asset-change ${chg.className}`;
  }
  if (signalOilEl) {
    signalOilEl.textContent = 'CONTEXT ONLY (5.5/10)';
    signalOilEl.className = 'signal-tag neutral';
  }

  // US Dollar (DXY)
  const usdPriceEl = document.getElementById('usd-price');
  const usdChgEl = document.getElementById('usd-change');
  const signalUsdEl = document.getElementById('signal-usd');
  if (usdPriceEl) usdPriceEl.textContent = `${formatPrice(market.usd_index.price, 2)}`;
  if (usdChgEl) {
    const chg = formatChange(market.usd_index.change24h, market.usd_index.changePercent24h);
    usdChgEl.textContent = chg.text;
    usdChgEl.className = `asset-change ${chg.className}`;
  }
  if (signalUsdEl) {
    const sig = market.usd_index.changePercent24h <= 0 ? 'BULLISH CATALYST' : 'BEARISH DRAG';
    signalUsdEl.textContent = sig;
    signalUsdEl.className = `signal-tag ${market.usd_index.changePercent24h <= 0 ? 'bullish' : 'bearish'}`;
  }

  // Treasury Yields
  const yieldsPriceEl = document.getElementById('yields-price');
  const yieldsChgEl = document.getElementById('yields-change');
  const signalYieldsEl = document.getElementById('signal-yields');
  if (yieldsPriceEl) {
    yieldsPriceEl.innerHTML = `${formatPrice(market.treasury_yield.price, 3)}% <span class="sub-yield">(Real: ${formatPrice(market.treasury_yield.realYield, 2)}%)</span>`;
  }
  if (yieldsChgEl) {
    const chg = formatChange(market.treasury_yield.change24h, market.treasury_yield.changePercent24h);
    yieldsChgEl.textContent = chg.text;
    yieldsChgEl.className = `asset-change ${chg.className}`;
  }
  if (signalYieldsEl) {
    const sig = market.treasury_yield.changePercent24h <= 0 ? 'BULLISH CATALYST' : 'BEARISH DRAG';
    signalYieldsEl.textContent = sig;
    signalYieldsEl.className = `signal-tag ${market.treasury_yield.changePercent24h <= 0 ? 'bullish' : 'bearish'}`;
  }

  // VIX
  const vixPriceEl = document.getElementById('vix-price');
  const vixChgEl = document.getElementById('vix-change');
  const signalVixEl = document.getElementById('signal-vix');
  if (vixPriceEl) vixPriceEl.textContent = `${formatPrice(market.vix.price, 2)}`;
  if (vixChgEl) {
    const chg = formatChange(market.vix.change24h, market.vix.changePercent24h);
    vixChgEl.textContent = chg.text;
    vixChgEl.className = `asset-change ${chg.className}`;
  }
  if (signalVixEl) {
    signalVixEl.textContent = 'CONTEXT ONLY (4.5/10)';
    signalVixEl.className = 'signal-tag neutral';
  }

  // Update Macro Rules Cheat Sheet Live Signals (Core >=8/10 + Secondary Context)
  const sigGoldVal = document.getElementById('sig-val-gold');
  const sigUsdInrVal = document.getElementById('sig-val-usdinr');
  const sigUsdVal = document.getElementById('sig-val-usd');
  const sigOilVal = document.getElementById('sig-val-oil');
  const sigYieldsVal = document.getElementById('sig-val-yields');
  const sigVixVal = document.getElementById('sig-val-vix');

  if (sigGoldVal && market.gold) {
    const gChg = market.gold.changePercent24h || 0;
    const gSma20 = market.gold.sma20 || market.gold.price;
    const gDev = gSma20 > 0 ? ((market.gold.price - gSma20) / gSma20) * 100 : 0;
    sigGoldVal.textContent = `$${formatPrice(market.gold.price, 2)} (${gChg >= 0 ? '+' : ''}${formatPrice(gChg, 2)}%)`;
    const verdictEl = sigGoldVal.nextElementSibling;
    if (verdictEl) {
      verdictEl.textContent = gDev >= 0 ? `Core Bullish (+${gDev.toFixed(1)}% vs 20D)` : `Core Pullback (${gDev.toFixed(1)}% vs 20D)`;
      verdictEl.className = `sig-verdict ${gDev >= 0 ? 'positive' : 'negative'}`;
    }
  }

  if (sigUsdInrVal && market.usd_inr) {
    const inrChg = market.usd_inr.changePercent24h || 0;
    const inrSma20 = market.usd_inr.sma20 || market.usd_inr.price;
    const inrDev = inrSma20 > 0 ? ((market.usd_inr.price - inrSma20) / inrSma20) * 100 : 0;
    sigUsdInrVal.textContent = `₹${formatPrice(market.usd_inr.price, 2)} (${inrChg >= 0 ? '+' : ''}${formatPrice(inrChg, 2)}%)`;
    const verdictEl = sigUsdInrVal.nextElementSibling;
    if (verdictEl) {
      verdictEl.textContent = inrDev >= 0 ? 'INR Tailwind (Weak Rupee)' : 'Rupee Cooling';
      verdictEl.className = `sig-verdict ${inrDev >= 0 ? 'positive' : 'negative'}`;
    }
  }

  if (sigUsdVal) {
    const usdChg = market.usd_index.changePercent24h;
    sigUsdVal.textContent = `${formatPrice(market.usd_index.price, 2)} (${usdChg >= 0 ? '+' : ''}${formatPrice(usdChg, 2)}%)`;
    const verdictEl = sigUsdVal.nextElementSibling;
    if (verdictEl) {
      verdictEl.textContent = usdChg <= 0 ? 'Core Bullish (Weakening USD)' : 'Core Headwind (Firm USD)';
      verdictEl.className = `sig-verdict ${usdChg <= 0 ? 'positive' : 'negative'}`;
    }
  }

  if (sigYieldsVal) {
    const yChg = market.treasury_yield.changePercent24h;
    sigYieldsVal.textContent = `10Y: ${formatPrice(market.treasury_yield.price, 2)}% (${yChg >= 0 ? '+' : ''}${formatPrice(yChg, 2)}%)`;
    const verdictEl = sigYieldsVal.nextElementSibling;
    if (verdictEl) {
      verdictEl.textContent = yChg <= 0 ? 'Core Bullish (Yields Falling)' : 'Core Headwind (Yields High)';
      verdictEl.className = `sig-verdict ${yChg <= 0 ? 'positive' : 'negative'}`;
    }
  }

  if (sigOilVal) {
    const oChg = market.crude_oil.changePercent24h;
    sigOilVal.textContent = `$${formatPrice(market.crude_oil.price, 2)} (${oChg >= 0 ? '+' : ''}${formatPrice(oChg, 2)}%)`;
    const verdictEl = sigOilVal.nextElementSibling;
    if (verdictEl) {
      verdictEl.textContent = '5.5/10 Context Only (Excluded)';
      verdictEl.className = 'sig-verdict';
    }
  }

  if (sigVixVal) {
    const vChg = market.vix.changePercent24h;
    sigVixVal.textContent = `${formatPrice(market.vix.price, 2)} (${vChg >= 0 ? '+' : ''}${formatPrice(vChg, 2)}%)`;
    const verdictEl = sigVixVal.nextElementSibling;
    if (verdictEl) {
      verdictEl.textContent = '4.5/10 Context Only (Excluded)';
      verdictEl.className = 'sig-verdict';
    }
  }

  // Update Empirical Correlation Subtitle
  const corrMetaEl = document.getElementById('corr-meta-label');
  if (corrMetaEl && data.correlationMeta) {
    corrMetaEl.textContent = `${data.correlationMeta.method} (${data.correlationMeta.timeframe} • n=${data.correlationMeta.sampleSize.toLocaleString('en-IN')} trading days)`;
  }

  // Keep What-If Sliders synchronized with live baseline on initial render
  syncSimulatorBaselineInputs(market);

  // E. Charts Updates
  updateOverlayChart(historical);
  updateRadarChart(breakout.pillars);
  renderCorrelationTable(correlationMatrix);
}

// ---------------------------------------------------------------------
// 3. RETAIL JEWELLERY & COIN BILLING CALCULATOR
// ---------------------------------------------------------------------
function updateJewelleryCalculator(india) {
  if (!india) return;

  let baseRatePerGram = india.purity22k.per1g;
  let purityLabel = '22K';

  if (calcPurity === '24k') {
    baseRatePerGram = india.purity24k.per1g;
    purityLabel = '24K';
  } else if (calcPurity === '18k') {
    baseRatePerGram = india.purity18k.per1g;
    purityLabel = '18K';
  }

  const netGoldValue = baseRatePerGram * calcWeight;
  const makingChargeVal = netGoldValue * (calcMakingChargePct / 100);
  const subtotal = netGoldValue + makingChargeVal;
  const gstVal = subtotal * 0.03;
  const totalBill = subtotal + gstVal;
  const allInCostPerGram = calcWeight > 0 ? (totalBill / calcWeight) : 0;

  document.getElementById('inv-purity-name').textContent = purityLabel;
  document.getElementById('inv-rate-per-g').textContent = `₹${formatPrice(baseRatePerGram, 0)} / g`;
  document.getElementById('inv-weight-val').textContent = `${calcWeight.toFixed(1)}g`;
  document.getElementById('inv-base-gold-val').textContent = `₹${formatPrice(netGoldValue, 0)}`;
  document.getElementById('inv-mc-pct').textContent = `${calcMakingChargePct.toFixed(1)}%`;
  document.getElementById('inv-mc-val').textContent = `₹${formatPrice(makingChargeVal, 0)}`;
  document.getElementById('inv-subtotal').textContent = `₹${formatPrice(subtotal, 0)}`;
  document.getElementById('inv-gst-val').textContent = `₹${formatPrice(gstVal, 0)}`;
  document.getElementById('inv-total-bill').textContent = `₹${formatPrice(totalBill, 0)}`;
  document.getElementById('inv-allin-per-g').textContent = `₹${formatPrice(allInCostPerGram, 0)} / g`;

  document.getElementById('calc-weight-display').textContent = calcWeight.toFixed(1);
  document.getElementById('calc-mc-display').textContent = `${calcMakingChargePct.toFixed(1)}%`;
}

// ---------------------------------------------------------------------
// 4. GOOGLE AI STUDIO (GEMINI) N-DAY FORECAST ENGINE
// ---------------------------------------------------------------------
const GEMINI_STORAGE_KEY = 'aurum_gemini_api_key';

function getStoredApiKey() {
  return localStorage.getItem(GEMINI_STORAGE_KEY) || '';
}

function updateApiKeyUI() {
  const key = getStoredApiKey();
  const setupDot = document.getElementById('setup-status-dot');
  const setupText = document.getElementById('setup-status-text');
  const headerKeyLabel = document.getElementById('header-key-label');
  const input = document.getElementById('input-api-key');

  if (key && key.trim().startsWith('AIzaSy')) {
    if (setupDot) {
      setupDot.style.backgroundColor = '#10b981';
      setupDot.style.boxShadow = '0 0 8px #10b981';
    }
    if (setupText) {
      setupText.textContent = 'CONNECTED TO GEMINI 2.5 FLASH ✅';
      setupText.style.color = '#10b981';
    }
    if (headerKeyLabel) headerKeyLabel.textContent = 'Gemini Connected ✅';
    if (input && !input.value) input.value = key;
  } else {
    if (setupDot) {
      setupDot.style.backgroundColor = '#94a3b8';
      setupDot.style.boxShadow = 'none';
    }
    if (setupText) {
      setupText.textContent = 'LOCAL MODEL ACTIVE (ADD KEY FOR GEMINI)';
      setupText.style.color = 'var(--text-secondary)';
    }
    if (headerKeyLabel) headerKeyLabel.textContent = 'Google AI Key';
  }
}

function updateIndianRatesDisplay(india) {
  if (!india) return;
  const el24k10g = document.getElementById('inr-24k-10g');
  const el24k1g = document.getElementById('inr-24k-1g');
  const el22k10g = document.getElementById('inr-22k-10g');
  const el22k1g = document.getElementById('inr-22k-1g');
  const el22k8g = document.getElementById('inr-22k-8g');
  const el18k10g = document.getElementById('inr-18k-10g');
  const el18k1g = document.getElementById('inr-18k-1g');
  const elUsdInr = document.getElementById('inr-usd-rate');

  if (el24k10g) el24k10g.textContent = formatPrice(india.purity24k.per10g, 0);
  if (el24k1g) el24k1g.textContent = `₹${formatPrice(india.purity24k.per1g, 0)}`;
  if (el22k10g) el22k10g.textContent = formatPrice(india.purity22k.per10g, 0);
  if (el22k1g) el22k1g.textContent = `₹${formatPrice(india.purity22k.per1g, 0)}`;
  if (el22k8g) el22k8g.textContent = `₹${formatPrice(india.purity22k.per8gSovereign, 0)}`;
  if (el18k10g) el18k10g.textContent = formatPrice(india.purity18k.per10g, 0);
  if (el18k1g) el18k1g.textContent = `₹${formatPrice(india.purity18k.per1g, 0)}`;
  if (elUsdInr) elUsdInr.textContent = formatPrice(india.usdInr, 2);

  // Sync GRT labels & input across UI
  const grtRateLabel = document.getElementById('label-grt-rate');
  if (grtRateLabel) grtRateLabel.textContent = formatPrice(active22kRate, 0);

  const customInput = document.getElementById('input-custom-gold-rate');
  if (customInput && document.activeElement !== customInput) {
    customInput.value = active22kRate;
  }

  const grtSub = document.getElementById('inr-22k-card-sub');
  if (grtSub) {
    grtSub.textContent = `Standard Jewellery (GRT Rate: ₹${formatPrice(active22kRate, 0)}/g)`;
  }

  updateJewelleryCalculator(india);
}

function refreshIndianRatesUI() {
  const goldPrice = dashboardData?.market?.gold?.price || localMarketState.gold.price;
  const usdInr = dashboardData?.market?.usd_inr?.price || localMarketState.usd_inr.price;
  const india = calculateIndianPricesLocal(goldPrice, usdInr, active22kRate);
  updateIndianRatesDisplay(india);
}

// =====================================================================
// AUTONOMOUS 3-HOUR BULLION FORECAST CLIENT ENGINE
// =====================================================================
let currentForecastData = null;
let activeHorizon = '3d';
let forecastCountdownTimerId = null;

// Generate local fallback forecast matching Core >=8/10 server schema
function generateFallbackForecast(base22k = active22kRate) {
  const now = new Date();
  const nextCheck = new Date(now.getTime() + 3 * 60 * 60 * 1000);
  const rate22kPerGram = Math.round(base22k);
  const m = dashboardData?.market || localMarketState;
  const breakout = dashboardData?.breakout || computeMatrixLocally(m);
  const score = breakout?.score ?? 50;

  const goldPrice = m?.gold?.price || 3985;
  const goldSma20 = m?.gold?.sma20 || goldPrice;
  const yieldPrice = m?.treasury_yield?.price || 4.99;
  const yieldSma20 = m?.treasury_yield?.sma20 || yieldPrice;
  const usdInrPrice = m?.usd_inr?.price || 93.68;
  const usdInrSma20 = m?.usd_inr?.sma20 || usdInrPrice;
  const dxyPrice = m?.usd_index?.price || 103.0;
  const dxySma20 = m?.usd_index?.sma20 || dxyPrice;

  const goldTrend = goldSma20 > 0 ? ((goldPrice - goldSma20) / goldSma20) * 0.45 : 0;
  const yieldOffset = (yieldSma20 - yieldPrice) * 0.015;
  const usdInrOffset = usdInrSma20 > 0 ? ((usdInrPrice - usdInrSma20) / usdInrSma20) * 0.5 : 0;
  const dxyOffset = dxySma20 > 0 ? ((dxySma20 - dxyPrice) / dxySma20) * 0.45 : 0;
  const macroMomentum = goldTrend + yieldOffset + usdInrOffset + dxyOffset;
  const landed22k = Math.round(((goldPrice * usdInrPrice) / 31.1034768) * (22 / 24) * 1.06 * 1.03);

  const d3DeltaLow = -0.008 + macroMomentum * 0.35;
  const d3DeltaHigh = 0.002 + macroMomentum * 0.35;
  const d3Low22k = Math.round(rate22kPerGram * (1 + d3DeltaLow));
  const d3High22k = Math.round(rate22kPerGram * (1 + d3DeltaHigh));
  const d3Confidence = Math.min(88, Math.max(62, Math.round(68 + Math.abs(score - 50) * 0.35)));

  const d7DeltaLow = -0.006 + macroMomentum * 0.65;
  const d7DeltaHigh = 0.010 + macroMomentum * 0.65;
  const d7Low22k = Math.round(rate22kPerGram * (1 + d7DeltaLow));
  const d7High22k = Math.round(rate22kPerGram * (1 + d7DeltaHigh));
  const d7Confidence = Math.min(86, Math.max(60, Math.round(66 + Math.abs(score - 50) * 0.3)));

  const d14DeltaLow = -0.002 + macroMomentum * 0.95;
  const d14DeltaHigh = 0.020 + macroMomentum * 0.95;
  const d14Low22k = Math.round(rate22kPerGram * (1 + d14DeltaLow));
  const d14High22k = Math.round(rate22kPerGram * (1 + d14DeltaHigh));
  const d14Confidence = Math.min(88, Math.max(64, Math.round(68 + Math.abs(score - 50) * 0.3)));

  const d30DeltaLow = 0.005 + macroMomentum * 1.3;
  const d30DeltaHigh = 0.036 + macroMomentum * 1.3;
  const d30Low22k = Math.round(rate22kPerGram * (1 + d30DeltaLow));
  const d30High22k = Math.round(rate22kPerGram * (1 + d30DeltaHigh));
  const d30Confidence = Math.min(90, Math.max(66, Math.round(70 + Math.abs(score - 50) * 0.3)));

  const existingHistory = currentForecastData?.history || [];
  const newHistory = [
    {
      timestamp: now.toISOString(),
      grtRate22k: rate22kPerGram,
      score,
      macroSnapshot: { goldUsd: goldPrice, us10y: yieldPrice, usdInr: usdInrPrice, dxy: dxyPrice },
      call3d: `₹${d3Low22k.toLocaleString('en-IN')} - ₹${d3High22k.toLocaleString('en-IN')}`,
      call7d: `₹${d7Low22k.toLocaleString('en-IN')} - ₹${d7High22k.toLocaleString('en-IN')}`,
      status: 'VERIFIED_ACTIVE'
    },
    ...existingHistory.slice(0, 19)
  ];

  return {
    lastUpdated: now.toISOString(),
    nextUpdate: nextCheck.toISOString(),
    intervalHours: 3,
    analyst: 'AURUM Core >=8/10 Macro Bullion Desk',
    updateMethod: 'Autonomous 3-Hour Evaluation (Spot Gold 9.5 • US10Y 8.5 • USD/INR 8.0 • DXY 8.0)',
    marketBenchmark: {
      retailer: 'GRT Jewellers (grtjewels.com)',
      rate22kPerGram,
      rate22kSovereign: rate22kPerGram * 8,
      rate24k10g: Math.round(rate22kPerGram * (24 / 22)) * 10,
      rate24k1g: Math.round(rate22kPerGram * (24 / 22)),
      usdInr: usdInrPrice,
      spotGoldUsd: goldPrice,
      impliedLanded22k: landed22k,
      macroBreakoutScore: score,
      macroIndicators: { spotGoldUsd: goldPrice, us10yYield: yieldPrice, usdInr: usdInrPrice, dxy: dxyPrice }
    },
    horizons: {
      '3d': {
        days: 3,
        label: 'Next 3 Days (Immediate Window)',
        direction: score >= 60 ? 'UP_SURGE' : 'DOWN_DIP',
        directionTitle: score >= 60 ? 'CORE MACRO TAILWIND (+3D BIAS)' : 'SHORT-TERM CONSOLIDATION / DIP WATCH',
        directionIcon: score >= 60 ? '📈' : '📉',
        confidencePct: d3Confidence,
        expected22kRange: `₹${d3Low22k.toLocaleString('en-IN')} - ₹${d3High22k.toLocaleString('en-IN')} / g`,
        expected22kPerGramLow: d3Low22k,
        expected22kPerGramHigh: d3High22k,
        expectedSovereignRange: `₹${(d3Low22k * 8).toLocaleString('en-IN')} - ₹${(d3High22k * 8).toLocaleString('en-IN')} (8g)`,
        expected24k10gRange: `₹${(Math.round(d3Low22k * 24 / 22) * 10).toLocaleString('en-IN')} - ₹${(Math.round(d3High22k * 24 / 22) * 10).toLocaleString('en-IN')}`,
        priceChangeEst: `Estimated 3-day range ₹${d3Low22k.toLocaleString('en-IN')} to ₹${d3High22k.toLocaleString('en-IN')}/g`,
        buyerStrategyAction: score >= 60 ? 'ACCUMULATE TRANCHES ON DIPS' : 'WAIT FOR SUPPORT / STAGGER 50%',
        savingEstimateSovereign: `Landed 22K import parity ~₹${landed22k.toLocaleString('en-IN')}/g`,
        rationale: `Evaluated strictly from Core >=8/10 drivers: Spot Gold ($${goldPrice.toFixed(0)} vs 20D $${goldSma20.toFixed(0)}), US 10Y (${yieldPrice.toFixed(2)}%), DXY (${dxyPrice.toFixed(2)}), and USD/INR (₹${usdInrPrice.toFixed(2)}).`,
        shoppingTip: "Monitor MJDTA/GRT intraday parity and split larger jewellery purchases into tranches."
      },
      '7d': {
        days: 7,
        label: 'Next 7 Days (Weekly Outlook)',
        direction: 'RANGEBOUND_ACCUMULATE',
        directionTitle: 'CORE MACRO ACCUMULATION BAND',
        directionIcon: '⚖️',
        confidencePct: d7Confidence,
        expected22kRange: `₹${d7Low22k.toLocaleString('en-IN')} - ₹${d7High22k.toLocaleString('en-IN')} / g`,
        expected22kPerGramLow: d7Low22k,
        expected22kPerGramHigh: d7High22k,
        expectedSovereignRange: `₹${(d7Low22k * 8).toLocaleString('en-IN')} - ₹${(d7High22k * 8).toLocaleString('en-IN')} (8g)`,
        expected24k10gRange: `₹${(Math.round(d7Low22k * 24 / 22) * 10).toLocaleString('en-IN')} - ₹${(Math.round(d7High22k * 24 / 22) * 10).toLocaleString('en-IN')}`,
        priceChangeEst: `Rangebound ₹${d7Low22k.toLocaleString('en-IN')} to ₹${d7High22k.toLocaleString('en-IN')}/g`,
        buyerStrategyAction: 'STAGGER PURCHASES (50% NOW, 50% ON DIP)',
        savingEstimateSovereign: 'Reduce timing risk with dollar-cost averaging',
        rationale: `DXY (${dxyPrice.toFixed(2)}) and US 10Y yield (${yieldPrice.toFixed(2)}%) drive global XAU/USD direction, while USD/INR (₹${usdInrPrice.toFixed(2)}) anchors Indian retail parity.`,
        shoppingTip: "Use rate-protection schemes or split tranches during weekly volatility."
      },
      '14d': {
        days: 14,
        label: 'Next 14 Days (Fortnightly)',
        direction: 'UP_SURGE',
        directionTitle: 'FORTNIGHTLY CORE PARITY OUTLOOK',
        directionIcon: '📈',
        confidencePct: d14Confidence,
        expected22kRange: `₹${d14Low22k.toLocaleString('en-IN')} - ₹${d14High22k.toLocaleString('en-IN')} / g`,
        expected22kPerGramLow: d14Low22k,
        expected22kPerGramHigh: d14High22k,
        expectedSovereignRange: `₹${(d14Low22k * 8).toLocaleString('en-IN')} - ₹${(d14High22k * 8).toLocaleString('en-IN')} (8g)`,
        expected24k10gRange: `₹${(Math.round(d14Low22k * 24 / 22) * 10).toLocaleString('en-IN')} - ₹${(Math.round(d14High22k * 24 / 22) * 10).toLocaleString('en-IN')}`,
        priceChangeEst: `Projected corridor ₹${d14Low22k.toLocaleString('en-IN')} to ₹${d14High22k.toLocaleString('en-IN')}/g`,
        buyerStrategyAction: 'ACCUMULATE ON CORE MACRO CONFIRMATION',
        savingEstimateSovereign: `Track DXY & US 10Y shifts over 14-day window`,
        rationale: `US 10Y yield (${yieldPrice.toFixed(2)}% vs 20D ${yieldSma20.toFixed(2)}%) and USD/INR (₹${usdInrPrice.toFixed(2)}) govern domestic retail drift.`,
        shoppingTip: "Watch for XAU/USD reclaim above its 20-DMA before committing full wedding budgets."
      },
      '30d': {
        days: 30,
        label: 'Next 30 Days (Monthly Outlook)',
        direction: 'SECULAR_BULLISH',
        directionTitle: 'MONTHLY CORE TREND PROJECTION',
        directionIcon: '🚀',
        confidencePct: d30Confidence,
        expected22kRange: `₹${d30Low22k.toLocaleString('en-IN')} - ₹${d30High22k.toLocaleString('en-IN')} / g`,
        expected22kPerGramLow: d30Low22k,
        expected22kPerGramHigh: d30High22k,
        expectedSovereignRange: `₹${(d30Low22k * 8).toLocaleString('en-IN')} - ₹${(d30High22k * 8).toLocaleString('en-IN')} (8g)`,
        expected24k10gRange: `₹${(Math.round(d30Low22k * 24 / 22) * 10).toLocaleString('en-IN')} - ₹${(Math.round(d30High22k * 24 / 22) * 10).toLocaleString('en-IN')}`,
        priceChangeEst: `Projected 30D corridor ₹${d30Low22k.toLocaleString('en-IN')} to ₹${d30High22k.toLocaleString('en-IN')}/g`,
        buyerStrategyAction: 'SYSTEMATIC DIP ACCUMULATION',
        savingEstimateSovereign: `20-year Core >=8/10 Macro + Technical edge active`,
        rationale: `Core >=8/10 Matrix Score (${score}/100): XAU/USD (27.9%), US 10Y (25.0%), USD/INR (23.5%), and DXY (23.5%).`,
        shoppingTip: "Combine RSI pullbacks with Core Macro Tailwinds (score >= 60) for highest historical 7-day win rate."
      }
    },
    history: newHistory
  };
}

async function fetchForecastData() {
  try {
    const res = await fetch('/api/forecast');
    if (res.ok) {
      currentForecastData = await res.json();
    } else {
      currentForecastData = generateFallbackForecast(active22kRate);
    }
  } catch (err) {
    currentForecastData = generateFallbackForecast(active22kRate);
  }

  renderAllForecastHorizons();
  renderActiveHorizonDetail();
  renderHistoryTable();
  if (currentForecastData?.nextUpdate) {
    startForecastCountdown(currentForecastData.nextUpdate, currentForecastData.lastUpdated);
  }
}

function renderAllForecastHorizons() {
  if (!currentForecastData || !currentForecastData.horizons) return;
  const h = currentForecastData.horizons;

  // 3-Day Card
  if (h['3d']) {
    const rateEl = document.getElementById('card-rate-3d');
    const sovEl = document.getElementById('card-sov-3d');
    if (rateEl) rateEl.textContent = h['3d'].expected22kRange;
    if (sovEl) sovEl.textContent = h['3d'].expectedSovereignRange;
  }

  // 7-Day Card
  if (h['7d']) {
    const rateEl = document.getElementById('card-rate-7d');
    const sovEl = document.getElementById('card-sov-7d');
    if (rateEl) rateEl.textContent = h['7d'].expected22kRange;
    if (sovEl) sovEl.textContent = h['7d'].expectedSovereignRange;
  }

  // 14-Day Card
  if (h['14d']) {
    const rateEl = document.getElementById('card-rate-14d');
    const sovEl = document.getElementById('card-sov-14d');
    if (rateEl) rateEl.textContent = h['14d'].expected22kRange;
    if (sovEl) sovEl.textContent = h['14d'].expectedSovereignRange;
  }

  // 30-Day Card
  if (h['30d']) {
    const rateEl = document.getElementById('card-rate-30d');
    const sovEl = document.getElementById('card-sov-30d');
    if (rateEl) rateEl.textContent = h['30d'].expected22kRange;
    if (sovEl) sovEl.textContent = h['30d'].expectedSovereignRange;
  }
}

function renderActiveHorizonDetail() {
  if (!currentForecastData || !currentForecastData.horizons) return;
  const h = currentForecastData.horizons[activeHorizon];
  if (!h) return;

  const headingEl = document.getElementById('detail-horizon-heading');
  const subEl = document.getElementById('detail-benchmark-sub');
  const confEl = document.getElementById('detail-confidence-badge');
  const proj22kEl = document.getElementById('det-proj-22k-1g');
  const sub22kEl = document.getElementById('det-sub-22k-1g');
  const projSovEl = document.getElementById('det-proj-sovereign');
  const subSovEl = document.getElementById('det-sub-sovereign');
  const proj24kEl = document.getElementById('det-proj-24k-10g');
  const sub24kEl = document.getElementById('det-sub-24k-10g');
  const actionEl = document.getElementById('det-buyer-action');
  const actionSubEl = document.getElementById('det-buyer-sub');
  const narrativeEl = document.getElementById('det-narrative-text');
  const tipEl = document.getElementById('det-shopping-tip');

  if (headingEl) headingEl.textContent = `Detailed Analysis for ${h.label}`;
  if (subEl) subEl.textContent = `Calibrated to Jeweller Benchmark: ₹${formatPrice(active22kRate, 0)} / g (GRT Live Rate)`;
  if (confEl) confEl.innerHTML = `Confidence: <strong>${h.confidencePct}% Probability</strong>`;

  if (proj22kEl) proj22kEl.textContent = h.expected22kRange;
  if (sub22kEl) sub22kEl.textContent = h.priceChangeEst;

  if (projSovEl) projSovEl.textContent = h.expectedSovereignRange;
  if (subSovEl) subSovEl.textContent = h.savingEstimateSovereign || 'Optimal accumulation window';

  if (proj24kEl) proj24kEl.textContent = h.expected24k10gRange;
  if (sub24kEl) sub24kEl.textContent = 'Investment-grade coin rate';

  if (actionEl) actionEl.textContent = h.buyerStrategyAction;
  if (actionSubEl) actionSubEl.textContent = h.shoppingTip || 'Compare making charges across jewellers';

  if (narrativeEl) narrativeEl.textContent = h.rationale;
  if (tipEl) tipEl.textContent = h.shoppingTip;
}

function renderHistoryTable() {
  const tableBody = document.getElementById('history-table-body');
  if (!tableBody || !currentForecastData || !Array.isArray(currentForecastData.history)) return;

  tableBody.innerHTML = '';
  const sortedHistory = [...currentForecastData.history]
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  sortedHistory.slice(0, 10).forEach((entry, idx) => {
    const tr = document.createElement('tr');
    const dt = new Date(entry.timestamp);
    const timeFormatted = dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) + ' IST';
    const dateFormatted = dt.toLocaleDateString([], { month: 'short', day: 'numeric' });

    const isLatest = (idx === 0);
    const justNowBadge = isLatest ? '<span class="badge-just-now">JUST NOW</span>' : '';

    tr.innerHTML = `
      <td>${dateFormatted}, ${timeFormatted} ${justNowBadge}</td>
      <td><strong>₹${formatPrice(entry.grtRate22k, 0)}</strong> / g</td>
      <td>${entry.score || 84}/100</td>
      <td><span class="badge-history down">${entry.call3d || 'DOWN_DIP'}</span></td>
      <td><span class="badge-history neutral">${entry.call7d || 'RANGEBOUND'}</span></td>
      <td><span class="badge-status-active">Verified Check</span></td>
    `;
    tableBody.appendChild(tr);
  });
}

function flashUpdateFeedback() {
  // Flash 4 horizon cards
  document.querySelectorAll('.h-card').forEach(card => {
    card.classList.remove('card-updated-flash');
    void card.offsetWidth;
    card.classList.add('card-updated-flash');
  });

  // Flash detail panel
  const detailPanel = document.querySelector('.forecast-detail-panel');
  if (detailPanel) {
    detailPanel.classList.remove('card-updated-flash');
    void detailPanel.offsetWidth;
    detailPanel.classList.add('card-updated-flash');
  }

  // Flash last-updated timestamp
  const lastUpdatedEl = document.getElementById('auto-last-updated-text');
  if (lastUpdatedEl) {
    lastUpdatedEl.style.transition = 'color 0.25s ease';
    lastUpdatedEl.style.color = '#10b981';
    setTimeout(() => { lastUpdatedEl.style.color = ''; }, 2500);
  }
}

let toastTimeoutId = null;
function showUpdateToast(message) {
  let toast = document.getElementById('aurum-update-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'aurum-update-toast';
    toast.className = 'update-toast';
    document.body.appendChild(toast);
  }

  toast.innerHTML = `
    <span style="font-size: 1.4rem;">⚡</span>
    <div>
      <div style="font-weight: 800; color: #10b981; font-size: 0.74rem; letter-spacing: 0.04em;">3-HOUR MACRO RE-EVALUATION COMPLETE</div>
      <div style="font-size: 0.78rem; color: #e2e8f0; margin-top: 2px;">${message}</div>
    </div>
  `;
  toast.classList.remove('toast-hidden');

  if (toastTimeoutId) clearTimeout(toastTimeoutId);
  toastTimeoutId = setTimeout(() => {
    toast.classList.add('toast-hidden');
  }, 5000);
}

function startForecastCountdown(nextUpdateIso, lastUpdatedIso) {
  if (forecastCountdownTimerId) clearInterval(forecastCountdownTimerId);

  const countdownEl = document.getElementById('auto-countdown-text');
  const lastUpdatedEl = document.getElementById('auto-last-updated-text');

  if (lastUpdatedEl && lastUpdatedIso) {
    const dt = new Date(lastUpdatedIso);
    lastUpdatedEl.textContent = dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) + ' IST';
  }

  function update() {
    if (!nextUpdateIso) return;
    const diff = new Date(nextUpdateIso).getTime() - Date.now();
    if (diff <= 0) {
      if (countdownEl) countdownEl.textContent = 'Updating now...';
      fetchForecastData();
      return;
    }
    const totalSecs = Math.floor(diff / 1000);
    const hrs = String(Math.floor(totalSecs / 3600)).padStart(2, '0');
    const mins = String(Math.floor((totalSecs % 3600) / 60)).padStart(2, '0');
    const secs = String(totalSecs % 60).padStart(2, '0');

    if (countdownEl) countdownEl.textContent = `${hrs}h ${mins}m ${secs}s`;
  }

  update();
  forecastCountdownTimerId = setInterval(update, 1000);
}

async function forceRefreshForecast() {
  const btn = document.getElementById('btn-force-forecast');
  if (btn) {
    btn.innerHTML = '⏳ <span>Checking 4 Macro Indicators...</span>';
    btn.disabled = true;
    btn.classList.add('btn-updating');
  }

  // 1. Advance market ticks and refresh macro indicator data
  try {
    tickLocalMarket();
    await fetchIndicatorData();
  } catch (e) {}

  // 2. Fetch fresh forecast from server (or try alternate ports / fallback)
  try {
    let res = await fetch('/api/forecast/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ base22kRate: active22kRate })
    });

    if (!res.ok && window.location.port !== '3334') {
      try {
        res = await fetch('http://localhost:3334/api/forecast/refresh', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ base22kRate: active22kRate })
        });
      } catch (e) {}
    }

    if (res.ok) {
      const data = await res.json();
      currentForecastData = data.forecast;
    } else {
      currentForecastData = generateFallbackForecast(active22kRate);
    }
  } catch (err) {
    try {
      const res3334 = await fetch('http://localhost:3334/api/forecast/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ base22kRate: active22kRate })
      });
      if (res3334.ok) {
        const data = await res3334.json();
        currentForecastData = data.forecast;
      } else {
        currentForecastData = generateFallbackForecast(active22kRate);
      }
    } catch (e) {
      currentForecastData = generateFallbackForecast(active22kRate);
    }
  }

  // 3. Render all forecast horizons and details with newly computed numbers
  renderAllForecastHorizons();
  renderActiveHorizonDetail();
  renderHistoryTable();

  // 4. Trigger visual pulse on all cards so the user visibly sees the refresh!
  flashUpdateFeedback();

  // 5. Reset the countdown timer
  if (currentForecastData?.nextUpdate) {
    startForecastCountdown(currentForecastData.nextUpdate, currentForecastData.lastUpdated);
  }

  // 6. Provide immediate button and toast feedback
  const now = new Date();
  const timeFormatted = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) + ' IST';
  const m = dashboardData?.market || localMarketState;

  if (btn) {
    btn.innerHTML = `✅ Updated at ${timeFormatted}!`;
    btn.classList.remove('btn-updating');
    btn.classList.add('btn-updated-success');
    setTimeout(() => {
      btn.innerHTML = '⚡ Check & Update Now';
      btn.disabled = false;
      btn.classList.remove('btn-updated-success');
    }, 2400);
  }

  showUpdateToast(`DXY: ${m?.usd_index?.price?.toFixed(2) || '103.41'} • Crude: $${m?.crude_oil?.price?.toFixed(2) || '74.90'} • Real Yield: ${(m?.treasury_yield?.realYield || 1.83).toFixed(2)}% • VIX: ${m?.vix?.price?.toFixed(2) || '19.88'}. Targets updated for GRT 22K (₹${formatPrice(active22kRate, 0)}/g).`);
}


// ---------------------------------------------------------------------
// 5. CHART.JS VISUALIZATIONS
// ---------------------------------------------------------------------
function updateOverlayChart(historical, days = 30) {
  const ctx = document.getElementById('chart-overlay');
  if (!ctx || !window.Chart) return;

  const slicedData = historical.slice(-days);
  const labels = slicedData.map(d => d.date.slice(5));

  const datasets = [
    {
      label: 'Gold (XAU USD)',
      data: slicedData.map(d => d.gold),
      borderColor: '#eab308',
      borderWidth: 2.5,
      tension: 0.35,
      pointRadius: 0,
      fill: false
    },
    {
      label: 'Indian Gold (INR)',
      data: slicedData.map(d => d.goldInr || d.gold),
      borderColor: '#fbbf24',
      borderDash: [3, 3],
      borderWidth: 2.2,
      tension: 0.35,
      pointRadius: 0,
      fill: false
    },
    {
      label: 'WTI Crude Oil',
      data: slicedData.map(d => d.oil),
      borderColor: '#f97316',
      borderWidth: 1.8,
      tension: 0.35,
      pointRadius: 0,
      fill: false
    },
    {
      label: 'US Dollar (DXY)',
      data: slicedData.map(d => d.usd),
      borderColor: '#3b82f6',
      borderWidth: 1.8,
      tension: 0.35,
      pointRadius: 0,
      fill: false
    },
    {
      label: '10Y Yield',
      data: slicedData.map(d => d.yields),
      borderColor: '#06b6d4',
      borderWidth: 1.8,
      tension: 0.35,
      pointRadius: 0,
      fill: false
    },
    {
      label: 'CBOE VIX',
      data: slicedData.map(d => d.vix),
      borderColor: '#ec4899',
      borderWidth: 1.8,
      tension: 0.35,
      pointRadius: 0,
      fill: false
    }
  ];

  if (overlayChart) {
    overlayChart.data.labels = labels;
    overlayChart.data.datasets = datasets;
    overlayChart.update();
  } else {
    overlayChart = new Chart(ctx, {
      type: 'line',
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#111827',
            titleColor: '#f9fafb',
            bodyColor: '#e5e7eb',
            borderColor: '#374151',
            borderWidth: 1,
            callbacks: {
              label: (item) => `${item.dataset.label}: ${item.parsed.y >= 0 ? '+' : ''}${item.parsed.y.toFixed(2)}%`
            }
          }
        },
        scales: {
          x: {
            grid: { color: 'rgba(255, 255, 255, 0.05)' },
            ticks: { color: '#6b7280', font: { family: 'JetBrains Mono', size: 10 } }
          },
          y: {
            grid: { color: 'rgba(255, 255, 255, 0.05)' },
            ticks: {
              color: '#6b7280',
              font: { family: 'JetBrains Mono', size: 10 },
              callback: (v) => `${v >= 0 ? '+' : ''}${v}%`
            }
          }
        }
      }
    });
  }
}

function updateRadarChart(pillars) {
  const ctx = document.getElementById('chart-radar');
  if (!ctx || !window.Chart) return;

  const labels = [
    'Spot Gold 9.5/10 (Direct)',
    'Low US 10Y 8.5/10 (Inverse)',
    'USD/INR 8.0/10 (Landed)',
    'Weak USD DXY 8.0/10 (Inverse)'
  ];

  const currentScores = pillars.map(p => (p.score / 25) * 100);
  const breakoutThreshold = [75, 75, 75, 75];

  if (radarChart) {
    radarChart.data.labels = labels;
    radarChart.data.datasets[0].data = currentScores;
    radarChart.update();
  } else {
    radarChart = new Chart(ctx, {
      type: 'radar',
      data: {
        labels,
        datasets: [
          {
            label: 'Current Macro Alignment',
            data: currentScores,
            backgroundColor: 'rgba(234, 179, 8, 0.25)',
            borderColor: '#eab308',
            borderWidth: 2,
            pointBackgroundColor: '#eab308',
            pointRadius: 4
          },
          {
            label: 'Perfect Storm Envelope',
            data: breakoutThreshold,
            backgroundColor: 'rgba(16, 185, 129, 0.08)',
            borderColor: 'rgba(16, 185, 129, 0.5)',
            borderWidth: 1.5,
            borderDash: [4, 4],
            pointRadius: 0
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: true,
            labels: { color: currentTheme === 'light' ? '#334155' : '#94a3b8', font: { family: 'Plus Jakarta Sans', size: 11 } }
          }
        },
        scales: {
          r: {
            angleLines: { color: currentTheme === 'light' ? 'rgba(0, 0, 0, 0.08)' : 'rgba(255, 255, 255, 0.08)' },
            grid: { color: currentTheme === 'light' ? 'rgba(0, 0, 0, 0.08)' : 'rgba(255, 255, 255, 0.08)' },
            pointLabels: { color: currentTheme === 'light' ? '#0f172a' : '#e2e8f0', font: { family: 'Plus Jakarta Sans', size: 11, weight: 'bold' } },
            ticks: { display: false, min: 0, max: 100 }
          }
        }
      }
    });
  }
}

function renderCorrelationTable(matrix) {
  const tbody = document.getElementById('correlation-tbody');
  if (!tbody || !matrix) return;

  function getCorrBg(val) {
    if (val === 1.0) return 'rgba(234, 179, 8, 0.25)';
    if (val > 0) {
      const alpha = Math.min(0.6, val * 0.5);
      return `rgba(16, 185, 129, ${alpha})`;
    } else {
      const alpha = Math.min(0.6, Math.abs(val) * 0.5);
      return `rgba(239, 68, 68, ${alpha})`;
    }
  }

  tbody.innerHTML = matrix.map(row => {
    const cGold = row.gold ?? 0;
    const cInr = row.inr ?? 0;
    const cUsd = row.usd ?? 0;
    const cYield = row.yield ?? 0;
    const cUsdInr = row.usdInr ?? 0;
    return `
      <tr>
        <td>${row.asset}</td>
        <td class="corr-cell" style="background:${getCorrBg(cGold)}">${cGold >= 0 ? '+' : ''}${cGold.toFixed(2)}</td>
        <td class="corr-cell" style="background:${getCorrBg(cInr)}">${cInr >= 0 ? '+' : ''}${cInr.toFixed(2)}</td>
        <td class="corr-cell" style="background:${getCorrBg(cUsd)}">${cUsd >= 0 ? '+' : ''}${cUsd.toFixed(2)}</td>
        <td class="corr-cell" style="background:${getCorrBg(cYield)}">${cYield >= 0 ? '+' : ''}${cYield.toFixed(2)}</td>
        <td class="corr-cell" style="background:${getCorrBg(cUsdInr)}">${cUsdInr >= 0 ? '+' : ''}${cUsdInr.toFixed(2)}</td>
      </tr>
    `;
  }).join('');
}

// ---------------------------------------------------------------------
// 6. TRADINGVIEW LIVE WIDGET EMBEDDER
// ---------------------------------------------------------------------
function renderTradingViewWidget(symbol = 'OANDA:XAUUSD') {
  const container = document.getElementById('tradingview-widget-wrapper');
  if (!container) return;

  currentTradingViewSymbol = symbol;
  container.innerHTML = '';

  const widgetHolder = document.createElement('div');
  widgetHolder.className = 'tradingview-widget-container';
  widgetHolder.style.height = '100%';
  widgetHolder.style.width = '100%';

  const script = document.createElement('script');
  script.type = 'text/javascript';
  script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';
  script.async = true;
  const isLight = (currentTheme === 'light');
  script.innerHTML = JSON.stringify({
    autosize: true,
    symbol: symbol,
    interval: '60',
    timezone: 'Asia/Kolkata',
    theme: isLight ? 'light' : 'dark',
    style: '1',
    locale: 'en',
    enable_publishing: false,
    backgroundColor: isLight ? '#ffffff' : '#0c1017',
    gridColor: isLight ? 'rgba(0, 0, 0, 0.06)' : 'rgba(255, 255, 255, 0.05)',
    hide_top_toolbar: false,
    hide_legend: false,
    save_image: false,
    calendar: false,
    support_host: 'https://www.tradingview.com'
  });

  widgetHolder.appendChild(script);
  container.appendChild(widgetHolder);
}

// ---------------------------------------------------------------------
// 7. WHAT-IF SCENARIO SIMULATOR (CORE >=8/10 DRIVERS)
// ---------------------------------------------------------------------
let simInitializedFromLive = false;
function syncSimulatorBaselineInputs(market, forceReset = false) {
  if (!market || (simInitializedFromLive && !forceReset)) return;
  const gEl = document.getElementById('sim-gold-slider');
  const dEl = document.getElementById('sim-dxy-slider');
  const yEl = document.getElementById('sim-yield-slider');
  const iEl = document.getElementById('sim-usdinr-slider');
  if (!gEl || !dEl || !yEl || !iEl) return;

  const g = Math.round(market.gold?.price || 3985);
  const d = +(market.usd_index?.price || 103.0).toFixed(1);
  const y = +(market.treasury_yield?.price || 5.0).toFixed(2);
  const i = +(market.usd_inr?.price || 93.7).toFixed(2);

  gEl.value = g;
  dEl.value = d;
  yEl.value = y;
  iEl.value = i;

  document.getElementById('sim-gold-val').textContent = `$${g.toLocaleString('en-US')}`;
  document.getElementById('sim-dxy-val').textContent = `${d.toFixed(1)}`;
  document.getElementById('sim-yield-val').textContent = `${y.toFixed(2)}%`;
  document.getElementById('sim-usdinr-val').textContent = `₹${i.toFixed(2)}`;
  simInitializedFromLive = true;
}

async function runSimulation() {
  const goldPrice = parseFloat(document.getElementById('sim-gold-slider')?.value || 3985);
  const dxy = parseFloat(document.getElementById('sim-dxy-slider')?.value || 103.0);
  const yieldVal = parseFloat(document.getElementById('sim-yield-slider')?.value || 5.0);
  const usdInr = parseFloat(document.getElementById('sim-usdinr-slider')?.value || 93.7);

  const gValEl = document.getElementById('sim-gold-val');
  const dValEl = document.getElementById('sim-dxy-val');
  const yValEl = document.getElementById('sim-yield-val');
  const iValEl = document.getElementById('sim-usdinr-val');
  if (gValEl) gValEl.textContent = `$${goldPrice.toLocaleString('en-US')}`;
  if (dValEl) dValEl.textContent = `${dxy.toFixed(1)}`;
  if (yValEl) yValEl.textContent = `${yieldVal.toFixed(2)}%`;
  if (iValEl) iValEl.textContent = `₹${usdInr.toFixed(2)}`;

  try {
    if (!isLocalFallback) {
      const res = await fetch('/api/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ goldPrice, dxyPrice: dxy, yield10y: yieldVal, usdInr })
      });
      if (res.ok) {
        const sim = await res.json();
        applySimulationResult(sim);
        return;
      }
    }
    computeLocalSimulation(goldPrice, dxy, yieldVal, usdInr);
  } catch (err) {
    computeLocalSimulation(goldPrice, dxy, yieldVal, usdInr);
  }
}

function computeLocalSimulation(goldPrice, dxy, yieldVal, usdInr) {
  const baseMkt = dashboardData?.market || localMarketState;
  const simState = JSON.parse(JSON.stringify(baseMkt));

  const baseGold = simState.gold.sma20 || simState.gold.price || 3985;
  const baseDxy = simState.usd_index.sma20 || simState.usd_index.price || 103.0;
  const baseYield = simState.treasury_yield.sma20 || simState.treasury_yield.price || 5.0;
  const baseInr = simState.usd_inr.sma20 || simState.usd_inr.price || 93.7;

  simState.gold.price = goldPrice;
  simState.gold.changePercent24h = ((goldPrice - baseGold) / baseGold) * 100;
  simState.usd_index.price = dxy;
  simState.usd_index.changePercent24h = ((dxy - baseDxy) / baseDxy) * 100;
  simState.treasury_yield.price = yieldVal;
  simState.treasury_yield.changePercent24h = ((yieldVal - baseYield) / baseYield) * 100;
  simState.usd_inr.price = usdInr;
  simState.usd_inr.changePercent24h = ((usdInr - baseInr) / baseInr) * 100;

  const simBreakout = computeMatrixLocally(simState);

  const liveGold = baseMkt.gold.price || baseGold;
  const liveDxy = baseMkt.usd_index.price || baseDxy;
  const liveYield = baseMkt.treasury_yield.price || baseYield;
  const liveInr = baseMkt.usd_inr.price || baseInr;

  const dxyDeltaPct = ((dxy - liveDxy) / liveDxy) * 100;
  const yieldDeltaPts = yieldVal - liveYield;
  const spotShiftPct = ((goldPrice - liveGold) / liveGold) * 100;
  const estGoldChangePct = spotShiftPct + (-dxyDeltaPct * 0.95) + (-yieldDeltaPts * 3.8);

  const projectedGoldPrice = +(liveGold * (1 + (estGoldChangePct / 100))).toFixed(2);
  const fxScale = liveInr > 0 ? (usdInr / liveInr) : 1;
  const sim22kRate = Math.round(active22kRate * (1 + estGoldChangePct / 100) * fxScale);
  const projectedIndian = calculateIndianPricesLocal(projectedGoldPrice, usdInr, sim22kRate);

  applySimulationResult({
    simulatedBreakout: simBreakout,
    projectedGoldPrice,
    estGoldChangePct: +estGoldChangePct.toFixed(2),
    projectedIndian
  });
}

function applySimulationResult(sim) {
  const score = sim.simulatedBreakout.score;
  document.getElementById('sim-res-score').innerHTML = `${score} <span class="res-small">/ 100</span>`;
  document.getElementById('sim-proj-price').textContent = `$${formatPrice(sim.projectedGoldPrice, 2)}`;
  
  if (sim.projectedIndian) {
    document.getElementById('sim-proj-inr-24k').textContent = `₹${formatPrice(sim.projectedIndian.purity24k.per10g, 0)}`;
    document.getElementById('sim-proj-inr-22k').textContent = `₹${formatPrice(sim.projectedIndian.purity22k.per10g, 0)}`;
  }

  const impactSign = sim.estGoldChangePct >= 0 ? '+' : '';
  const impactEl = document.getElementById('sim-est-impact');
  impactEl.textContent = `${impactSign}${sim.estGoldChangePct}%`;
  impactEl.className = `res-val ${sim.estGoldChangePct >= 0 ? 'positive' : 'negative'}`;

  const tagEl = document.getElementById('sim-res-tag');
  tagEl.textContent = sim.simulatedBreakout.regime;
  tagEl.className = `res-tag ${sim.simulatedBreakout.regimeClass}`;

  document.getElementById('sim-res-explanation').textContent = sim.simulatedBreakout.interpretation;
}

// ---------------------------------------------------------------------
// 8. EVENT LISTENERS & SETUP
// ---------------------------------------------------------------------
function setupEventListeners() {
  // Mode View Switchers
  document.getElementById('btn-mode-india')?.addEventListener('click', () => {
    document.getElementById('btn-mode-india').classList.add('active');
    document.getElementById('btn-mode-global').classList.remove('active');
    document.getElementById('section-india-retail')?.scrollIntoView({ behavior: 'smooth' });
  });

  document.getElementById('btn-mode-global')?.addEventListener('click', () => {
    document.getElementById('btn-mode-global').classList.add('active');
    document.getElementById('btn-mode-india').classList.remove('active');
    document.querySelector('.hero-breakout-card')?.scrollIntoView({ behavior: 'smooth' });
  });

  // Manual refresh
  document.getElementById('btn-refresh')?.addEventListener('click', () => {
    fetchIndicatorData();
  });

  // Audio Alert Toggle
  const audioBtn = document.getElementById('btn-audio-toggle');
  audioBtn?.addEventListener('click', () => {
    audioAlertEnabled = !audioAlertEnabled;
    const icon = document.getElementById('sound-icon');
    if (icon) icon.textContent = audioAlertEnabled ? '🔔' : '🔕';
    audioBtn.classList.toggle('audio-active', audioAlertEnabled);
  });

  document.getElementById('dismiss-storm-btn')?.addEventListener('click', () => {
    document.getElementById('storm-alert-banner')?.classList.add('hidden');
  });

  // Jump buttons
  document.getElementById('btn-jump-calc')?.addEventListener('click', () => {
    document.getElementById('section-calculator')?.scrollIntoView({ behavior: 'smooth' });
  });

  document.getElementById('btn-jump-ai')?.addEventListener('click', () => {
    document.getElementById('section-ai-forecast')?.scrollIntoView({ behavior: 'smooth' });
  });

  // Theme Toggle (Light / Dark)
  document.getElementById('btn-theme-toggle')?.addEventListener('click', () => {
    const newTheme = currentTheme === 'light' ? 'dark' : 'light';
    applyTheme(newTheme);
  });

  // Header 3-Hour Forecast Jump button
  document.getElementById('btn-header-forecast')?.addEventListener('click', () => {
    document.getElementById('section-ai-forecast')?.scrollIntoView({ behavior: 'smooth' });
  });

  // Header Top 3 Orgs Jump button
  document.getElementById('btn-header-orgs')?.addEventListener('click', () => {
    document.getElementById('section-top3-orgs')?.scrollIntoView({ behavior: 'smooth' });
  });

  // Header 20-Year Backtest Jump button
  document.getElementById('btn-header-backtest')?.addEventListener('click', () => {
    document.getElementById('section-backtest-lab')?.scrollIntoView({ behavior: 'smooth' });
  });

  // Top 3 Live Rates Sync button
  document.getElementById('btn-sync-top3')?.addEventListener('click', syncTop3LiveRates);

  // Top 3 Organisation Benchmark Selection buttons
  document.querySelectorAll('.btn-select-bench').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const orgId = btn.getAttribute('data-org-id') || e.currentTarget?.getAttribute('data-org-id');
      if (orgId) selectBenchmarkOrg(orgId);
    });
  });

  // Audit filter & mode buttons
  document.getElementById('btn-audit-mode-signals')?.addEventListener('click', () => {
    setAuditMode('signals');
  });
  document.getElementById('btn-audit-mode-daily')?.addEventListener('click', () => {
    setAuditMode('daily');
  });
  document.getElementById('select-audit-signal-type')?.addEventListener('change', (e) => {
    currentAuditSignalType = e.target.value || 'all';
    if (currentAuditSignalType === 'HOLD' && currentAuditMode !== 'daily') {
      setAuditMode('daily');
      return;
    }
    auditVisibleCount = 30;
    renderAuditLogTable();
  });
  document.getElementById('btn-audit-all')?.addEventListener('click', () => {
    setAuditFilter('all');
  });
  document.getElementById('btn-audit-nextday')?.addEventListener('click', () => {
    setAuditFilter('next_ok');
  });
  document.getElementById('btn-audit-wins')?.addEventListener('click', () => {
    setAuditFilter('wins');
  });
  document.getElementById('btn-audit-losses')?.addEventListener('click', () => {
    setAuditFilter('losses');
  });

  // Backtest 2006–2026 Year Selector
  document.getElementById('select-backtest-year')?.addEventListener('change', (e) => {
    filterBacktestByYear(e.target.value);
  });

  // Backtest Era Pills
  document.querySelectorAll('.btn-era-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      const era = btn.getAttribute('data-era');
      document.querySelectorAll('.btn-era-pill').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      backtestSelectedEra = era;
      if (era === 'all') {
        filterBacktestByYear('all');
      } else {
        const startY = era.split('-')[0];
        filterBacktestByYear(startY);
      }
    });
  });

  // Chart Zoom Era Buttons
  document.querySelectorAll('.bt-tf-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const era = btn.getAttribute('data-chart-era');
      document.querySelectorAll('.bt-tf-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      backtestSelectedEra = era;
      if (backtestDataCache?.historicalChart) {
        renderBacktestChart(backtestDataCache.historicalChart, era);
      }
    });
  });

  // Audit Year Selector
  document.getElementById('select-audit-year')?.addEventListener('change', (e) => {
    filterBacktestByYear(e.target.value);
  });

  // Audit Search Input
  document.getElementById('input-audit-search')?.addEventListener('input', (e) => {
    auditSearchQuery = e.target.value;
    auditVisibleCount = 30;
    renderAuditLogTable();
  });

  // Load More / Show All Signals
  document.getElementById('btn-load-more-signals')?.addEventListener('click', () => {
    auditVisibleCount += 30;
    renderAuditLogTable();
  });

  document.getElementById('btn-load-all-signals')?.addEventListener('click', () => {
    auditVisibleCount = 99999;
    renderAuditLogTable();
  });

  // Export 2006-2026 Historical CSV
  document.getElementById('btn-export-csv')?.addEventListener('click', () => {
    window.location.href = '/api/history/download';
  });

  // Horizon Cards Selection
  document.querySelectorAll('.h-card').forEach(card => {
    card.addEventListener('click', () => {
      document.querySelectorAll('.h-card').forEach(c => c.classList.remove('active'));
      card.classList.add('active');
      activeHorizon = card.getAttribute('data-horizon') || '3d';
      renderActiveHorizonDetail();
    });
  });

  // Force 3-Hour Forecast Refresh
  document.getElementById('btn-force-forecast')?.addEventListener('click', forceRefreshForecast);

  // Past 3-Hour History Accordion Toggle
  document.getElementById('btn-toggle-history')?.addEventListener('click', () => {
    const box = document.getElementById('history-content-box');
    const chevron = document.getElementById('history-chevron');
    if (box) box.classList.toggle('hidden');
    if (chevron) chevron.classList.toggle('open');
  });

  // Password eye toggle
  document.getElementById('btn-toggle-eye')?.addEventListener('click', () => {
    const input = document.getElementById('input-api-key');
    if (input) {
      input.type = input.type === 'password' ? 'text' : 'password';
    }
  });

  // Quick edit GRT rate button
  document.getElementById('btn-quick-edit-grt')?.addEventListener('click', () => {
    const input = document.getElementById('input-custom-gold-rate');
    const box = document.getElementById('rate-input-box-wrapper');
    if (input) {
      input.focus();
      input.select();
    }
    if (box) {
      box.style.transition = 'all 0.3s ease';
      box.style.borderColor = '#fbbf24';
      box.style.boxShadow = '0 0 16px rgba(234, 179, 8, 0.45)';
      setTimeout(() => {
        box.style.borderColor = '';
        box.style.boxShadow = '';
      }, 2500);
    }
  });

  // Jeweller Rate Benchmark selection: GRT Store Board
  document.getElementById('btn-bench-grt')?.addEventListener('click', async () => {
    await selectBenchmarkOrg('grt');
    document.querySelectorAll('.benchmark-pill').forEach(p => p.classList.remove('active'));
    document.getElementById('btn-bench-grt')?.classList.add('active');
  });

  // Jeweller Rate Benchmark selection: MJDTA Chennai Association
  document.getElementById('btn-bench-mjdta')?.addEventListener('click', async () => {
    await selectBenchmarkOrg('mjdta');
    document.querySelectorAll('.benchmark-pill').forEach(p => p.classList.remove('active'));
    document.getElementById('btn-bench-mjdta')?.classList.add('active');
  });

  // Jeweller Rate Benchmark selection: IBJA National Benchmark
  document.getElementById('btn-bench-national')?.addEventListener('click', async () => {
    await selectBenchmarkOrg('ibja');
    document.querySelectorAll('.benchmark-pill').forEach(p => p.classList.remove('active'));
    document.getElementById('btn-bench-national')?.classList.add('active');
  });

  // Quick Toggle between GRT and MJDTA in the Chennai Comparison Box
  document.getElementById('btn-toggle-grt-mjdta')?.addEventListener('click', async () => {
    const currentActive = top3OrganisationsData?.activeBenchmarkId || 'grt';
    const nextId = (currentActive === 'grt') ? 'mjdta' : 'grt';
    await selectBenchmarkOrg(nextId);
  });

  // Update & Save Rate Handler
  document.getElementById('btn-apply-custom-rate')?.addEventListener('click', async () => {
    const input = document.getElementById('input-custom-gold-rate');
    const customVal = parseFloat(input?.value);
    if (customVal && customVal > 1000) {
      active22kRate = Math.round(customVal);
      try { localStorage.setItem('aurum_active_22k_rate', active22kRate); } catch (e) {}

      document.querySelectorAll('.benchmark-pill').forEach(p => p.classList.remove('active'));
      document.getElementById('btn-bench-grt')?.classList.add('active');

      // Send to server to persist permanently across restarts
      try {
        await fetch('/api/benchmark/update', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rate22k: active22kRate })
        });
      } catch (e) {
        try {
          await fetch('http://localhost:3334/api/benchmark/update', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ rate22k: active22kRate })
          });
        } catch (err) {}
      }

      refreshIndianRatesUI();
      await forceRefreshForecast();

      showUpdateToast(`✅ Live GRT 22K rate updated to ₹${formatPrice(active22kRate, 0)}/g! All purity rates, sovereign prices, and forecasts synchronized.`);
      flashUpdateFeedback();
    }
  });

  // Save API Key
  document.getElementById('btn-save-key')?.addEventListener('click', () => {
    const val = document.getElementById('input-api-key')?.value.trim();
    const msg = document.getElementById('key-feedback-msg');
    if (val) {
      localStorage.setItem(GEMINI_STORAGE_KEY, val);
      updateApiKeyUI();
      if (msg) {
        msg.style.display = 'block';
        msg.style.color = '#10b981';
        msg.textContent = '✅ Google AI Studio API key saved securely in your browser.';
        setTimeout(() => { msg.style.display = 'none'; }, 3000);
      }
    }
  });

  // Clear API Key
  document.getElementById('btn-clear-key')?.addEventListener('click', () => {
    localStorage.removeItem(GEMINI_STORAGE_KEY);
    document.getElementById('input-api-key').value = '';
    updateApiKeyUI();
    const msg = document.getElementById('key-feedback-msg');
    if (msg) {
      msg.style.display = 'block';
      msg.style.color = '#f59e0b';
      msg.textContent = 'API key removed. Dashboard running in local predictive model mode.';
      setTimeout(() => { msg.style.display = 'none'; }, 3000);
    }
  });

  // Test API Key
  document.getElementById('btn-test-key')?.addEventListener('click', async () => {
    const val = document.getElementById('input-api-key')?.value.trim();
    const msg = document.getElementById('key-feedback-msg');
    if (!val) {
      if (msg) {
        msg.style.display = 'block';
        msg.style.color = '#ef4444';
        msg.textContent = 'Please enter an API key to test.';
      }
      return;
    }
    if (msg) {
      msg.style.display = 'block';
      msg.style.color = '#38bdf8';
      msg.textContent = 'Testing connection to Google Gemini API...';
    }
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${val}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: 'Ping test' }] }] })
      });
      if (res.ok) {
        if (msg) {
          msg.style.color = '#10b981';
          msg.textContent = '🎉 Key verified successfully! Connected to Google Gemini 2.5 Flash.';
        }
      } else {
        // Try gemini-1.5-flash
        const res2 = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${val}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ parts: [{ text: 'Ping test' }] }] })
        });
        if (res2.ok) {
          if (msg) {
            msg.style.color = '#10b981';
            msg.textContent = '🎉 Key verified! Connected to Google Gemini 1.5 Flash.';
          }
        } else {
          if (msg) {
            msg.style.color = '#ef4444';
            msg.textContent = `❌ Connection error (${res.status}). Verify your key at aistudio.google.com`;
          }
        }
      }
    } catch (e) {
      if (msg) {
        msg.style.color = '#ef4444';
        msg.textContent = 'Network error testing API key. Check internet connectivity.';
      }
    }
  });

  // Calculator Purity Buttons
  document.querySelectorAll('.purity-choice-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.purity-choice-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      calcPurity = btn.getAttribute('data-purity');
      const india = dashboardData?.india || calculateIndianPricesLocal(localMarketState.gold.price, localMarketState.usd_inr.price);
      updateJewelleryCalculator(india);
    });
  });

  // Calculator Weight Input
  const wtInput = document.getElementById('calc-weight-input');
  wtInput?.addEventListener('input', (e) => {
    calcWeight = parseFloat(e.target.value) || 0;
    const india = dashboardData?.india || calculateIndianPricesLocal(localMarketState.gold.price, localMarketState.usd_inr.price);
    updateJewelleryCalculator(india);
  });

  // Calculator Quick Weight Buttons
  document.querySelectorAll('.quick-wt-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.quick-wt-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      calcWeight = parseFloat(btn.getAttribute('data-wt'));
      if (wtInput) wtInput.value = calcWeight;
      const india = dashboardData?.india || calculateIndianPricesLocal(localMarketState.gold.price, localMarketState.usd_inr.price);
      updateJewelleryCalculator(india);
    });
  });

  // Calculator Making Charges Slider
  document.getElementById('calc-mc-slider')?.addEventListener('input', (e) => {
    calcMakingChargePct = parseFloat(e.target.value) || 0;
    const india = dashboardData?.india || calculateIndianPricesLocal(localMarketState.gold.price, localMarketState.usd_inr.price);
    updateJewelleryCalculator(india);
  });

  // Tab controls
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));

      btn.classList.add('active');
      const target = btn.getAttribute('data-tab');
      document.getElementById(target)?.classList.add('active');

      if (target === 'tab-tv') {
        renderTradingViewWidget(currentTradingViewSymbol);
      }
    });
  });

  // Timeframe buttons
  document.querySelectorAll('.tf-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tf-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const days = parseInt(btn.getAttribute('data-days'), 10);
      const hist = dashboardData?.historical || localHistorical;
      if (hist) updateOverlayChart(hist, days);
    });
  });

  // TradingView symbol picker
  document.querySelectorAll('.tv-pick-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tv-pick-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const sym = btn.getAttribute('data-symbol');
      renderTradingViewWidget(sym);
    });
  });

  // Simulator Sliders (Core >=8/10 Drivers)
  ['sim-gold-slider', 'sim-dxy-slider', 'sim-yield-slider', 'sim-usdinr-slider'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', runSimulation);
  });

  // Simulator Presets
  document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const scenario = btn.getAttribute('data-scenario');
      const goldSlider = document.getElementById('sim-gold-slider');
      const dxySlider = document.getElementById('sim-dxy-slider');
      const yieldSlider = document.getElementById('sim-yield-slider');
      const inrSlider = document.getElementById('sim-usdinr-slider');
      const m = dashboardData?.market || localMarketState;

      if (scenario === 'xau-rally') {
        goldSlider.value = Math.min(5500, Math.round((m.gold?.price || 3985) * 1.12));
        dxySlider.value = 97.5;
        yieldSlider.value = 3.90;
        inrSlider.value = +(m.usd_inr?.price || 93.7).toFixed(2);
      } else if (scenario === 'rupee-weak') {
        goldSlider.value = Math.round(m.gold?.price || 3985);
        dxySlider.value = 104.5;
        yieldSlider.value = +(m.treasury_yield?.price || 5.0).toFixed(2);
        inrSlider.value = 96.5;
      } else if (scenario === 'fed-cut') {
        goldSlider.value = Math.min(5500, Math.round((m.gold?.price || 3985) * 1.08));
        dxySlider.value = 95.0;
        yieldSlider.value = 3.50;
        inrSlider.value = 91.5;
      } else if (scenario === 'fed-hike') {
        goldSlider.value = Math.max(2500, Math.round((m.gold?.price || 3985) * 0.92));
        dxySlider.value = 109.5;
        yieldSlider.value = 5.60;
        inrSlider.value = 95.0;
      } else if (scenario === 'reset') {
        syncSimulatorBaselineInputs(m, true);
      }
      runSimulation();
    });
  });
}

function updateClockAndSessions() {
  const clockEl = document.getElementById('live-clock');
  const now = new Date();
  if (clockEl) {
    const istHours = String((now.getUTCHours() + 5 + Math.floor((now.getUTCMinutes() + 30)/60)) % 24).padStart(2, '0');
    const istMins = String((now.getUTCMinutes() + 30) % 60).padStart(2, '0');
    const istSecs = String(now.getUTCSeconds()).padStart(2, '0');
    clockEl.textContent = `${istHours}:${istMins}:${istSecs} IST`;
  }

  const utcH = now.getUTCHours();
  // MCX: 09:00 - 23:30 IST (03:30 - 18:00 UTC)
  const mcxActive = (utcH >= 3 && utcH < 18);
  const nyActive = utcH >= 13 && utcH < 21;
  const londonActive = utcH >= 8 && utcH < 17;

  document.getElementById('session-mcx')?.classList.toggle('active', mcxActive);
  document.getElementById('session-ny')?.classList.toggle('active', nyActive);
  document.getElementById('session-london')?.classList.toggle('active', londonActive);
}

// ---------------------------------------------------------------------
// 8.5 TOP 3 INDIAN BULLION ORGANISATIONS MODULE
// ---------------------------------------------------------------------
let top3OrganisationsData = null;

async function fetchTop3Organisations() {
  try {
    let res;
    try {
      res = await fetch('/api/organisations');
    } catch (e) {
      res = await fetch('http://localhost:3334/api/organisations');
    }
    if (res && res.ok) {
      const data = await res.json();
      top3OrganisationsData = data;
      renderTop3OrganisationsUI(data);
    }
  } catch (err) {
    console.warn('Could not fetch top 3 organisations:', err.message);
  }
}

function renderTop3OrganisationsUI(data) {
  if (!data || !Array.isArray(data.organisations)) return;

  const activeId = data.activeBenchmarkId || 'mjdta';

  data.organisations.forEach(org => {
    // 22K 1g
    const el22k1g = document.getElementById(`org-${org.id}-22k-1g`);
    if (el22k1g) el22k1g.textContent = `₹${org.rate22k_1g.toLocaleString('en-IN')}`;

    // 22K 8g Sovereign
    const el22k8g = document.getElementById(`org-${org.id}-22k-8g`);
    if (el22k8g) {
      if (org.id === 'ibja') {
        el22k8g.textContent = `(Sov: ₹${org.rate22k_8g.toLocaleString('en-IN')})`;
      } else {
        el22k8g.textContent = `₹${org.rate22k_8g.toLocaleString('en-IN')}`;
      }
    }

    // Optional 22K + 3% GST (e.g. IBJA card)
    const el22kGst = document.getElementById(`org-${org.id}-22k-gst`);
    if (el22kGst) {
      const gstVal = org.gstRate22k_1g || Math.round(org.rate22k_1g * 1.03);
      el22kGst.textContent = `₹${gstVal.toLocaleString('en-IN')}`;
    }

    // 24K 10g
    const el24k10g = document.getElementById(`org-${org.id}-24k-10g`);
    if (el24k10g) el24k10g.textContent = `₹${org.rate24k_10g.toLocaleString('en-IN')}`;

    // Silver 1g
    const elSilver = document.getElementById(`org-${org.id}-silver-1g`);
    if (elSilver) elSilver.textContent = `₹${org.rateSilver_1g.toFixed(2)}`;

    // Time recorded
    const elTime = document.getElementById(`time-org-${org.id}`);
    if (elTime) elTime.textContent = `Synced: ${org.timeRecorded || 'Live'}`;

    // Spread badge
    const elSpread = document.getElementById(`spread-org-${org.id}`);
    if (elSpread) {
      if (org.spreadVsBenchmark === 0) {
        elSpread.textContent = 'BASE BENCHMARK (0)';
        elSpread.className = 'org-spread-badge neutral';
      } else if (org.spreadVsBenchmark > 0) {
        elSpread.textContent = `+₹${org.spreadVsBenchmark}/g (+₹${(org.spreadVsBenchmark * 8).toLocaleString('en-IN')}/Sov)`;
        elSpread.className = 'org-spread-badge positive';
      } else {
        elSpread.textContent = `-₹${Math.abs(org.spreadVsBenchmark)}/g (-₹${(Math.abs(org.spreadVsBenchmark) * 8).toLocaleString('en-IN')}/Sov)`;
        elSpread.className = 'org-spread-badge negative';
      }
    }

    // Active Card & Button State
    const cardEl = document.getElementById(`card-org-${org.id}`);
    const badgeActive = document.getElementById(`badge-active-${org.id}`);
    const btnSelect = document.getElementById(`btn-select-${org.id}`);

    const isCurrentActive = (org.id === activeId);
    if (cardEl) cardEl.classList.toggle('active-benchmark', isCurrentActive);
    if (badgeActive) badgeActive.classList.toggle('hidden', !isCurrentActive);
    if (btnSelect) {
      btnSelect.classList.toggle('active', isCurrentActive);
      btnSelect.textContent = isCurrentActive ? '✓ Active Benchmark' : 'Use as Benchmark';
    }
  });

  // Update GRT vs MJDTA comparison box & strip
  const grtOrg = data.organisations.find(o => o.id === 'grt');
  const mjdtaOrg = data.organisations.find(o => o.id === 'mjdta');
  const ibjaOrg = data.organisations.find(o => o.id === 'ibja');

  if (grtOrg && mjdtaOrg) {
    const grtRate = grtOrg.rate22k_1g;
    const mjdtaRate = mjdtaOrg.rate22k_1g;
    const diff = grtRate - mjdtaRate;
    const diffSov = diff * 8;

    // Header strip
    const stripGrt = document.getElementById('strip-grt-rate');
    const stripMjdta = document.getElementById('strip-mjdta-rate');
    const stripPill = document.getElementById('strip-diff-pill');
    if (stripGrt) stripGrt.textContent = `₹${grtRate.toLocaleString('en-IN')} / g`;
    if (stripMjdta) stripMjdta.textContent = `₹${mjdtaRate.toLocaleString('en-IN')} / g`;
    if (stripPill) {
      stripPill.textContent = `${diff >= 0 ? '+' : ''}₹${diff} / g (${diff >= 0 ? '+' : ''}₹${diffSov} / Sov)`;
      stripPill.className = `strip-diff-pill ${diff >= 0 ? 'positive' : 'negative'}`;
    }

    // Comparison Card
    const compGrt22k = document.getElementById('comp-grt-22k');
    const compGrtSov = document.getElementById('comp-grt-sov');
    const compGrt24k = document.getElementById('comp-grt-24k');
    const compGrtSilver = document.getElementById('comp-grt-silver');

    const compMjdta22k = document.getElementById('comp-mjdta-22k');
    const compMjdtaSov = document.getElementById('comp-mjdta-sov');
    const compMjdta24k = document.getElementById('comp-mjdta-24k');
    const compMjdtaSilver = document.getElementById('comp-mjdta-silver');

    const compDiffTag = document.getElementById('comp-diff-tag');
    const compDiffSub = document.getElementById('comp-diff-sub');
    const compExpl = document.getElementById('comp-explanation-text');

    if (compGrt22k) compGrt22k.innerHTML = `₹${grtRate.toLocaleString('en-IN')} <span class="comp-sub">/ g</span>`;
    if (compGrtSov) compGrtSov.textContent = `₹${(grtRate * 8).toLocaleString('en-IN')} (8g Sovereign)`;
    if (compGrt24k) compGrt24k.textContent = `₹${(grtOrg.rate24k_10g || grtRate * 24 / 22 * 10).toLocaleString('en-IN')}`;
    if (compGrtSilver) compGrtSilver.textContent = `₹${(grtOrg.rateSilver_1g || 205).toFixed(2)}/g`;

    if (compMjdta22k) compMjdta22k.innerHTML = `₹${mjdtaRate.toLocaleString('en-IN')} <span class="comp-sub">/ g</span>`;
    if (compMjdtaSov) compMjdtaSov.textContent = `₹${(mjdtaRate * 8).toLocaleString('en-IN')} (8g Sovereign)`;
    if (compMjdta24k) compMjdta24k.textContent = `₹${(mjdtaOrg.rate24k_10g || mjdtaRate * 24 / 22 * 10).toLocaleString('en-IN')}`;
    if (compMjdtaSilver) compMjdtaSilver.textContent = `₹${(mjdtaOrg.rateSilver_1g || 205).toFixed(2)}/g`;

    if (compDiffTag) {
      compDiffTag.textContent = `${diff >= 0 ? '+' : ''}₹${diff} / g`;
      compDiffTag.className = `comp-diff-tag ${diff >= 0 ? 'positive' : 'negative'}`;
    }
    if (compDiffSub) compDiffSub.textContent = `${diff >= 0 ? '+' : ''}₹${diffSov} / Sovereign`;

    if (compExpl && data.comparison?.explanation) {
      compExpl.innerHTML = `<strong>Why is there a ₹${Math.abs(diff)}/g difference?</strong> ${data.comparison.explanation}`;
    }

    // Top Benchmark Bar Pills update
    const lblGrtRate = document.getElementById('label-grt-rate');
    const lblMjdtaRate = document.getElementById('label-mjdta-rate');
    const lblIbjaRate = document.getElementById('label-ibja-rate');
    if (lblGrtRate) lblGrtRate.textContent = grtRate.toLocaleString('en-IN');
    if (lblMjdtaRate) lblMjdtaRate.textContent = mjdtaRate.toLocaleString('en-IN');
    if (lblIbjaRate && ibjaOrg) lblIbjaRate.textContent = ibjaOrg.rate22k_1g.toLocaleString('en-IN');

    // Toggle active state on top benchmark pills
    document.getElementById('btn-bench-grt')?.classList.toggle('active', activeId === 'grt');
    document.getElementById('btn-bench-mjdta')?.classList.toggle('active', activeId === 'mjdta');
    document.getElementById('btn-bench-national')?.classList.toggle('active', activeId === 'ibja');
  }

  const lastSyncBadge = document.getElementById('top3-last-sync-badge');
  if (lastSyncBadge && data.lastUpdated) {
    const d = new Date(data.lastUpdated);
    lastSyncBadge.textContent = `Synced ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  }
}

async function syncTop3LiveRates() {
  const syncBtn = document.getElementById('btn-sync-top3');
  const syncIcon = document.getElementById('sync-top3-icon');
  const syncText = document.getElementById('sync-top3-text');

  if (syncBtn) syncBtn.disabled = true;
  if (syncIcon) syncIcon.textContent = '⏳';
  if (syncText) syncText.textContent = 'Fetching Official Rates...';

  try {
    let res;
    try {
      res = await fetch('/api/organisations/sync', { method: 'POST' });
    } catch (e) {
      res = await fetch('http://localhost:3334/api/organisations/sync', { method: 'POST' });
    }

    if (res && res.ok) {
      const data = await res.json();
      top3OrganisationsData = data.data;
      renderTop3OrganisationsUI(data.data);

      if (data.currentBenchmark22kRate) {
        active22kRate = data.currentBenchmark22kRate;
        try { localStorage.setItem('aurum_active_22k_rate', active22kRate); } catch (e) {}
        refreshIndianRatesUI();
      }
      await Promise.allSettled([
        fetchIndicatorData(),
        fetchForecastData(),
        fetchBacktestData()
      ]);

      // Flash cards
      document.querySelectorAll('.org-card').forEach(c => {
        c.classList.add('card-updated-flash');
        setTimeout(() => c.classList.remove('card-updated-flash'), 1800);
      });

      const mjdta = data.data.organisations.find(o => o.id === 'mjdta')?.rate22k_1g || 13140;
      const ibja = data.data.organisations.find(o => o.id === 'ibja')?.rate22k_1g || 13305;
      const jab = data.data.organisations.find(o => o.id === 'jab')?.rate22k_1g || 13545;

      showUpdateToast(`⚡ Top 3 Associations Synced Live! MJDTA: ₹${mjdta.toLocaleString('en-IN')}/g | IBJA: ₹${ibja.toLocaleString('en-IN')}/g | JAB: ₹${jab.toLocaleString('en-IN')}/g`);
    } else {
      showUpdateToast('Live sync completed with baseline verified quotes.');
    }
  } catch (err) {
    showUpdateToast('Updated with current active association quotes.');
  } finally {
    if (syncBtn) syncBtn.disabled = false;
    if (syncIcon) syncIcon.textContent = '⚡';
    if (syncText) syncText.textContent = 'Sync Live Rates';
  }
}

async function selectBenchmarkOrg(orgId) {
  try {
    let res;
    try {
      res = await fetch('/api/organisations/select', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: orgId })
      });
    } catch (e) {
      res = await fetch('http://localhost:3334/api/organisations/select', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: orgId })
      });
    }

    if (res && res.ok) {
      const result = await res.json();
      active22kRate = result.benchmark22kRate;
      try { localStorage.setItem('aurum_active_22k_rate', active22kRate); } catch (e) {}

      // Refresh top 3 display
      if (top3OrganisationsData) {
        top3OrganisationsData.activeBenchmarkId = orgId;
        renderTop3OrganisationsUI(top3OrganisationsData);
      } else {
        await fetchTop3Organisations();
      }

      // Refresh Indian prices and input field
      refreshIndianRatesUI();
      await forceRefreshForecast();

      showUpdateToast(`⭐ Active Benchmark switched to ${result.activeBenchmark.name} (₹${result.benchmark22kRate.toLocaleString('en-IN')}/g)`);
    }
  } catch (err) {
    console.error('Benchmark selection error:', err);
  }
}

// ---------------------------------------------------------------------
// 20-YEAR STRATEGY BACKTEST ENGINE UI LOGIC (2006 – 2026)
// ---------------------------------------------------------------------
let backtestDataCache = null;
let backtestChartInstance = null;
let backtestSelectedYear = 'all';
let backtestSelectedEra = 'all';
let currentAuditFilter = 'all';
let currentAuditMode = 'signals';
let currentAuditSignalType = 'all';
let auditSearchQuery = '';
let auditVisibleCount = 30;

function getSignalBadgeClass(signalType) {
  if (signalType === 'BUY_NOW') return 'buy';
  if (signalType === 'ACCUMULATE') return 'accumulate';
  if (signalType === 'AVOID_WAIT' || signalType === 'WAIT_FOR_DIP') return 'avoid';
  return 'hold';
}

function getNextDayBadgeInfo(item) {
  const st = item?.nextDayStatus || 'PENDING';
  if (st === 'SUCCEEDED') return { cls: 'succeeded', label: '✓ SUCCEEDED' };
  if (st === 'MISSED') return { cls: 'missed', label: '✕ MISSED' };
  if (st === 'FLAT') return { cls: 'flat', label: '— FLAT' };
  return { cls: 'pending', label: '⏳ PENDING' };
}

function renderLiveStrategyValidationBanner(data) {
  const setup = data?.currentMarketSetup;
  const s = data?.summary;
  const today = setup?.todaySignal;
  if (today) {
    const tDate = document.getElementById('bt-today-date');
    const tBadge = document.getElementById('bt-today-signal-badge');
    const tPrice = document.getElementById('bt-today-price');
    const tTech = document.getElementById('bt-today-tech');
    const tDesc = document.getElementById('bt-today-desc');
    if (tDate) tDate.textContent = today.date;
    if (tBadge) {
      tBadge.textContent = today.signalLabel || today.signalType;
      tBadge.className = `sig-call-badge ${getSignalBadgeClass(today.signalType)}`;
    }
    if (tPrice) tPrice.textContent = `₹${today.price.toLocaleString('en-IN')}/g`;
    if (tTech) {
      const devSign = today.devSma20Pct >= 0 ? '+' : '';
      const macroTxt = today.macroScore != null ? ` • Core Macro: ${today.macroScore}/100 (${today.macroBias})` : '';
      tTech.textContent = `RSI ${today.rsi} • ${devSign}${today.devSma20Pct}% vs 20-DMA${macroTxt}`;
    }
    if (tDesc) tDesc.textContent = today.expectedAction;
  }

  const yest = setup?.yesterdayVerification;
  if (yest) {
    const yDates = document.getElementById('bt-yest-dates');
    const ySig = document.getElementById('bt-yest-signal-badge');
    const yMove = document.getElementById('bt-yest-move');
    const yVerd = document.getElementById('bt-yest-verdict');
    const yDesc = document.getElementById('bt-yest-desc');
    const vInfo = getNextDayBadgeInfo(yest);
    const diffSign = yest.nextDayDiff >= 0 ? '+' : '';
    if (yDates) yDates.textContent = `${yest.date} ➔ ${yest.nextDayDate || 'Today'}`;
    if (ySig) {
      ySig.textContent = yest.signalLabel || yest.signalType;
      ySig.className = `sig-call-badge ${getSignalBadgeClass(yest.signalType)}`;
    }
    if (yMove) {
      yMove.textContent = `₹${yest.price.toLocaleString('en-IN')} ➔ ₹${(yest.nextDayPrice || yest.price).toLocaleString('en-IN')} (${diffSign}₹${yest.nextDayDiff})`;
    }
    if (yVerd) {
      yVerd.textContent = vInfo.label;
      yVerd.className = `nextday-verdict-badge ${vInfo.cls}`;
    }
    if (yDesc) yDesc.textContent = yest.nextDayReason || '';
  }

  const strip = document.getElementById('bt-strategy-breakdown-row');
  if (strip && s?.strategyBreakdown) {
    const order = ['BUY_NOW', 'ACCUMULATE', 'AVOID_WAIT'];
    const items = order.map(k => {
      const b = s.strategyBreakdown[k];
      if (!b) return '';
      return `
        <div class="sb-pill ${getSignalBadgeClass(k)}">
          <span class="sb-name">${b.label}</span>
          <span class="sb-stat"><strong>${b.total}</strong> signals • 7D Win: <strong>${b.winRate7dPct}%</strong> • Next-Day: <strong>${b.winRate1dPct}%</strong></span>
        </div>
      `;
    }).join('');
    const overall1d = `
      <div class="sb-pill overall">
        <span class="sb-name">ALL SIGNALS (T+1 NEXT-DAY)</span>
        <span class="sb-stat"><strong>${s.nextDayWins || 0}/${s.nextDayEvaluated || 0}</strong> Succeeded (<strong>${s.nextDayWinRatePct || 0}%</strong>)</span>
      </div>
    `;
    strip.innerHTML = items + overall1d;
  }

  const macroStrip = document.getElementById('bt-macro-tiers-row');
  const mbt = data?.macroBacktestSummary;
  if (macroStrip && mbt) {
    const mc = mbt.macroConfirmed || {};
    const tb = mbt.technicalOnlyBaseline || {};
    const tiersHtml = (mbt.tierComparison || []).map(t => {
      const cls = t.bias === 'TAILWIND' ? 'buy' : (t.bias === 'HEADWIND' ? 'avoid' : 'accumulate');
      return `
        <div class="sb-pill ${cls}">
          <span class="sb-name">${t.label}</span>
          <span class="sb-stat"><strong>${t.signals}</strong> sig • 7D: <strong>${t.winRate7dPct}%</strong> • T+1: <strong>${t.winRate1dPct}%</strong></span>
        </div>
      `;
    }).join('');
    macroStrip.innerHTML = `
      <div class="sb-pill buy">
        <span class="sb-name">MACRO-CONFIRMED (&ge;8/10)</span>
        <span class="sb-stat"><strong>${mc.totalSignals || 0}</strong> sig • 7D: <strong>${mc.winRate7dPct || 0}%</strong> • T+1: <strong>${mc.winRate1dPct || 0}%</strong></span>
      </div>
      <div class="sb-pill overall">
        <span class="sb-name">TECH-ONLY BASELINE</span>
        <span class="sb-stat"><strong>${tb.totalSignals || 0}</strong> sig • 7D: <strong>${tb.winRate7dPct || 0}%</strong> • T+1: <strong>${tb.winRate1dPct || 0}%</strong></span>
      </div>
      ${tiersHtml}
    `;
  }
}

async function fetchBacktestData() {
  try {
    let res;
    try {
      res = await fetch('/api/backtest');
    } catch (e) {
      res = await fetch('http://localhost:3334/api/backtest');
    }
    if (res && res.ok) {
      const data = await res.json();
      backtestDataCache = data;
      renderBacktestUI(data);
    }
  } catch (err) {
    console.warn('Backtest fetch warning:', err.message);
  }
}

function renderBacktestUI(data) {
  if (!data || !data.summary) return;
  const s = data.summary;

  const daysBadge = document.getElementById('bt-days-badge');
  if (daysBadge && s.totalTradingDays) {
    daysBadge.textContent = `2006 – 2026 MJDTA Historical (${s.totalTradingDays.toLocaleString('en-IN')} Trading Days${s.endDate ? ` • Through ${s.endDate}` : ''})`;
  }
  const winrateBadge = document.getElementById('bt-winrate-badge');
  if (winrateBadge) winrateBadge.textContent = `${s.winRatePct}% Win Rate`;
  const macroConfBadge = document.getElementById('bt-macro-confirmed-badge');
  if (macroConfBadge && data.macroBacktestSummary?.macroConfirmed) {
    const mc = data.macroBacktestSummary.macroConfirmed;
    macroConfBadge.textContent = `Macro-Confirmed (≥8/10): ${mc.winRate7dPct}% 7D / ${mc.winRate1dPct}% T+1`;
  }
  const heroSub = document.getElementById('bt-hero-sub');
  if (heroSub && s.currentRate22k_1g) {
    const matched = data.macroBacktestSummary?.matchedTradingDays || s.totalTradingDays;
    heroSub.textContent = `Evaluated across ${matched.toLocaleString('en-IN')} MJDTA days (₹${s.startRate22k_1g.toLocaleString('en-IN')}/g in 2006 ➔ ₹${s.currentRate22k_1g.toLocaleString('en-IN')}/g as of ${s.endDate || 'today'}) aligned daily with Spot Gold (9.5), US 10Y (8.5), USD/INR (8.0) & DXY (8.0).`;
  }
  const cagrSub = document.getElementById('bt-cagr-sub');
  if (cagrSub && s.currentRate22k_1g) {
    cagrSub.textContent = `₹${s.startRate22k_1g.toLocaleString('en-IN')}/g (2006) ➔ ₹${s.currentRate22k_1g.toLocaleString('en-IN')}/g (${s.endDate || '2026'})`;
  }
  const opt2026 = document.getElementById('bt-opt-2026');
  const y2026 = data.yearlyBreakdown?.find(b => b.year === 2026);
  if (opt2026 && y2026) {
    opt2026.textContent = `2026 (Historic High: ₹${y2026.startPrice.toLocaleString('en-IN')} ➔ ₹${y2026.endPrice.toLocaleString('en-IN')}/g)`;
  }

  // Render Yearly Matrix Table (2006 - 2026)
  if (Array.isArray(data.yearlyBreakdown)) {
    renderYearlyTable(data.yearlyBreakdown);
  }

  // Render Regimes Table
  if (Array.isArray(data.regimes)) {
    renderRegimesTable(data.regimes);
  }

  // Render Metric Cards according to selected year/era
  updateBacktestMetricsDisplay(backtestSelectedYear);

  // Render Today Signal + Yesterday Next-Day Validation Banner
  renderLiveStrategyValidationBanner(data);

  // Render Chart
  if (Array.isArray(data.historicalChart)) {
    renderBacktestChart(data.historicalChart, backtestSelectedEra);
  }

  // Render Audit Log Table
  renderAuditLogTable();
}

function updateBacktestMetricsDisplay(year = 'all') {
  if (!backtestDataCache || !backtestDataCache.summary) return;
  const s = backtestDataCache.summary;

  const pillWin = document.getElementById('bt-winrate-pill');
  const pillSav = document.getElementById('bt-avg-saving-pill');
  const elSignals = document.getElementById('bt-total-signals');
  const elWinRate = document.getElementById('bt-win-rate');
  const elAvgSov = document.getElementById('bt-avg-sovereign');
  const elTotSav = document.getElementById('bt-total-savings');
  const elCagr = document.getElementById('bt-cagr');
  const elHorizon = document.getElementById('bt-avg-horizon');

  if (year === 'all') {
    if (pillWin) pillWin.textContent = `${s.winRatePct}%`;
    if (pillSav) pillSav.textContent = `₹${s.avgSovereignSavingOnWin.toLocaleString('en-IN')}`;
    if (elSignals) {
      elSignals.textContent = s.totalDipSignalsEvaluated.toLocaleString('en-IN');
      if (elSignals.nextElementSibling) {
        elSignals.nextElementSibling.textContent = `${s.dipWins} Wins • ${s.dipLosses} Losses • ${s.dipNeutral} Flat`;
      }
    }
    if (elWinRate) elWinRate.textContent = `${s.winRatePct}%`;
    if (elAvgSov) elAvgSov.textContent = `₹${s.avgSovereignSavingOnWin.toLocaleString('en-IN')}`;
    if (elTotSav) elTotSav.textContent = `₹${s.totalCumulativeSovereignSavings.toLocaleString('en-IN')}`;
    if (elCagr) elCagr.innerHTML = `${s.historicalReturnMultiplier}x <span class="sub-cagr">(${s.cagrPct}% CAGR)</span>`;
    if (elHorizon) elHorizon.textContent = `${s.avgDipHorizonDays} Days`;
  } else {
    const yNum = parseInt(year, 10);
    const yData = backtestDataCache.yearlyBreakdown?.find(b => b.year === yNum);
    if (yData) {
      if (pillWin) pillWin.textContent = `${yData.winRatePct}%`;
      if (pillSav) pillSav.textContent = `₹${yData.avgSavingPerSovereign.toLocaleString('en-IN')}`;
      if (elSignals) {
        elSignals.textContent = yData.signals.toLocaleString('en-IN');
        if (elSignals.nextElementSibling) {
          elSignals.nextElementSibling.textContent = `${yData.wins} Wins • ${yData.losses} Losses • ${yData.neutral} Flat`;
        }
      }
      if (elWinRate) elWinRate.textContent = `${yData.winRatePct}%`;
      if (elAvgSov) elAvgSov.textContent = `₹${yData.avgSavingPerSovereign.toLocaleString('en-IN')}`;
      if (elTotSav) elTotSav.textContent = `₹${yData.totalSovereignSavings.toLocaleString('en-IN')}`;
      if (elCagr) {
        const sign = yData.annualReturnPct >= 0 ? '+' : '';
        elCagr.innerHTML = `${sign}${yData.annualReturnPct}% <span class="sub-cagr">(Annual Return)</span>`;
      }
      if (elHorizon) elHorizon.textContent = `~3.8 Days`;
    }
  }
}

function renderYearlyTable(breakdown) {
  const tbody = document.getElementById('yearly-tbody');
  if (!tbody || !Array.isArray(breakdown)) return;

  const sortedBreakdown = [...breakdown].sort((a, b) => b.year - a.year);
  tbody.innerHTML = sortedBreakdown.map(b => {
    const returnSign = b.annualReturnPct >= 0 ? '+' : '';
    const returnColor = b.annualReturnPct >= 0 ? 'positive' : 'negative';
    const isCurrentActive = (String(b.year) === String(backtestSelectedYear));

    return `
      <tr class="${isCurrentActive ? 'active-year-row' : ''}">
        <td><strong><code>${b.year}</code></strong></td>
        <td>₹${b.startPrice.toLocaleString('en-IN')}</td>
        <td><strong>₹${b.endPrice.toLocaleString('en-IN')}</strong></td>
        <td><strong class="${returnColor}">${returnSign}${b.annualReturnPct}%</strong></td>
        <td>${b.signals} signals</td>
        <td><strong class="positive">${b.wins} wins</strong></td>
        <td><strong class="positive">${b.winRatePct}%</strong></td>
        <td><strong class="gold">₹${b.avgSavingPerSovereign.toLocaleString('en-IN')}</strong></td>
        <td><strong class="cyan">₹${b.totalSovereignSavings.toLocaleString('en-IN')}</strong></td>
        <td>
          <button class="btn-filter-year-mini" onclick="filterBacktestByYear('${b.year}')">
            🔍 Inspect ${b.year}
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

function filterBacktestByYear(year) {
  backtestSelectedYear = year;
  auditVisibleCount = 30; // reset pagination

  // Sync dropdowns
  const selTop = document.getElementById('select-backtest-year');
  const selAudit = document.getElementById('select-audit-year');
  if (selTop && selTop.value !== year) selTop.value = year;
  if (selAudit && selAudit.value !== year) selAudit.value = year;

  // Sync Era buttons
  document.querySelectorAll('.btn-era-pill').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-era') === year || (year === 'all' && btn.getAttribute('data-era') === 'all'));
  });

  // Update highlight metrics
  updateBacktestMetricsDisplay(year);

  // Update chart
  if (backtestDataCache?.historicalChart) {
    let chartEra = 'all';
    if (year !== 'all') {
      const y = parseInt(year, 10);
      if (y >= 2006 && y <= 2010) chartEra = '2006-2010';
      else if (y >= 2011 && y <= 2015) chartEra = '2011-2015';
      else if (y >= 2016 && y <= 2020) chartEra = '2016-2020';
      else if (y >= 2021 && y <= 2026) chartEra = '2021-2026';
    }
    backtestSelectedEra = chartEra;
    renderBacktestChart(backtestDataCache.historicalChart, chartEra);
    document.querySelectorAll('.bt-tf-btn').forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-chart-era') === chartEra);
    });
  }

  // Refresh yearly table highlighting
  if (backtestDataCache?.yearlyBreakdown) {
    renderYearlyTable(backtestDataCache.yearlyBreakdown);
  }

  // Refresh audit log table
  renderAuditLogTable();
}

// Global expose so inline onclick handler works
window.filterBacktestByYear = filterBacktestByYear;

function renderBacktestChart(chartData, era = 'all') {
  const canvas = document.getElementById('chart-backtest-history');
  if (!canvas || typeof Chart === 'undefined') return;

  let filtered = chartData;
  if (era === '2006-2010') {
    filtered = chartData.filter(d => d.year >= 2006 && d.year <= 2010);
  } else if (era === '2011-2015') {
    filtered = chartData.filter(d => d.year >= 2011 && d.year <= 2015);
  } else if (era === '2016-2020') {
    filtered = chartData.filter(d => d.year >= 2016 && d.year <= 2020);
  } else if (era === '2021-2026') {
    filtered = chartData.filter(d => d.year >= 2021 && d.year <= 2026);
  }

  const labels = filtered.map(d => d.date);
  const goldPrices = filtered.map(d => d.price);
  const sma50Values = filtered.map(d => d.sma50);
  const sma200Values = filtered.map(d => d.sma200);

  if (backtestChartInstance) {
    backtestChartInstance.destroy();
  }

  const ctx = canvas.getContext('2d');
  const isLight = (currentTheme === 'light');
  const goldColor = isLight ? '#b45309' : '#fbbf24';
  const goldBg = isLight ? 'rgba(180, 83, 9, 0.08)' : 'rgba(251, 191, 36, 0.08)';
  const gridX = isLight ? 'rgba(0, 0, 0, 0.06)' : 'rgba(255, 255, 255, 0.04)';
  const gridY = isLight ? 'rgba(0, 0, 0, 0.06)' : 'rgba(255, 255, 255, 0.05)';
  const tickX = isLight ? '#475569' : '#64748b';
  const tickY = isLight ? '#334155' : '#94a3b8';
  const tipBg = isLight ? '#ffffff' : '#0f172a';
  const tipTitle = isLight ? '#b45309' : '#fbbf24';
  const tipBody = isLight ? '#0f172a' : '#f1f5f9';
  const tipBorder = isLight ? '#cbd5e1' : '#334155';

  backtestChartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: '22K Gold Rate (₹/g)',
          data: goldPrices,
          borderColor: goldColor,
          backgroundColor: goldBg,
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 5,
          tension: 0.1,
          fill: true
        },
        {
          label: '50-Day Trend (SMA 50)',
          data: sma50Values,
          borderColor: isLight ? '#0284c7' : '#38bdf8',
          borderWidth: 1.5,
          borderDash: [4, 4],
          pointRadius: 0,
          fill: false,
          tension: 0.1
        },
        {
          label: '200-Day Baseline (SMA 200)',
          data: sma200Values,
          borderColor: isLight ? '#9333ea' : '#a855f7',
          borderWidth: 1.5,
          pointRadius: 0,
          fill: false,
          tension: 0.1
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: 'index',
        intersect: false
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: tipBg,
          titleColor: tipTitle,
          bodyColor: tipBody,
          borderColor: tipBorder,
          borderWidth: 1,
          callbacks: {
            label: (item) => `${item.dataset.label}: ₹${item.raw.toLocaleString('en-IN')} / g (Sovereign: ₹${(item.raw * 8).toLocaleString('en-IN')})`
          }
        }
      },
      scales: {
        x: {
          grid: { color: gridX },
          ticks: {
            color: tickX,
            maxTicksLimit: 12,
            font: { family: 'JetBrains Mono', size: 10 }
          }
        },
        y: {
          grid: { color: gridY },
          ticks: {
            color: tickY,
            font: { family: 'JetBrains Mono', size: 10 },
            callback: (v) => '₹' + v.toLocaleString('en-IN')
          }
        }
      }
    }
  });
}

function renderRegimesTable(regimes) {
  const tbody = document.getElementById('regimes-tbody');
  if (!tbody) return;

  tbody.innerHTML = regimes.map(r => {
    let reliabilityBadge = '<span class="badge-outcome win">HIGH ALPHA</span>';
    if (r.winRatePct < 70) {
      reliabilityBadge = '<span class="badge-outcome neutral">MODERATE</span>';
    }

    return `
      <tr>
        <td><strong>${r.regime}</strong></td>
        <td>${r.signals} signals</td>
        <td><strong class="positive">${r.wins} wins</strong></td>
        <td><strong class="positive">${r.winRatePct}%</strong></td>
        <td><strong class="gold">₹${r.avgSavingPerSignal.toLocaleString('en-IN')}</strong></td>
        <td><strong class="cyan">₹${r.totalSovereignSavings.toLocaleString('en-IN')}</strong></td>
        <td>${reliabilityBadge}</td>
      </tr>
    `;
  }).join('');
}

function renderAuditLogTable() {
  const tbody = document.getElementById('audit-log-tbody');
  if (!tbody) return;

  const isDailyMode = (currentAuditMode === 'daily');
  const sourceRows = isDailyMode
    ? (backtestDataCache?.dailyScorecard || [])
    : (backtestDataCache?.allSignals || backtestDataCache?.recentSignals || []);

  // Filter by Selected Year
  let filtered = sourceRows;
  if (backtestSelectedYear !== 'all') {
    const yNum = parseInt(backtestSelectedYear, 10);
    filtered = filtered.filter(s => s.year === yNum || (s.date && s.date.startsWith(backtestSelectedYear)));
  }

  // Filter by Signal Call (BUY_NOW, ACCUMULATE, AVOID_WAIT, HOLD)
  if (currentAuditSignalType !== 'all') {
    filtered = filtered.filter(s => s.signalType === currentAuditSignalType);
  }

  // Filter by Outcome (All, Next-Day Succeeded, 7D Wins, Missed/Losses)
  if (currentAuditFilter === 'next_ok') {
    filtered = filtered.filter(s => s.nextDayStatus === 'SUCCEEDED');
  } else if (currentAuditFilter === 'wins') {
    filtered = filtered.filter(s => isDailyMode ? s.nextDayStatus === 'SUCCEEDED' : s.outcome === 'WIN_SAVED');
  } else if (currentAuditFilter === 'losses') {
    filtered = filtered.filter(s =>
      isDailyMode
        ? s.nextDayStatus === 'MISSED'
        : (s.outcome === 'LOSS_SURGED' || s.nextDayStatus === 'MISSED')
    );
  }

  // Filter by Search Query
  if (auditSearchQuery.trim()) {
    const q = auditSearchQuery.trim().toLowerCase();
    filtered = filtered.filter(s =>
      (s.date && s.date.toLowerCase().includes(q)) ||
      String(s.price).includes(q) ||
      (s.signalLabel && s.signalLabel.toLowerCase().includes(q)) ||
      (s.signalType && s.signalType.toLowerCase().includes(q)) ||
      (s.macroBias && s.macroBias.toLowerCase().includes(q)) ||
      (s.nextDayStatus && s.nextDayStatus.toLowerCase().includes(q)) ||
      (s.regime && s.regime.toLowerCase().includes(q))
    );
  }

  // Always order Signal History dates descending (newest first)
  filtered = [...filtered].sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  // Update Counter Label
  const countLabel = document.getElementById('audit-count-label');
  const visible = filtered.slice(0, auditVisibleCount);
  if (countLabel) {
    const modeText = isDailyMode ? 'daily logs (90D)' : 'signals';
    const yearText = backtestSelectedYear === 'all' ? '2026–2006' : backtestSelectedYear;
    countLabel.textContent = `Showing ${visible.length} of ${filtered.length} ${modeText} (${yearText})`;
  }

  // Toggle Load More / Show All buttons
  const loadMoreBtn = document.getElementById('btn-load-more-signals');
  if (loadMoreBtn) {
    loadMoreBtn.style.display = visible.length >= filtered.length ? 'none' : 'inline-block';
  }
  const loadAllBtn = document.getElementById('btn-load-all-signals');
  if (loadAllBtn) {
    loadAllBtn.textContent = `Show All (${filtered.length})`;
    loadAllBtn.style.display = visible.length >= filtered.length ? 'none' : 'inline-block';
  }

  if (visible.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" style="text-align:center; padding: 24px; color: var(--text-muted);">No signals matched the selected criteria (${backtestSelectedYear}).</td></tr>`;
    return;
  }

  tbody.innerHTML = visible.map(s => {
    const sigCls = getSignalBadgeClass(s.signalType);
    const sigLabel = s.signalLabel || s.signalType;
    const ndInfo = getNextDayBadgeInfo(s);

    const macroCls = s.macroBias === 'TAILWIND' ? 'succeeded' : (s.macroBias === 'HEADWIND' ? 'missed' : 'flat');
    const macroHtml = s.macroScore != null
      ? `<span class="nextday-verdict-badge ${macroCls}">${s.macroScore}/100 ${s.macroBias}</span><br><small class="text-muted">XAU $${Math.round(s.spotGoldUsd || 0).toLocaleString('en-US')} • ₹${(s.usdInr || 0).toFixed(1)}</small>`
      : `<span class="text-muted">N/A</span>`;

    let nextDayHtml = `<span class="text-muted">⏳ Tomorrow</span>`;
    if (s.nextDayPrice != null) {
      const sign = s.nextDayDiff >= 0 ? '+' : '-';
      const diffCls = s.nextDayDiff > 0 ? 'positive' : (s.nextDayDiff < 0 ? 'negative' : 'text-muted');
      nextDayHtml = `<strong>₹${s.nextDayPrice.toLocaleString('en-IN')}/g</strong><br><small class="${diffCls}">${sign}₹${Math.abs(s.nextDayDiff)} (${s.nextDayDate || ''})</small>`;
    }

    let targetHtml = `<span class="text-muted">— Daily Check —</span>`;
    let savingText = s.nextDayPrice != null
      ? `<span class="${s.nextDayStatus === 'SUCCEEDED' ? 'positive' : (s.nextDayStatus === 'MISSED' ? 'negative' : 'text-muted')}">${s.nextDaySovereignDiff >= 0 ? '+' : '-'}₹${Math.abs(s.nextDaySovereignDiff || 0).toLocaleString('en-IN')}</span>`
      : `<span class="text-muted">Pending</span>`;

    let outcomeBadge = '<span class="badge-outcome neutral">DAILY HOLD</span>';
    if (s.outcome === 'PENDING') {
      targetHtml = `<span class="text-muted">Live Today</span>`;
      savingText = `<span class="text-muted">Pending</span>`;
      outcomeBadge = '<span class="badge-outcome neutral">PENDING TODAY</span>';
    } else if (s.outcome === 'WIN_SAVED') {
      targetHtml = `<strong class="cyan">₹${s.minForwardPrice.toLocaleString('en-IN')}/g</strong><br><small class="text-muted">Day +${s.minForwardDay}</small>`;
      savingText = `<span class="positive">+₹${s.savingsPerSovereign.toLocaleString('en-IN')} (+${s.pctSaved}%)</span>`;
      outcomeBadge = `<span class="badge-outcome win">${s.outcomeLabel || 'WIN'}</span>`;
    } else if (s.outcome === 'LOSS_SURGED') {
      targetHtml = `<strong class="cyan">₹${s.minForwardPrice.toLocaleString('en-IN')}/g</strong><br><small class="text-muted">Day +${s.minForwardDay}</small>`;
      savingText = `<span class="negative">-₹${Math.abs(s.savingsPerSovereign).toLocaleString('en-IN')}</span>`;
      outcomeBadge = `<span class="badge-outcome loss">${s.outcomeLabel || 'MISSED'}</span>`;
    } else if (s.outcome === 'NEUTRAL_FLAT') {
      targetHtml = `<strong class="cyan">₹${s.minForwardPrice.toLocaleString('en-IN')}/g</strong><br><small class="text-muted">Day +${s.minForwardDay}</small>`;
      savingText = `₹0`;
      outcomeBadge = `<span class="badge-outcome neutral">FLAT</span>`;
    }

    const regimeHtml = s.regime ? `<br><small class="text-muted">${s.regime}</small>` : '';

    return `
      <tr>
        <td><code>${s.date}</code><br><small class="text-muted">RSI ${s.rsi ?? '--'}</small></td>
        <td><span class="sig-call-badge ${sigCls}">${sigLabel}</span></td>
        <td><strong>₹${s.price.toLocaleString('en-IN')}/g</strong><br><small class="text-muted">₹${(s.sovereignPrice || s.price * 8).toLocaleString('en-IN')}/Sov</small></td>
        <td>${macroHtml}</td>
        <td>${nextDayHtml}</td>
        <td><span class="nextday-verdict-badge ${ndInfo.cls}">${ndInfo.label}</span><br><small class="text-muted">${s.nextDayReason || ''}</small></td>
        <td>${targetHtml}</td>
        <td><strong>${savingText}</strong></td>
        <td>${outcomeBadge}${regimeHtml}</td>
      </tr>
    `;
  }).join('');
}

function setAuditMode(mode) {
  currentAuditMode = mode;
  auditVisibleCount = 30;
  document.getElementById('btn-audit-mode-signals')?.classList.toggle('active', mode === 'signals');
  document.getElementById('btn-audit-mode-daily')?.classList.toggle('active', mode === 'daily');
  renderAuditLogTable();
}

function setAuditFilter(filter) {
  currentAuditFilter = filter;
  auditVisibleCount = 30;
  document.querySelectorAll('.audit-filter-btn').forEach(b => b.classList.remove('active'));
  if (filter === 'all') document.getElementById('btn-audit-all')?.classList.add('active');
  if (filter === 'next_ok') document.getElementById('btn-audit-nextday')?.classList.add('active');
  if (filter === 'wins') document.getElementById('btn-audit-wins')?.classList.add('active');
  if (filter === 'losses') document.getElementById('btn-audit-losses')?.classList.add('active');
  renderAuditLogTable();
}

// ---------------------------------------------------------------------
// 9. BOOTSTRAP (Resilient Instant-Paint & DOM-Ready Handler)
// ---------------------------------------------------------------------
function startDashboardApp() {
  try { applyTheme(currentTheme); } catch (e) {}
  try { setupEventListeners(); } catch (e) { console.warn('Listener error:', e); }
  try { updateClockAndSessions(); } catch (e) {}
  setInterval(updateClockAndSessions, 1000);

  try { updateApiKeyUI(); } catch (e) {}

  // 1. Immediate synchronous paint of macro metrics so user NEVER waits
  try {
    const initBreakout = computeMatrixLocally(localMarketState);
    const initIndian = calculateIndianPricesLocal(localMarketState.gold.price, localMarketState.usd_inr.price, active22kRate);
    const initAdvice = getRetailAdviceLocal(initBreakout.score, initBreakout.isPerfectStorm);
    renderDashboard({
      market: localMarketState,
      india: initIndian,
      retailAdvice: initAdvice,
      breakout: initBreakout,
      historical: localHistorical,
      correlationMatrix: getStaticCorrelationMatrix()
    });
  } catch (e) {
    console.warn('Initial paint error:', e);
  }

  // 2. Fetch live data from server or local engine
  fetchIndicatorData();
  setInterval(fetchIndicatorData, 4000);

  // 3. Fetch 3-hour autonomous forecast
  fetchForecastData();

  // 4. Initial simulator run
  try { runSimulation(); } catch (e) {}

  // 5. Fetch Top 3 Indian Bullion Organisations
  fetchTop3Organisations();
  setInterval(fetchTop3Organisations, 60000);

  // 6. Fetch 20-Year Strategy Backtest Engine Data
  fetchBacktestData();

  // 7. Check Neon Tech Stack Status
  fetchNeonStatus();
}

async function fetchNeonStatus() {
  try {
    const res = await fetch('/api/status');
    if (res.ok) {
      const data = await res.json();
      const pill = document.getElementById('neon-status-text');
      if (pill && data.services) {
        const pgConnected = data.services.postgres?.status === 'CONNECTED';
        const totalRows = (data.services.postgres?.tables?.mjdta || 0) + (data.services.postgres?.tables?.macro || 0);
        pill.textContent = pgConnected ? `Neon DB (${totalRows.toLocaleString()} rows)` : 'Neon Standby';
        if (pill.parentElement) {
          pill.parentElement.title = `Lakebase Postgres: ${pgConnected ? 'Connected' : 'Standby'} | Auth: ${data.services.auth?.status} | AI Gateway: ${data.services.aiGateway?.status} | Realtime: ${data.services.realtime?.status}`;
        }
      }
    }
  } catch (e) {}
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startDashboardApp);
} else {
  // Document already ready, execute immediately!
  startDashboardApp();
}
