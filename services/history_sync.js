/**
 * Incremental MJDTA Historical Rate Synchronizer
 * Reads data/mjdta_history_2006_2026.json, identifies the last stored date,
 * fetches all missed trading dates up to today (IST) from thejewellersassociation.org,
 * deduplicates intraday quotes (keeping latest close per date), recomputes indicators & SMAs,
 * and persists the updated dataset locally.
 */

const https = require('https');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const db = require('./db');

const HISTORY_FILE = path.join(__dirname, '..', 'data', 'mjdta_history_2006_2026.json');

function requestViaCurl(url, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    execFile('curl', ['-sSL', '--compressed', '--max-time', String(Math.ceil(timeoutMs / 1000)), '-A', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', url], (err, stdout) => {
      if (err) return reject(err);
      resolve(stdout);
    });
  });
}

function parseMjdtaHtmlRows(html) {
  const rows = [];
  const tableRegex = /<tr[\s\S]*?<\/tr>/gi;
  const matchedRows = html.match(tableRegex) || [];

  for (const r of matchedRows) {
    const cells = [];
    const cellRegex = /<td[\s\S]*?>([\s\S]*?)<\/td>/gi;
    let m;
    while ((m = cellRegex.exec(r)) !== null) {
      cells.push(m[1].replace(/<[^>]+>/g, '').trim());
    }
    if (cells.length >= 6) {
      const sno = parseInt(cells[0], 10);
      if (!isNaN(sno)) {
        const dateRaw = cells[1];
        const gold1g = parseFloat(cells[2].replace(/,/g, ''));
        const gold10g = parseFloat(cells[3].replace(/,/g, ''));
        const silver1g = parseFloat(cells[4].replace(/,/g, ''));
        const silver1kg = parseFloat(cells[5].replace(/,/g, ''));

        const dateParts = dateRaw.split(' ')[0].split('/');
        let isoDate = null;
        if (dateParts.length === 3) {
          const day = dateParts[0].padStart(2, '0');
          const month = dateParts[1].padStart(2, '0');
          const year = dateParts[2];
          isoDate = `${year}-${month}-${day}`;
        }

        if (gold1g && gold1g > 0 && isoDate) {
          rows.push({
            sno,
            dateRaw,
            date: isoDate,
            gold22k_1g: gold1g,
            gold22k_8g: Math.round(gold1g * 8),
            gold22k_10g: gold10g || (gold1g * 10),
            gold24k_1g: Math.round(gold1g * (24 / 22)),
            silver_1g: isNaN(silver1g) ? 0 : silver1g,
            silver_1kg: isNaN(silver1kg) ? 0 : silver1kg
          });
        }
      }
    }
  }
  return rows;
}

function getIstTodayParts(date = new Date()) {
  const istMs = date.getTime() + 5.5 * 60 * 60 * 1000;
  const d = new Date(istMs);
  return {
    yyyy: d.getUTCFullYear(),
    mm: String(d.getUTCMonth() + 1).padStart(2, '0'),
    dd: String(d.getUTCDate()).padStart(2, '0'),
    iso: d.toISOString().slice(0, 10)
  };
}

function formatDdMmYyyyUrl(isoDate) {
  const [yyyy, mm, dd] = isoDate.split('-');
  return `${dd}%2F${mm}%2F${yyyy}`;
}

function shiftIsoDate(isoDate, deltaDays) {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + deltaDays));
  return dt.toISOString().slice(0, 10);
}

/**
 * Parses MJDTA raw timestamp e.g. "06/11/2026 10:32 am" into epoch ms for reliable intraday ordering
 */
function parseMjdtaTimestamp(dateRaw) {
  if (!dateRaw) return 0;
  const match = String(dateRaw).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})\s*(am|pm)?)?/i);
  if (!match) return 0;
  const day = parseInt(match[1], 10);
  const month = parseInt(match[2], 10) - 1;
  const year = parseInt(match[3], 10);
  let hour = match[4] ? parseInt(match[4], 10) : 15;
  const minute = match[5] ? parseInt(match[5], 10) : 30;
  const ampm = match[6] ? match[6].toLowerCase() : null;
  if (ampm === 'pm' && hour < 12) hour += 12;
  if (ampm === 'am' && hour === 12) hour = 0;
  return Date.UTC(year, month, day, hour, minute);
}

