/**
 * Live Global Macro & Cross-Asset Market Feed Service
 * Fetches real-time prices and 30-day aligned daily history via Yahoo Finance Chart API
 * and persists the snapshot to data/macro_live.json for offline/restart continuity.
 */

const https = require('https');
const fs = require('fs');
const path = require('path');
const db = require('./db');

const MACRO_CACHE_FILE = path.join(__dirname, '..', 'data', 'macro_live.json');
const MACRO_HISTORY_FILE = path.join(__dirname, '..', 'data', 'macro_history_2006_2026.json');

const CORE_FACTOR_WEIGHTS = {
  gold: 9.5,
  treasury_yield: 8.5,
  usd_inr: 8.0,
  usd_index: 8.0
};

const SECONDARY_FACTOR_WEIGHTS = {
  crude_oil: 5.5,
  vix: 4.5
};

const DEFAULT_SYMBOLS = {
  gold: ['GC=F', 'XAUUSD=X'],
  usd_inr: ['INR=X'],
  crude_oil: ['CL=F'],
  usd_index: ['DX-Y.NYB'],
  treasury_yield: ['^TNX'],
  vix: ['^VIX']
};

const zlib = require('zlib');
const { execFile } = require('child_process');

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate'
};

function requestViaCurl(url, timeoutMs = 30000, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const args = ['-sSL', '--compressed', '--max-time', String(Math.ceil(timeoutMs / 1000)), '-w', '\n__HTTP_CODE__:%{http_code}'];
    const merged = { ...BROWSER_HEADERS, ...extraHeaders };
    delete merged['Accept-Encoding'];
    for (const [k, v] of Object.entries(merged)) {
      args.push('-H', `${k}: ${v}`);
    }
    args.push(url);
    execFile('curl', args, { maxBuffer: 32 * 1024 * 1024 }, (err, stdout) => {
      if (err) return reject(new Error(`curl error for ${url}: ${err.message}`));
      const markerIdx = stdout.lastIndexOf('\n__HTTP_CODE__:');
      const statusCode = markerIdx >= 0 ? parseInt(stdout.slice(markerIdx + 15).trim(), 10) : 200;
      const body = markerIdx >= 0 ? stdout.slice(0, markerIdx) : stdout;
      resolve({ statusCode: isNaN(statusCode) ? 0 : statusCode, headers: {}, body });
    });
  });
}

async function requestHttpsRaw(url, timeoutMs = 25000, extraHeaders = {}, redirectsLeft = 3, useCurlFallback = true) {
  const nodeRes = await new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { ...BROWSER_HEADERS, ...extraHeaders },
      timeout: timeoutMs
    }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirectsLeft > 0) {
        const nextUrl = res.headers.location.startsWith('http')
          ? res.headers.location
          : new URL(res.headers.location, url).toString();
        res.resume();
        return requestHttpsRaw(nextUrl, timeoutMs, extraHeaders, redirectsLeft - 1, useCurlFallback).then(resolve, reject);
      }
      const enc = (res.headers['content-encoding'] || '').toLowerCase();
      let stream = res;
      if (enc.includes('gzip')) stream = res.pipe(zlib.createGunzip());
      else if (enc.includes('deflate')) stream = res.pipe(zlib.createInflate());

      const chunks = [];
      stream.on('data', chunk => chunks.push(chunk));
      stream.on('end', () => {
        resolve({ statusCode: res.statusCode || 0, headers: res.headers || {}, body: Buffer.concat(chunks).toString('utf8') });
      });
      stream.on('error', reject);
    });

    req.on('timeout', () => req.destroy(new Error(`Timeout fetching ${url}`)));
    req.on('error', reject);
  }).catch(err => ({ statusCode: 0, headers: {}, body: '', error: err }));

  // If WAF blocks Node OpenSSL TLS fingerprint (403/429), retry once via native macOS LibreSSL/HTTP2 curl
  if (useCurlFallback && (nodeRes.statusCode === 403 || nodeRes.statusCode === 429 || nodeRes.statusCode === 0)) {
    try {
      const curlRes = await requestViaCurl(url, timeoutMs, extraHeaders);
      if (curlRes.statusCode > 0 && curlRes.statusCode < 400) {
        return curlRes;
      }
    } catch (e) {}
  }
  if (nodeRes.error) throw nodeRes.error;
  return nodeRes;
}

let _yahooSessionCache = null;

async function getYahooSession() {
  if (_yahooSessionCache && (Date.now() - _yahooSessionCache.ts < 10 * 60 * 1000)) {
    return _yahooSessionCache;
  }
  try {
    const init = await requestHttpsRaw('https://fc.yahoo.com', 12000);
    const setCookies = init.headers['set-cookie'];
    const cookieList = Array.isArray(setCookies) ? setCookies : (setCookies ? [setCookies] : []);
    const cookie = cookieList.map(c => c.split(';')[0]).filter(Boolean).join('; ');
    if (!cookie) return null;

    const crumbRes = await requestHttpsRaw('https://query2.finance.yahoo.com/v1/test/getcrumb', 12000, {
      Cookie: cookie,
      Referer: 'https://finance.yahoo.com/'
    });
    if (crumbRes.statusCode === 200 && crumbRes.body && !crumbRes.body.includes('Too Many')) {
      _yahooSessionCache = { cookie, crumb: crumbRes.body.trim(), ts: Date.now() };
      return _yahooSessionCache;
    }
  } catch (e) {}
  return null;
}

async function requestYahooUrl(url, timeoutMs, session = null) {
  const headers = { Referer: 'https://finance.yahoo.com/' };
  if (session?.cookie) headers.Cookie = session.cookie;
  const fullUrl = session?.crumb
    ? `${url}${url.includes('?') ? '&' : '?'}crumb=${encodeURIComponent(session.crumb)}`
    : url;

  const { statusCode, body } = await requestHttpsRaw(fullUrl, timeoutMs, headers);
  if (statusCode >= 400) {
    const err = new Error(`HTTP ${statusCode} for ${fullUrl}: ${body.slice(0, 100).replace(/\s+/g, ' ')}`);
    err.statusCode = statusCode;
    throw err;
  }
  const json = JSON.parse(body);
  const result = json?.chart?.result?.[0];
  if (!result || !result.meta) {
    throw new Error(`No Yahoo chart data for ${fullUrl}`);
  }
  return result;
}

async function fetchYahooChart(symbol, rangeOrOpts = '1mo', interval = '1d') {
  const encoded = encodeURIComponent(symbol);
  const isOptsObj = rangeOrOpts && typeof rangeOrOpts === 'object';
  let query;
  if (isOptsObj) {
    const iv = rangeOrOpts.interval || interval || '1d';
    const p1 = Math.floor(Number(rangeOrOpts.period1));
    const p2 = Math.floor(Number(rangeOrOpts.period2 || (Date.now() / 1000)));
    query = `period1=${p1}&period2=${p2}&interval=${encodeURIComponent(iv)}`;
  } else {
    query = `range=${encodeURIComponent(rangeOrOpts || '1mo')}&interval=${encodeURIComponent(interval || '1d')}`;
  }
  const timeoutMs = isOptsObj ? 25000 : 12000;
  const session = await getYahooSession();
  const hosts = ['query1.finance.yahoo.com', 'query2.finance.yahoo.com'];
  let lastErr = null;
  for (let i = 0; i < hosts.length; i++) {
    const url = `https://${hosts[i]}/v8/finance/chart/${encoded}?${query}`;
    try {
      return await requestYahooUrl(url, timeoutMs, session);
    } catch (err) {
      lastErr = err;
      if (i < hosts.length - 1) {
        await new Promise(r => setTimeout(r, err.statusCode === 429 ? 1500 : 400));
      }
    }
  }
  throw lastErr || new Error(`Failed fetching ${symbol}`);
}