function fetchMjdtaPage(fromUrlEncoded, toUrlEncoded, pageNumber = 1, retries = 2) {
  const url = `https://www.thejewellersassociation.org/searchresult.php?type=ratesearch&from_date=${fromUrlEncoded}&to_date=${toUrlEncoded}&commodity=3&rate_timing=3&page=${pageNumber}`;

  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 12000 }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        resolve(parseMjdtaHtmlRows(data));
      });
    });

    req.on('timeout', () => {
      req.destroy(new Error('MJDTA request timed out'));
    });

    req.on('error', async (err) => {
      try {
        const curlHtml = await requestViaCurl(url, 15000);
        if (curlHtml && (curlHtml.includes('<table') || curlHtml.includes('<tr'))) {
          return resolve(parseMjdtaHtmlRows(curlHtml));
        }
      } catch (cErr) {
        // Fall back to retry loop
      }

      if (retries > 0) {
        setTimeout(() => {
          fetchMjdtaPage(fromUrlEncoded, toUrlEncoded, pageNumber, retries - 1).then(resolve).catch(reject);
        }, 400);
      } else {
        reject(err);
      }
    });
  });
}

async function fetchRangeAllPages(fromIso, toIso) {
  const fromStr = formatDdMmYyyyUrl(fromIso);
  const toStr = formatDdMmYyyyUrl(toIso);
  const collected = [];
  const seenKeys = new Set();

  for (let page = 1; page <= 25; page++) {
    const rows = await fetchMjdtaPage(fromStr, toStr, page);
    if (!rows || rows.length === 0) break;

    let newOnPage = 0;
    for (const row of rows) {
      const key = `${row.dateRaw}|${row.gold22k_1g}|${row.sno}`;
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        collected.push(row);
        newOnPage++;
      }
    }
    if (newOnPage === 0 || rows.length < 15) break;
  }

  return collected;
}

function recalculateSeriesMetrics(dailySeries) {
  for (let i = 0; i < dailySeries.length; i++) {
    const current = dailySeries[i];
    if (i > 0) {
      const prev = dailySeries[i - 1];
      current.change = +(current.gold22k_1g - prev.gold22k_1g).toFixed(2);
      current.pctChange = +((current.change / prev.gold22k_1g) * 100).toFixed(2);
    } else {
      current.change = 0;
      current.pctChange = 0;
    }

    if (i >= 19) {
      let sum20 = 0;
      for (let k = i - 19; k <= i; k++) sum20 += dailySeries[k].gold22k_1g;
      current.sma20 = Math.round(sum20 / 20);
    }

    if (i >= 49) {
      let sum50 = 0;
      for (let k = i - 49; k <= i; k++) sum50 += dailySeries[k].gold22k_1g;
      current.sma50 = Math.round(sum50 / 50);
    }

    if (i >= 199) {
      let sum200 = 0;
      for (let k = i - 199; k <= i; k++) sum200 += dailySeries[k].gold22k_1g;
      current.sma200 = Math.round(sum200 / 200);
    }
  }
}

async function syncMissedDates() {
  if (!fs.existsSync(HISTORY_FILE)) {
    throw new Error('Historical dataset mjdta_history_2006_2026.json not found');
  }

  const raw = fs.readFileSync(HISTORY_FILE, 'utf8');
  const dataset = JSON.parse(raw);
  const existingSeries = Array.isArray(dataset.dailySeries) ? dataset.dailySeries : [];

  const todayIst = getIstTodayParts();
  const previousLastDate = existingSeries.length > 0 ? existingSeries[existingSeries.length - 1].date : '2026-11-01';
  const fromIso = shiftIsoDate(previousLastDate, -2);
  const toIso = todayIst.iso;

  const fetchedRows = await fetchRangeAllPages(fromIso, toIso);

  // Merge by date, choosing latest intraday timestamp
  const dailyMap = new Map();
  for (const rec of existingSeries) {
    dailyMap.set(rec.date, rec);
  }

  // Sort newly fetched quotes by parsed timestamp then sno so closing quote overrides morning quote
  fetchedRows.sort((a, b) => {
    const ta = parseMjdtaTimestamp(a.dateRaw);
    const tb = parseMjdtaTimestamp(b.dateRaw);
    if (ta !== tb) return ta - tb;
    return a.sno - b.sno;
  });

  const existingDatesBefore = new Set(existingSeries.map(r => r.date));
  const addedDates = [];
  const updatedDates = [];

  for (const rec of fetchedRows) {
    const prev = dailyMap.get(rec.date);
    if (!prev) {
      dailyMap.set(rec.date, rec);
      if (!existingDatesBefore.has(rec.date) && !addedDates.includes(rec.date)) {
        addedDates.push(rec.date);
      }
    } else {
      const prevTs = parseMjdtaTimestamp(prev.dateRaw);
      const newTs = parseMjdtaTimestamp(rec.dateRaw);
      if (newTs >= prevTs) {
        const changedPrice = prev.gold22k_1g !== rec.gold22k_1g || prev.dateRaw !== rec.dateRaw;
        dailyMap.set(rec.date, rec);
        if (changedPrice && existingDatesBefore.has(rec.date) && !updatedDates.includes(rec.date)) {
          updatedDates.push(rec.date);
        }
      }
    }
  }

  const mergedSeries = Array.from(dailyMap.values()).sort((a, b) => a.date.localeCompare(b.date));
  recalculateSeriesMetrics(mergedSeries);

  const firstRec = mergedSeries[0];
  const lastRec = mergedSeries[mergedSeries.length - 1];
  const yearsSpan = Math.max(1, (new Date(lastRec.date) - new Date(firstRec.date)) / (365.25 * 24 * 60 * 60 * 1000));
  const totalGainPct = ((lastRec.gold22k_1g - firstRec.gold22k_1g) / firstRec.gold22k_1g) * 100;
  const cagr = (Math.pow(lastRec.gold22k_1g / firstRec.gold22k_1g, 1 / yearsSpan) - 1) * 100;

  const updatedPayload = {
    source: dataset.source || 'Madras Jewellers & Diamond Traders Association (MJDTA)',
    sourceUrl: dataset.sourceUrl || 'https://www.thejewellersassociation.org',
    association: dataset.association || 'MJDTA (Madras Jewellers & Diamond Traders’ Association)',
    jurisdiction: dataset.jurisdiction || 'Chennai / Tamil Nadu (Official Benchmark for GRT Jewellers, Lalitha, NAC)',
    retrievedAt: new Date().toISOString(),
    timeframe: `${firstRec.date} to ${lastRec.date}`,
    metrics: {
      totalIntradayQuotes: (dataset.metrics?.totalIntradayQuotes || existingSeries.length) + addedDates.length,
      totalTradingDays: mergedSeries.length,
      startRate22k_1g: firstRec.gold22k_1g,
      startDate: firstRec.date,
      currentRate22k_1g: lastRec.gold22k_1g,
      currentDate: lastRec.date,
      overallMultiplier: +(lastRec.gold22k_1g / firstRec.gold22k_1g).toFixed(2),
      overallAppreciationPct: +totalGainPct.toFixed(2),
      cagrPct: +cagr.toFixed(2)
    },
    dailySeries: mergedSeries
  };

  fs.writeFileSync(HISTORY_FILE, JSON.stringify(updatedPayload, null, 2), 'utf8');

  // Asynchronously persist new/updated rows to Lakebase Postgres (Neon)
  if (addedDates.length > 0 || updatedDates.length > 0) {
    const affectedCount = addedDates.length + updatedDates.length;
    const rowsToPersist = mergedSeries.slice(-affectedCount);
    db.saveMjdtaRows(rowsToPersist).catch(err => {
      console.warn('[Neon MJDTA Sync Warning]:', err.message);
    });
  }

  return {
    updated: addedDates.length > 0 || updatedDates.length > 0,
    previousLastDate,
    newLastDate: lastRec.date,
    fetchedRowsCount: fetchedRows.length,
    addedDates: addedDates.sort(),
    updatedDates: updatedDates.sort(),
    totalTradingDays: mergedSeries.length,
    latestRecord: lastRec,
    recentTail: mergedSeries.slice(-10)
  };
}

module.exports = {
  syncMissedDates,
  fetchRangeAllPages,
  parseMjdtaTimestamp,
  getIstTodayParts
};