function normalizeIsoDate(raw) {
  const s = String(raw || '').trim().replace(/"/g, '');
  const iso = s.slice(0, 10).replace(/\./g, '-');
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const mdy = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (mdy) return `${mdy[3]}-${mdy[1]}-${mdy[2]}`;
  return '';
}

function parseCsvPoints(csvText, minDate = '2005-10-01') {
  const lines = String(csvText || '').trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const delim = lines[0].includes(';') && !lines[0].includes(',') ? ';' : ',';
  const headerCols = lines[0].replace(/"/g, '').toLowerCase().split(delim).map(s => s.trim());
  const dateIdx = headerCols.findIndex(c => c.includes('date') || c.includes('time'));
  let closeIdx = headerCols.findIndex(c => c === 'close' || c === 'price');
  if (closeIdx === -1) closeIdx = headerCols.length - 1;
  if (dateIdx === -1) return [];

  const byDate = new Map();
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].replace(/"/g, '').split(delim);
    const d = normalizeIsoDate(cols[dateIdx]);
    const v = parseFloat((cols[closeIdx] || '').trim());
    if (d && d >= minDate && !isNaN(v) && v > 0) {
      byDate.set(d, { date: d, close: v, high: v, low: v });
    }
  }
  return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
}

async function fetchLbmaGoldDaily(minDate = '2005-10-01') {
  const url = 'https://prices.lbma.org.uk/json/gold_pm.json';
  const { statusCode, body } = await requestHttpsRaw(url, 40000, {
    Referer: 'https://www.lbma.org.uk/',
    Origin: 'https://www.lbma.org.uk',
    Accept: 'application/json, text/javascript, */*; q=0.01'
  });
  if (statusCode >= 400) throw new Error(`HTTP ${statusCode} from LBMA`);
  const arr = JSON.parse(body);
  if (!Array.isArray(arr)) throw new Error('Unexpected LBMA JSON format');
  const dailyPoints = [];
  for (const row of arr) {
    const d = row?.d;
    const usd = Array.isArray(row?.v) ? Number(row.v[0]) : NaN;
    if (d && d >= minDate && !isNaN(usd) && usd > 0) {
      dailyPoints.push({ date: d, close: usd, high: usd, low: usd });
    }
  }
  dailyPoints.sort((a, b) => a.date.localeCompare(b.date));
  if (dailyPoints.length < 2500) throw new Error(`LBMA insufficient rows (${dailyPoints.length})`);
  const last = dailyPoints[dailyPoints.length - 1];
  return { symbol: 'LBMA:Gold_PM_USD', price: last.close, dailyPoints };
}

async function fetchNasdaqGldDaily(minDate = '2005-10-01', liveMarket = {}) {
  const todayStr = new Date().toISOString().slice(0, 10);
  const url = `https://api.nasdaq.com/api/quote/GLD/historical?assetclass=etf&fromdate=${minDate}&todate=${todayStr}&limit=9999`;
  const { statusCode, body } = await requestHttpsRaw(url, 35000, {
    Referer: 'https://www.nasdaq.com/',
    Origin: 'https://www.nasdaq.com'
  });
  if (statusCode >= 400) throw new Error(`HTTP ${statusCode} from Nasdaq GLD`);
  const json = JSON.parse(body);
  const rows = json?.data?.tradesTable?.rows;
  if (!Array.isArray(rows) || rows.length < 2500) {
    throw new Error(`Nasdaq GLD insufficient rows (${rows?.length || 0})`);
  }
  const rawPts = [];
  for (const r of rows) {
    const m = String(r.date || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!m) continue;
    const iso = `${m[3]}-${m[1]}-${m[2]}`;
    const c = parseFloat(String(r.close || '').replace(/[$,]/g, ''));
    if (iso >= minDate && !isNaN(c) && c > 0) {
      rawPts.push({ date: iso, gld: c });
    }
  }
  rawPts.sort((a, b) => a.date.localeCompare(b.date));
  const lastGld = rawPts[rawPts.length - 1]?.gld || 1;
  const liveGold = liveMarket?.gold?.price > 500 ? liveMarket.gold.price : lastGld * 10.75;
  const scale = liveGold / lastGld;
  const dailyPoints = rawPts.map(p => {
    const est = +(p.gld * scale).toFixed(2);
    return { date: p.date, close: est, high: est, low: est };
  });
  return { symbol: 'NASDAQ:GLD(XAU-scaled)', price: dailyPoints[dailyPoints.length - 1].close, dailyPoints };
}

async function fetchFreeGoldApiPoints(minDate = '2005-10-01') {
  const url = 'https://freegoldapi.com/data/latest.json';
  const { statusCode, body } = await requestHttpsRaw(url, 30000);
  if (statusCode >= 400) throw new Error(`HTTP ${statusCode} from FreeGoldAPI`);
  const arr = JSON.parse(body);
  if (!Array.isArray(arr)) throw new Error('Unexpected FreeGoldAPI format');
  const dailyPoints = [];
  for (const row of arr) {
    const d = (row?.date || '').slice(0, 10);
    const p = Number(row?.price);
    if (/^\d{4}-\d{2}-\d{2}$/.test(d) && d >= minDate && !isNaN(p) && p > 0) {
      dailyPoints.push({ date: d, close: p, high: p, low: p });
    }
  }
  dailyPoints.sort((a, b) => a.date.localeCompare(b.date));
  return dailyPoints;
}

async function fetchFreeGoldApiDaily(minDate = '2005-10-01') {
  const dailyPoints = await fetchFreeGoldApiPoints(minDate);
  if (dailyPoints.length < 4500) throw new Error(`FreeGoldAPI insufficient rows (${dailyPoints.length})`);
  return { symbol: 'FreeGoldAPI:XAU_USD', price: dailyPoints[dailyPoints.length - 1].close, dailyPoints };
}

async function fetchHuggingFaceXauDaily(minDate = '2005-10-01') {
  const repos = [
    'ZombitX64/xauusd-gold-price-historical-data-2004-2025',
    'JonusNattapong/xauusd-dataset'
  ];
  const attemptErrors = [];

  for (const repo of repos) {
    try {
      const treeUrl = `https://huggingface.co/api/datasets/${repo}/tree/main`;
      const treeRes = await requestHttpsRaw(treeUrl, 20000);
      if (treeRes.statusCode >= 400) {
        attemptErrors.push(`${repo} tree HTTP ${treeRes.statusCode}`);
        continue;
      }
      const files = JSON.parse(treeRes.body);
      if (!Array.isArray(files)) continue;

      const candidates = files
        .filter(f => f?.type === 'file' && /\.(csv|jsonl|json)$/i.test(f.path || '') && !/(?:1m|5m|15m|30m|1h|4h)/i.test(f.path || '') && (f.size || 0) < 10 * 1024 * 1024)
        .sort((a, b) => {
          const score = (p) => (/1d|daily/i.test(p) ? 0 : /comprehensive/i.test(p) ? 1 : 2);
          return score(a.path) - score(b.path) || (a.size || 0) - (b.size || 0);
        });

      for (const file of candidates) {
        const rawUrl = `https://huggingface.co/datasets/${repo}/resolve/main/${file.path}`;
        const { statusCode, body } = await requestHttpsRaw(rawUrl, 45000);
        if (statusCode >= 400 || !body) continue;

        let dailyPoints = [];
        if (file.path.toLowerCase().endsWith('.csv')) {
          dailyPoints = parseCsvPoints(body, minDate);
        } else {
          const byDate = new Map();
          for (const line of String(body).trim().split(/\r?\n/)) {
            if (!line || line[0] !== '{') continue;
            try {
              const row = JSON.parse(line);
              const d = normalizeIsoDate(row.Date || row.date || row.Datetime || row.datetime || row.timestamp);
              const c = Number(row.Close ?? row.close ?? row.price ?? row.Price);
              if (d && d >= minDate && !isNaN(c) && c > 0) {
                byDate.set(d, { date: d, close: c, high: c, low: c });
              }
            } catch (e) {}
          }
          dailyPoints = Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
        }

        if (dailyPoints.length >= 3500 && dailyPoints[0].date <= '2006-01-10') {
          return {
            symbol: `HF:${repo}/${file.path}`,
            price: dailyPoints[dailyPoints.length - 1].close,
            dailyPoints
          };
        }
        attemptErrors.push(`${repo}/${file.path}: rows=${dailyPoints.length}`);
      }
    } catch (e) {
      attemptErrors.push(`${repo}: ${e.message}`);
    }
  }
  throw new Error(`HuggingFace XAU failed (${attemptErrors.join('; ')})`);
}

async function fetchStitchedSpotGold2006To2026(minDate = '2005-10-01', liveMarket = {}) {
  const hf = await fetchHuggingFaceXauDaily(minDate);
  const byDate = new Map();
  // Use dense daily HuggingFace XAU bars up through 2024-12-31 before sparse 2025 gaps
  const denseCutoff = '2024-12-31';
  let baseEnd = minDate;
  for (const p of hf.dailyPoints) {
    if (p.date <= denseCutoff) {
      byDate.set(p.date, p);
      if (p.date > baseEnd) baseEnd = p.date;
    }
  }

  let tailSource = '';
  const gld = await fetchNasdaqGldDaily(minDate, liveMarket);
  const overlapPairs = [];
  for (const gp of gld.dailyPoints) {
    if (gp.date <= baseEnd && byDate.has(gp.date)) {
      overlapPairs.push({ spot: byDate.get(gp.date).close, gld: gp.close });
    }
  }
  const recentOverlap = overlapPairs.slice(-20);
  const ratio0 = recentOverlap.length > 0
    ? recentOverlap.reduce((s, r) => s + (r.spot / r.gld), 0) / recentOverlap.length
    : 1;

  const tailPts = gld.dailyPoints.filter(gp => gp.date > baseEnd);
  if (tailPts.length > 0) {
    const liveGold = liveMarket?.gold?.price > 500 ? liveMarket.gold.price : 0;
    const lastTailGld = tailPts[tailPts.length - 1].close;
    const ratio1 = liveGold > 0 && lastTailGld > 0 ? (liveGold / lastTailGld) : ratio0;
    const denom = Math.max(1, tailPts.length - 1);
    for (let i = 0; i < tailPts.length; i++) {
      const t = i / denom;
      const ratio = ratio0 + (ratio1 - ratio0) * t;
      const est = +(tailPts[i].close * ratio).toFixed(2);
      byDate.set(tailPts[i].date, { date: tailPts[i].date, close: est, high: est, low: est });
    }
    tailSource = '+NasdaqGLD';
  }

  const dailyPoints = Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
  return {
    symbol: `Stitched:XAU(HF->${baseEnd}${tailSource})`,
    price: dailyPoints[dailyPoints.length - 1].close,
    dailyPoints
  };
}

async function fetchDbnomicsLbmaGold(minDate = '2005-10-01') {
  const url = 'https://api.db.nomics.world/v22/series/LBMA/gold_D?observations=true';
  const { statusCode, body } = await requestHttpsRaw(url, 30000);
  if (statusCode >= 400) throw new Error(`HTTP ${statusCode} from DBnomics`);
  const json = JSON.parse(body);
  const docs = json?.series?.docs || [];
  const doc = docs.find(d => (d.dataset_code === 'gold_D' || d.series_code?.includes('USD')) && Array.isArray(d.period)) || docs[0];
  if (!doc || !Array.isArray(doc.period) || !Array.isArray(doc.value)) {
    throw new Error('Unexpected DBnomics payload');
  }
  const dailyPoints = [];
  for (let i = 0; i < doc.period.length; i++) {
    const d = String(doc.period[i] || '').slice(0, 10);
    const v = Number(doc.value[i]);
    if (/^\d{4}-\d{2}-\d{2}$/.test(d) && d >= minDate && !isNaN(v) && v > 0) {
      dailyPoints.push({ date: d, close: v, high: v, low: v });
    }
  }
  dailyPoints.sort((a, b) => a.date.localeCompare(b.date));
  if (dailyPoints.length < 4500) throw new Error(`DBnomics insufficient rows (${dailyPoints.length})`);
  const last = dailyPoints[dailyPoints.length - 1];
  return { symbol: 'DBnomics:LBMA_USD', price: last.close, dailyPoints };
}

async function fetchFredDaily(seriesId, minDate = '2005-10-01') {
  const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${encodeURIComponent(seriesId)}&cosd=${encodeURIComponent(minDate)}`;
  const { statusCode, body } = await requestHttpsRaw(url, 45000);
  if (statusCode >= 400) throw new Error(`HTTP ${statusCode} from FRED (${seriesId})`);
  const dailyPoints = parseCsvPoints(body, minDate);
  if (dailyPoints.length < 2500) {
    throw new Error(`FRED insufficient rows (${dailyPoints.length}) for ${seriesId}`);
  }
  const last = dailyPoints[dailyPoints.length - 1];
  return { symbol: `FRED:${seriesId}`, price: last.close, dailyPoints };
}

async function fetchTreasuryGov10Y(startYear = 2005, endYear = 2026, minDate = '2005-10-01') {
  const years = [];
  for (let y = startYear; y <= endYear; y++) years.push(y);
  const byDate = new Map();

  for (let i = 0; i < years.length; i += 4) {
    const chunk = years.slice(i, i + 4);
    const resList = await Promise.allSettled(chunk.map(async (yr) => {
      const url = `https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/${yr}/all?type=daily_treasury_yield_curve&field_tdr_date_value=${yr}&page&_format=csv`;
      const { statusCode, body } = await requestHttpsRaw(url, 30000);
      if (statusCode >= 400 || !body) throw new Error(`HTTP ${statusCode} for ${yr}`);
      return body;
    }));

    for (const r of resList) {
      if (r.status !== 'fulfilled') continue;
      const lines = String(r.value).trim().split(/\r?\n/);
      if (lines.length < 2) continue;
      const colsHdr = lines[0].replace(/"/g, '').toLowerCase().split(',').map(s => s.trim());
      const dateIdx = colsHdr.findIndex(c => c === 'date');
      const y10Idx = colsHdr.findIndex(c => c === '10 yr' || c === '10 yr.');
      if (dateIdx === -1 || y10Idx === -1) continue;

      for (let li = 1; li < lines.length; li++) {
        const cols = lines[li].replace(/"/g, '').split(',');
        const rawD = (cols[dateIdx] || '').trim();
        let iso = rawD;
        const m = rawD.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
        if (m) iso = `${m[3]}-${m[1]}-${m[2]}`;
        const v = parseFloat((cols[y10Idx] || '').trim());
        if (/^\d{4}-\d{2}-\d{2}$/.test(iso) && iso >= minDate && !isNaN(v) && v > 0) {
          byDate.set(iso, { date: iso, close: v, high: v, low: v });
        }
      }
    }
  }

  const dailyPoints = Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
  if (dailyPoints.length < 4000) {
    throw new Error(`Treasury.gov 10Y insufficient rows (${dailyPoints.length})`);
  }
  return { symbol: 'USTreasury:10Y_ParYield', price: dailyPoints[dailyPoints.length - 1].close, dailyPoints };
}

let _frankfurterCache = null;

async function fetchFrankfurterFxAndDxy(minDate = '2005-10-01') {
  if (_frankfurterCache) return _frankfurterCache;
  const url = `https://api.frankfurter.app/${minDate}..?from=USD&to=INR,EUR,JPY,GBP,CAD,SEK,CHF`;
  const { statusCode, body } = await requestHttpsRaw(url, 35000);
  if (statusCode >= 400) throw new Error(`HTTP ${statusCode} from Frankfurter`);
  const json = JSON.parse(body);
  const rates = json?.rates || {};
  const dates = Object.keys(rates).sort();

  const inrPoints = [];
  const dxyPoints = [];
  for (const d of dates) {
    const r = rates[d];
    if (!r) continue;
    const inr = Number(r.INR);
    if (!isNaN(inr) && inr > 0) {
      inrPoints.push({ date: d, close: inr, high: inr, low: inr });
    }
    const { EUR, JPY, GBP, CAD, SEK, CHF } = r;
    if (EUR > 0 && JPY > 0 && GBP > 0 && CAD > 0 && SEK > 0 && CHF > 0) {
      // Exact ICE US Dollar Index geometric basket using USD-quoted reciprocal for EUR & GBP
      const dxy = +(
        50.14348112 *
        Math.pow(EUR, 0.576) *
        Math.pow(JPY, 0.136) *
        Math.pow(GBP, 0.119) *
        Math.pow(CAD, 0.091) *
        Math.pow(SEK, 0.042) *
        Math.pow(CHF, 0.036)
      ).toFixed(3);
      if (!isNaN(dxy) && dxy > 0) {
        dxyPoints.push({ date: d, close: dxy, high: dxy, low: dxy });
      }
    }
  }
  if (inrPoints.length < 2500 || dxyPoints.length < 2500) {
    throw new Error(`Frankfurter insufficient rows (INR=${inrPoints.length}, DXY=${dxyPoints.length})`);
  }
  _frankfurterCache = {
    usd_inr: { symbol: 'ECB:USD_INR', price: inrPoints[inrPoints.length - 1].close, dailyPoints: inrPoints },
    usd_index: { symbol: 'ECB:ICE_DXY_Formula', price: dxyPoints[dxyPoints.length - 1].close, dailyPoints: dxyPoints }
  };
  return _frankfurterCache;
}

function extractSymbolQuote(chartResult) {
  const meta = chartResult.meta || {};
  const timestamps = chartResult.timestamp || [];
  const quote = chartResult.indicators?.quote?.[0] || {};
  const closes = quote.close || [];
  const highs = quote.high || [];
  const lows = quote.low || [];

  // Build valid daily points keyed by YYYY-MM-DD
  const dailyPoints = [];
  for (let i = 0; i < timestamps.length; i++) {
    const c = closes[i];
    if (typeof c === 'number' && !isNaN(c) && c > 0) {
      const dateStr = new Date(timestamps[i] * 1000).toISOString().slice(0, 10);
      dailyPoints.push({
        date: dateStr,
        close: c,
        high: typeof highs[i] === 'number' ? highs[i] : c,
        low: typeof lows[i] === 'number' ? lows[i] : c
      });
    }
  }

  const lastPoint = dailyPoints[dailyPoints.length - 1];
  const prevPoint = dailyPoints.length >= 2 ? dailyPoints[dailyPoints.length - 2] : null;

  const price = typeof meta.regularMarketPrice === 'number' && meta.regularMarketPrice > 0
    ? meta.regularMarketPrice
    : (lastPoint ? lastPoint.close : 0);

  // If last bar already represents today's session close/current tick, compare vs prevPoint
  let prevClose = price;
  if (typeof meta.previousClose === 'number' && meta.previousClose > 0) {
    prevClose = meta.previousClose;
  } else if (prevPoint && lastPoint && Math.abs(price - lastPoint.close) / price < 0.015) {
    prevClose = prevPoint.close;
  } else if (lastPoint) {
    prevClose = lastPoint.close;
  }

  const change24h = +(price - prevClose).toFixed(4);
  const changePercent24h = prevClose > 0 ? +((change24h / prevClose) * 100).toFixed(2) : 0;

  const high24h = typeof meta.regularMarketDayHigh === 'number' && meta.regularMarketDayHigh > 0
    ? meta.regularMarketDayHigh
    : (lastPoint ? lastPoint.high : price);
  const low24h = typeof meta.regularMarketDayLow === 'number' && meta.regularMarketDayLow > 0
    ? meta.regularMarketDayLow
    : (lastPoint ? lastPoint.low : price);

  return {
    symbol: meta.symbol,
    price,
    prevClose,
    change24h,
    changePercent24h,
    high24h,
    low24h,
    marketTime: meta.regularMarketTime ? new Date(meta.regularMarketTime * 1000).toISOString() : null,
    dailyPoints
  };
}

async function fetchWithFallbackSymbols(symbolList, rangeOrOpts = '1mo', interval = '1d') {
  let lastErr = null;
  for (const sym of symbolList) {
    try {
      const raw = await fetchYahooChart(sym, rangeOrOpts, interval);
      return extractSymbolQuote(raw);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('All symbols failed');
}

function clampVal(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function computeRollingSma(values, endIdx, windowSize) {
  const start = Math.max(0, endIdx - windowSize + 1);
  let sum = 0;
  let count = 0;
  for (let i = start; i <= endIdx; i++) {
    const v = values[i];
    if (typeof v === 'number' && !isNaN(v) && v > 0) {
      sum += v;
      count++;
    }
  }
  return count > 0 ? sum / count : 0;
}

/**
 * Computes the Core >= 8/10 Macro Breakout Score (0-100) using rolling dynamic baselines.
 * Pillars: Spot Gold (9.5/10), US 10Y Yield (8.5/10), USD/INR (8.0/10), US Dollar Index (8.0/10).
 */
function computeCoreMacroScore({
  goldPrice = 0, goldSma20 = 0, goldSma50 = 0, goldChg1dPct = 0,
  yieldPrice = 0, yieldSma20 = 0, yieldSma50 = 0, yieldChg1dPct = 0,
  usdInrPrice = 0, usdInrSma20 = 0, usdInrSma50 = 0, usdInrChg1dPct = 0,
  dxyPrice = 0, dxySma20 = 0, dxySma50 = 0, dxyChg1dPct = 0
} = {}) {
  const goldDev20 = goldSma20 > 0 && goldPrice > 0 ? ((goldPrice - goldSma20) / goldSma20) * 100 : 0;
  const goldDev50 = goldSma50 > 0 && goldPrice > 0 ? ((goldPrice - goldSma50) / goldSma50) * 100 : goldDev20;
  const scoreSpotGold = clampVal(12.5 + (goldDev20 * 2.0) + (goldDev50 * 0.8) + ((goldChg1dPct || 0) * 2.0), 0, 25);

  const yieldDiff20 = yieldSma20 > 0 && yieldPrice > 0 ? (yieldPrice - yieldSma20) : 0;
  const yieldDiff50 = yieldSma50 > 0 && yieldPrice > 0 ? (yieldPrice - yieldSma50) : yieldDiff20;
  const scoreYield = clampVal(12.5 - (yieldDiff20 * 18.0) - (yieldDiff50 * 8.0) - ((yieldChg1dPct || 0) * 1.5), 0, 25);

  const inrDev20 = usdInrSma20 > 0 && usdInrPrice > 0 ? ((usdInrPrice - usdInrSma20) / usdInrSma20) * 100 : 0;
  const inrDev50 = usdInrSma50 > 0 && usdInrPrice > 0 ? ((usdInrPrice - usdInrSma50) / usdInrSma50) * 100 : inrDev20;
  const scoreUsdInr = clampVal(12.5 + (inrDev20 * 4.5) + (inrDev50 * 2.5) + ((usdInrChg1dPct || 0) * 3.0), 0, 25);

  const dxyDev20 = dxySma20 > 0 && dxyPrice > 0 ? ((dxyPrice - dxySma20) / dxySma20) * 100 : 0;
  const dxyDev50 = dxySma50 > 0 && dxyPrice > 0 ? ((dxyPrice - dxySma50) / dxySma50) * 100 : dxyDev20;
  const scoreDxy = clampVal(12.5 - (dxyDev20 * 3.5) - (dxyDev50 * 1.5) - ((dxyChg1dPct || 0) * 2.5), 0, 25);

  const totalWeight = CORE_FACTOR_WEIGHTS.gold + CORE_FACTOR_WEIGHTS.treasury_yield + CORE_FACTOR_WEIGHTS.usd_inr + CORE_FACTOR_WEIGHTS.usd_index;
  const weightedAvgPillar = (
    scoreSpotGold * CORE_FACTOR_WEIGHTS.gold +
    scoreYield * CORE_FACTOR_WEIGHTS.treasury_yield +
    scoreUsdInr * CORE_FACTOR_WEIGHTS.usd_inr +
    scoreDxy * CORE_FACTOR_WEIGHTS.usd_index
  ) / totalWeight;

  const totalScore = Math.round(weightedAvgPillar * 4);
  const macroBias = totalScore >= 60 ? 'TAILWIND' : totalScore <= 42 ? 'HEADWIND' : 'NEUTRAL';

  return {
    totalScore,
    macroBias,
    pillars: {
      spotGold: +scoreSpotGold.toFixed(1),
      realYield: +scoreYield.toFixed(1),
      usdInr: +scoreUsdInr.toFixed(1),
      usdIndex: +scoreDxy.toFixed(1)
    },
    deviations: {
      goldDev20Pct: +goldDev20.toFixed(2),
      yieldDiff20Bps: Math.round(yieldDiff20 * 100),
      usdInrDev20Pct: +inrDev20.toFixed(2),
      dxyDev20Pct: +dxyDev20.toFixed(2)
    }
  };
}

function buildNormalizedHistory(quotesMap) {
  const keys = ['gold', 'usd_inr', 'crude_oil', 'usd_index', 'treasury_yield', 'vix'];
  const dateSet = new Set();
  const byKeyDate = {};

  for (const k of keys) {
    byKeyDate[k] = new Map();
    const pts = quotesMap[k]?.dailyPoints || [];
    for (const p of pts) {
      dateSet.add(p.date);
      byKeyDate[k].set(p.date, p.close);
    }
  }

  const sortedDates = Array.from(dateSet).sort();
  if (sortedDates.length === 0) return null;

  // Forward-fill missing holidays per asset so series aligns cleanly
  const lastSeen = {};
  const filled = [];
  for (const d of sortedDates) {
    const row = { date: d };
    let ready = true;
    for (const k of keys) {
      const val = byKeyDate[k].get(d);
      if (val !== undefined) lastSeen[k] = val;
      if (lastSeen[k] === undefined) ready = false;
      row[k] = lastSeen[k];
    }
    if (ready) filled.push(row);
  }

  if (filled.length < 2) return null;

  const base = filled[0];
  return filled.map(row => {
    const goldPct = ((row.gold - base.gold) / base.gold) * 100;
    const inrPct = ((row.usd_inr - base.usd_inr) / base.usd_inr) * 100;
    const goldInrPct = ((row.gold * row.usd_inr - base.gold * base.usd_inr) / (base.gold * base.usd_inr)) * 100;
    const oilPct = ((row.crude_oil - base.crude_oil) / base.crude_oil) * 100;
    const usdPct = ((row.usd_index - base.usd_index) / base.usd_index) * 100;
    const yieldsPct = ((row.treasury_yield - base.treasury_yield) / base.treasury_yield) * 100;
    const vixPct = ((row.vix - base.vix) / base.vix) * 100;

    return {
      date: row.date,
      gold: +goldPct.toFixed(2),
      goldInr: +(goldInrPct || (goldPct + inrPct)).toFixed(2),
      oil: +oilPct.toFixed(2),
      usd: +usdPct.toFixed(2),
      yields: +yieldsPct.toFixed(2),
      vix: +vixPct.toFixed(2)
    };
  });
}

async function syncLiveMacro() {
  const entries = Object.entries(DEFAULT_SYMBOLS);
  const settled = await Promise.allSettled(
    entries.map(async ([key, syms]) => [key, await fetchWithFallbackSymbols(syms)])
  );

  const quotes = {};
  let successCount = 0;
  for (const r of settled) {
    if (r.status === 'fulfilled') {
      const [key, q] = r.value;
      quotes[key] = q;
      successCount++;
    }
  }

  if (successCount === 0) {
    throw new Error('Failed to fetch any Yahoo Finance macro feeds');
  }

  const breakevenInflation = 2.34;
  const cached = loadMacroCache();
  const prevMarket = cached?.market || {};
  const histCache = loadHistoricalMacro();
  const histBaselines = histCache?.latestBaselines || {};

  function resolveSma(key, fallbackPrice) {
    const pts = quotes[key]?.dailyPoints;
    const h = histBaselines[key];
    let sma20 = h?.sma20 || fallbackPrice;
    if (pts && pts.length >= 5) {
      const closes = pts.map(p => p.close);
      sma20 = +computeRollingSma(closes, closes.length - 1, 20).toFixed(4);
    }
    const sma50 = h?.sma50 || sma20;
    const devSma20Pct = sma20 > 0 ? +(((fallbackPrice - sma20) / sma20) * 100).toFixed(2) : 0;
    return { sma20, sma50, devSma20Pct };
  }

  const goldPrice = quotes.gold ? +quotes.gold.price.toFixed(2) : (prevMarket.gold?.price || 4038.00);
  const goldRoll = resolveSma('gold', goldPrice);
  const inrPrice = quotes.usd_inr ? +quotes.usd_inr.price.toFixed(2) : (prevMarket.usd_inr?.price || 93.74);
  const inrRoll = resolveSma('usd_inr', inrPrice);
  const dxyPrice = quotes.usd_index ? +quotes.usd_index.price.toFixed(2) : (prevMarket.usd_index?.price || 102.95);
  const dxyRoll = resolveSma('usd_index', dxyPrice);
  const tnxPrice = quotes.treasury_yield ? +quotes.treasury_yield.price.toFixed(3) : (prevMarket.treasury_yield?.price || 4.95);
  const tnxRoll = resolveSma('treasury_yield', tnxPrice);

  const market = {
    lastUpdated: new Date().toISOString(),
    source: 'Yahoo Finance Live Global Macro Feed',
    gold: {
      symbol: quotes.gold?.symbol || 'XAU/USD',
      name: 'Gold Spot / US Dollar',
      price: goldPrice,
      change24h: quotes.gold ? +quotes.gold.change24h.toFixed(2) : (prevMarket.gold?.change24h || 0),
      changePercent24h: quotes.gold ? quotes.gold.changePercent24h : (prevMarket.gold?.changePercent24h || 0),
      high24h: quotes.gold ? +quotes.gold.high24h.toFixed(2) : (prevMarket.gold?.high24h || 4060.00),
      low24h: quotes.gold ? +quotes.gold.low24h.toFixed(2) : (prevMarket.gold?.low24h || 4010.00),
      sma20: goldRoll.sma20,
      sma50: goldRoll.sma50,
      devSma20Pct: goldRoll.devSma20Pct,
      weightScore: CORE_FACTOR_WEIGHTS.gold,
      tier: 'CORE_8_PLUS',
      unit: 'USD / oz',
      correlation: 0.96,
      signal: goldRoll.devSma20Pct >= 0 ? 'BULLISH' : 'CONSOLIDATION',
      rationale: 'Primary global gold benchmark (9.5/10 weight); rolling 20-DMA/50-DMA momentum leads MCX & Chennai rates'
    },
    usd_inr: {
      symbol: 'USD/INR',
      name: 'USD to Indian Rupee',
      price: inrPrice,
      change24h: quotes.usd_inr ? +quotes.usd_inr.change24h.toFixed(2) : (prevMarket.usd_inr?.change24h || 0),
      changePercent24h: quotes.usd_inr ? quotes.usd_inr.changePercent24h : (prevMarket.usd_inr?.changePercent24h || 0),
      high24h: quotes.usd_inr ? +quotes.usd_inr.high24h.toFixed(2) : (prevMarket.usd_inr?.high24h || 93.90),
      low24h: quotes.usd_inr ? +quotes.usd_inr.low24h.toFixed(2) : (prevMarket.usd_inr?.low24h || 93.50),
      sma20: inrRoll.sma20,
      sma50: inrRoll.sma50,
      devSma20Pct: inrRoll.devSma20Pct,
      weightScore: CORE_FACTOR_WEIGHTS.usd_inr,
      tier: 'CORE_8_PLUS',
      unit: 'INR per USD',
      correlation: 0.88,
      impact: 'Rupee depreciation increases the landed cost of imported bullion in India (8.0/10 core factor)',
      signal: inrRoll.devSma20Pct >= 0 ? 'BULLISH_INR_GOLD' : 'NEUTRAL'
    },
    crude_oil: {
      symbol: 'CL=F (WTI)',
      name: 'Crude Oil WTI',
      price: quotes.crude_oil ? +quotes.crude_oil.price.toFixed(2) : (prevMarket.crude_oil?.price || 85.98),
      change24h: quotes.crude_oil ? +quotes.crude_oil.change24h.toFixed(2) : (prevMarket.crude_oil?.change24h || 0),
      changePercent24h: quotes.crude_oil ? quotes.crude_oil.changePercent24h : (prevMarket.crude_oil?.changePercent24h || 0),
      high24h: quotes.crude_oil ? +quotes.crude_oil.high24h.toFixed(2) : (prevMarket.crude_oil?.high24h || 87.00),
      low24h: quotes.crude_oil ? +quotes.crude_oil.low24h.toFixed(2) : (prevMarket.crude_oil?.low24h || 84.50),
      weightScore: SECONDARY_FACTOR_WEIGHTS.crude_oil,
      tier: 'SECONDARY',
      unit: 'USD / bbl',
      correlation: 0.55,
      inflationImpact: 'Secondary inflation context (5.5/10 — excluded from >= 8/10 core breakout & forecast weights)',
      signal: (quotes.crude_oil?.changePercent24h ?? 0) >= 0.5 ? 'BULLISH' : 'NEUTRAL'
    },
    usd_index: {
      symbol: 'DX-Y.NYB',
      name: 'U.S. Dollar Index (DXY)',
      price: dxyPrice,
      change24h: quotes.usd_index ? +quotes.usd_index.change24h.toFixed(2) : (prevMarket.usd_index?.change24h || 0),
      changePercent24h: quotes.usd_index ? quotes.usd_index.changePercent24h : (prevMarket.usd_index?.changePercent24h || 0),
      high24h: quotes.usd_index ? +quotes.usd_index.high24h.toFixed(2) : (prevMarket.usd_index?.high24h || 103.30),
      low24h: quotes.usd_index ? +quotes.usd_index.low24h.toFixed(2) : (prevMarket.usd_index?.low24h || 102.50),
      sma20: dxyRoll.sma20,
      sma50: dxyRoll.sma50,
      devSma20Pct: dxyRoll.devSma20Pct,
      weightScore: CORE_FACTOR_WEIGHTS.usd_index,
      tier: 'CORE_8_PLUS',
      unit: 'Points',
      correlation: -0.83,
      fxImpact: 'Dollar strength creates global FX resistance; softening USD vs 20-DMA expands gold purchasing power (8.0/10)',
      signal: dxyRoll.devSma20Pct <= 0 ? 'BULLISH' : 'BEARISH_HEADWIND'
    },
    treasury_yield: {
      symbol: '^TNX (10Y)',
      name: 'US 10-Year Treasury Yield',
      price: tnxPrice,
      change24h: quotes.treasury_yield ? +quotes.treasury_yield.change24h.toFixed(3) : (prevMarket.treasury_yield?.change24h || 0),
      changePercent24h: quotes.treasury_yield ? quotes.treasury_yield.changePercent24h : (prevMarket.treasury_yield?.changePercent24h || 0),
      realYield: +(tnxPrice - breakevenInflation).toFixed(2),
      breakevenInflation,
      sma20: tnxRoll.sma20,
      sma50: tnxRoll.sma50,
      devSma20Pct: tnxRoll.devSma20Pct,
      weightScore: CORE_FACTOR_WEIGHTS.treasury_yield,
      tier: 'CORE_8_PLUS',
      unit: '%',
      correlation: -0.79,
      opportunityCostImpact: 'Primary sovereign opportunity cost driver (8.5/10); falling yields vs 20-DMA fuel gold rallies',
      signal: tnxPrice <= tnxRoll.sma20 ? 'BULLISH' : 'HEADWIND'
    },
    vix: {
      symbol: '^VIX',
      name: 'CBOE Volatility Index',
      price: quotes.vix ? +quotes.vix.price.toFixed(2) : (prevMarket.vix?.price || 18.50),
      change24h: quotes.vix ? +quotes.vix.change24h.toFixed(2) : (prevMarket.vix?.change24h || 0),
      changePercent24h: quotes.vix ? quotes.vix.changePercent24h : (prevMarket.vix?.changePercent24h || 0),
      high24h: quotes.vix ? +quotes.vix.high24h.toFixed(2) : (prevMarket.vix?.high24h || 20.00),
      low24h: quotes.vix ? +quotes.vix.low24h.toFixed(2) : (prevMarket.vix?.low24h || 17.00),
      weightScore: SECONDARY_FACTOR_WEIGHTS.vix,
      tier: 'SECONDARY',
      unit: 'Index Points',
      correlation: 0.45,
      safeHavenImpact: 'Secondary safe-haven sentiment monitor (4.5/10 — excluded from >= 8/10 core predictive model)',
      signal: (quotes.vix?.price ?? 0) >= 18 ? 'BULLISH' : 'CALM'
    }
  };

  const historical = buildNormalizedHistory(quotes) || cached?.historical || null;

  const payload = {
    lastSyncedAt: new Date().toISOString(),
    successCount,
    market,
    historical
  };

  const dir = path.dirname(MACRO_CACHE_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(MACRO_CACHE_FILE, JSON.stringify(payload, null, 2), 'utf8');

  // Asynchronously persist to Lakebase Postgres (Neon)
  db.setKv('macro_live', payload).catch(err => {
    console.warn('[Neon Macro Live Sync Warning]:', err.message);
  });

  return payload;
}

let _histMacroCache = null;

function loadHistoricalMacro() {
  if (_histMacroCache) return _histMacroCache;
  try {
    if (fs.existsSync(MACRO_HISTORY_FILE)) {
      _histMacroCache = JSON.parse(fs.readFileSync(MACRO_HISTORY_FILE, 'utf8'));
      return _histMacroCache;
    }
  } catch (e) {}
  return null;
}

async function fetchHistoricalSeriesWithFallback(key, period1, period2, liveMarket = {}, yahooState = { blocked: false }) {
  const minDate = '2005-10-01';
  const errors = [];

  const attempt = async (label, fn) => {
    try {
      const res = await fn();
      const pts = (res?.dailyPoints || []).filter(p => p.date >= minDate && p.close > 0);
      const earliestDate = pts.length ? pts[0].date : '';
      const latestDate = pts.length ? pts[pts.length - 1].date : '';
      if (pts.length >= 4500 && earliestDate <= '2006-01-10' && latestDate >= '2026-01-01') {
        return { symbol: res.symbol || label, provider: label, dailyPoints: pts };
      }
      errors.push(`${label}: rows=${pts.length}, span=${earliestDate || 'none'}->${latestDate || 'none'}`);
    } catch (e) {
      if (e.statusCode === 429 || String(e.message).includes('429')) {
        yahooState.blocked = true;
      }
      errors.push(`${label}: ${e.message}`);
    }
    return null;
  };

  let result = null;
  if (!yahooState.blocked) {
    result = await attempt('Yahoo', () =>
      fetchWithFallbackSymbols(DEFAULT_SYMBOLS[key], { period1, period2, interval: '1d' })
    );
  }

  if (!result && key === 'gold') {
    result = await attempt('LBMA', () => fetchLbmaGoldDaily(minDate))
      || await attempt('Stitched:HF+Spot', () => fetchStitchedSpotGold2006To2026(minDate, liveMarket));
  } else if (!result && key === 'usd_inr') {
    result = await attempt('Frankfurter:ECB', async () => (await fetchFrankfurterFxAndDxy(minDate)).usd_inr)
      || await attempt('FRED:DEXINUS', () => fetchFredDaily('DEXINUS', minDate));
  } else if (!result && key === 'usd_index') {
    result = await attempt('Frankfurter:ICE_DXY', async () => (await fetchFrankfurterFxAndDxy(minDate)).usd_index);
    if (!result) {
      result = await attempt('FRED:DTWEXAFEGS', async () => {
        const fed = await fetchFredDaily('DTWEXAFEGS', minDate);
        const liveDxy = liveMarket?.usd_index?.price;
        const lastVal = fed.dailyPoints[fed.dailyPoints.length - 1]?.close;
        const scale = (liveDxy > 50 && lastVal > 50) ? (liveDxy / lastVal) : (103.0 / (lastVal || 115.0));
        return {
          symbol: 'FRED:DTWEXAFEGS(DXY-scaled)',
          dailyPoints: fed.dailyPoints.map(p => ({ ...p, close: +(p.close * scale).toFixed(2) }))
        };
      });
    }
  } else if (!result && key === 'treasury_yield') {
    result = await attempt('USTreasury:ParYield', () => fetchTreasuryGov10Y(2005, new Date().getFullYear(), minDate))
      || await attempt('FRED:DGS10', () => fetchFredDaily('DGS10', minDate));
  }

  if (!result) {
    throw new Error(`All providers failed for ${key}: ${errors.join(' | ')}`);
  }

  // Append latest live quote date from macro_live.json if the historical feed lags by 1-3 days
  const liveQuote = liveMarket?.[key];
  const liveDate = (liveMarket?.lastUpdated || '').slice(0, 10);
  if (liveQuote?.price > 0 && /^\d{4}-\d{2}-\d{2}$/.test(liveDate)) {
    const lastDate = result.dailyPoints[result.dailyPoints.length - 1]?.date || '';
    if (liveDate > lastDate) {
      result.dailyPoints.push({ date: liveDate, close: liveQuote.price, high: liveQuote.price, low: liveQuote.price });
    }
  }

  return result;
}

/**
 * Fetches full daily historical bars from 2005-10-01 (SMA warm-up before 2006-01-02)
 * through today for the 4 Core >= 8/10 Macro Drivers and persists to data/macro_history_2006_2026.json.
 */
async function syncHistoricalMacroSince2006() {
  const coreKeys = ['gold', 'usd_inr', 'usd_index', 'treasury_yield'];
  const period1 = Math.floor(new Date('2005-10-01T00:00:00Z').getTime() / 1000);
  const period2 = Math.floor(Date.now() / 1000) + 86400;
  const liveCache = loadMacroCache();
  const liveMarket = liveCache?.market || {};
  const yahooState = { blocked: false };

  const quotes = {};
  const coverage = {};
  for (let idx = 0; idx < coreKeys.length; idx++) {
    const key = coreKeys[idx];
    if (idx > 0) await new Promise(r => setTimeout(r, 300));
    const q = await fetchHistoricalSeriesWithFallback(key, period1, period2, liveMarket, yahooState);
    quotes[key] = q;
    const pts = q.dailyPoints || [];
    coverage[key] = {
      symbol: q.symbol || DEFAULT_SYMBOLS[key][0],
      provider: q.provider,
      weightScore: CORE_FACTOR_WEIGHTS[key],
      startDate: pts.length ? pts[0].date : null,
      endDate: pts.length ? pts[pts.length - 1].date : null,
      rawCount: pts.length
    };
    console.log(`Synced ${key}: ${q.provider} (${q.symbol}) ${coverage[key].startDate} -> ${coverage[key].endDate} [${pts.length} pts]`);
  }

  const dateSet = new Set();
  const byKeyDate = {};
  for (const k of coreKeys) {
    byKeyDate[k] = new Map();
    for (const p of (quotes[k].dailyPoints || [])) {
      if (p.date >= '2005-10-01') {
        dateSet.add(p.date);
        byKeyDate[k].set(p.date, p.close);
      }
    }
  }

  const sortedDates = Array.from(dateSet).sort();
  const lastSeen = {};
  const filled = [];
  for (const d of sortedDates) {
    const row = { date: d };
    let ready = true;
    for (const k of coreKeys) {
      const v = byKeyDate[k].get(d);
      if (typeof v === 'number' && !isNaN(v) && v > 0) {
        lastSeen[k] = v;
      }
      if (lastSeen[k] === undefined) ready = false;
      row[k] = lastSeen[k];
    }
    if (ready) filled.push(row);
  }

  if (filled.length < 60) {
    throw new Error(`Insufficient aligned historical macro bars: ${filled.length}`);
  }

  const arrGold = filled.map(r => r.gold);
  const arrYield = filled.map(r => r.treasury_yield);
  const arrInr = filled.map(r => r.usd_inr);
  const arrDxy = filled.map(r => r.usd_index);

  const dailySeries = [];
  for (let i = 0; i < filled.length; i++) {
    const r = filled[i];
    const prev = i > 0 ? filled[i - 1] : r;

    const goldSma20 = +computeRollingSma(arrGold, i, 20).toFixed(2);
    const goldSma50 = +computeRollingSma(arrGold, i, 50).toFixed(2);
    const yieldSma20 = +computeRollingSma(arrYield, i, 20).toFixed(3);
    const yieldSma50 = +computeRollingSma(arrYield, i, 50).toFixed(3);
    const usdInrSma20 = +computeRollingSma(arrInr, i, 20).toFixed(3);
    const usdInrSma50 = +computeRollingSma(arrInr, i, 50).toFixed(3);
    const dxySma20 = +computeRollingSma(arrDxy, i, 20).toFixed(2);
    const dxySma50 = +computeRollingSma(arrDxy, i, 50).toFixed(2);

    const goldChg1d = prev.gold > 0 ? +(((r.gold - prev.gold) / prev.gold) * 100).toFixed(2) : 0;
    const yieldChg1d = prev.treasury_yield > 0 ? +(((r.treasury_yield - prev.treasury_yield) / prev.treasury_yield) * 100).toFixed(2) : 0;
    const usdInrChg1d = prev.usd_inr > 0 ? +(((r.usd_inr - prev.usd_inr) / prev.usd_inr) * 100).toFixed(2) : 0;
    const dxyChg1d = prev.usd_index > 0 ? +(((r.usd_index - prev.usd_index) / prev.usd_index) * 100).toFixed(2) : 0;

    const core = computeCoreMacroScore({
      goldPrice: r.gold, goldSma20, goldSma50, goldChg1dPct: goldChg1d,
      yieldPrice: r.treasury_yield, yieldSma20, yieldSma50, yieldChg1dPct: yieldChg1d,
      usdInrPrice: r.usd_inr, usdInrSma20, usdInrSma50, usdInrChg1dPct: usdInrChg1d,
      dxyPrice: r.usd_index, dxySma20, dxySma50, dxyChg1dPct: dxyChg1d
    });

    const rawSpotInr22k = +(((r.gold * r.usd_inr) / 31.1034768) * (22 / 24)).toFixed(2);

    dailySeries.push({
      date: r.date,
      gold: +r.gold.toFixed(2),
      goldSma20,
      goldSma50,
      goldChg1d,
      usd_inr: +r.usd_inr.toFixed(3),
      usdInrSma20,
      usdInrSma50,
      usdInrChg1d,
      usd_index: +r.usd_index.toFixed(2),
      dxySma20,
      dxySma50,
      dxyChg1d,
      treasury_yield: +r.treasury_yield.toFixed(3),
      yieldSma20,
      yieldSma50,
      yieldChg1d,
      rawSpotInr22k,
      macroScore: core.totalScore,
      macroBias: core.macroBias,
      pillars: core.pillars
    });
  }

  const last = dailySeries[dailySeries.length - 1];
  const payload = {
    lastSyncedAt: new Date().toISOString(),
    coreDrivers: CORE_FACTOR_WEIGHTS,
    coverage,
    alignedStartDate: dailySeries[0].date,
    alignedEndDate: last.date,
    alignedCount: dailySeries.length,
    latestBaselines: {
      gold: { price: last.gold, sma20: last.goldSma20, sma50: last.goldSma50, chg1dPct: last.goldChg1d },
      usd_inr: { price: last.usd_inr, sma20: last.usdInrSma20, sma50: last.usdInrSma50, chg1dPct: last.usdInrChg1d },
      usd_index: { price: last.usd_index, sma20: last.dxySma20, sma50: last.dxySma50, chg1dPct: last.dxyChg1d },
      treasury_yield: { price: last.treasury_yield, sma20: last.yieldSma20, sma50: last.yieldSma50, chg1dPct: last.yieldChg1d }
    },
    dailySeries
  };

  const dir = path.dirname(MACRO_HISTORY_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(MACRO_HISTORY_FILE, JSON.stringify(payload), 'utf8');
  _histMacroCache = payload;

  return payload;
}

function loadMacroCache() {
  try {
    if (fs.existsSync(MACRO_CACHE_FILE)) {
      return JSON.parse(fs.readFileSync(MACRO_CACHE_FILE, 'utf8'));
    }
  } catch (e) {}
  return null;
}

module.exports = {
  CORE_FACTOR_WEIGHTS,
  SECONDARY_FACTOR_WEIGHTS,
  syncLiveMacro,
  loadMacroCache,
  syncHistoricalMacroSince2006,
  loadHistoricalMacro,
  computeCoreMacroScore
};
