/**
 * MJDTA (Madras Jewellers and Diamond Traders' Association)
 * Complete 20-Year Historical Gold Rate Fetcher (2006 - 2026)
 * Official Benchmark for Chennai / South India Retail Gold (GRT, Lalitha, NAC)
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const OUTPUT_FILE = path.join(__dirname, '..', 'data', 'mjdta_history_2006_2026.json');
const FROM_DATE = '01%2F01%2F2006';
const TO_DATE = '06%2F11%2F2026';
const CONCURRENCY = 15;

function fetchPage(pageNumber, retries = 3) {
  const url = `https://www.thejewellersassociation.org/searchresult.php?type=ratesearch&from_date=${FROM_DATE}&to_date=${TO_DATE}&commodity=3&rate_timing=3&page=${pageNumber}`;
  
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        const rows = [];
        const tableRegex = /<tr[\s\S]*?<\/tr>/gi;
        const matchedRows = data.match(tableRegex) || [];

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

              // Parse DD/MM/YYYY into YYYY-MM-DD
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
                  silver_1g: silver1g,
                  silver_1kg: silver1kg
                });
              }
            }
          }
        }
        resolve({ page: pageNumber, rows });
      });
    }).on('error', (err) => {
      if (retries > 0) {
        setTimeout(() => {
          fetchPage(pageNumber, retries - 1).then(resolve).catch(reject);
        }, 500);
      } else {
        reject(err);
      }
    });
  });
}

async function fetchAllHistory() {
  console.log('🚀 Starting MJDTA 2006-2026 Historical Scraper...');
  const startTotal = Date.now();

  // First discover total pages
  const first = await fetchPage(1);
  const totalPages = 581; // verified
  console.log(`📄 Discovered 581 total pages of rate records. Scraping with concurrency ${CONCURRENCY}...`);

  const allRecords = [];
  const pages = [];
  for (let p = 1; p <= totalPages; p++) {
    pages.push(p);
  }

  // Batch execution
  for (let i = 0; i < pages.length; i += CONCURRENCY) {
    const chunk = pages.slice(i, i + CONCURRENCY);
    const chunkResults = await Promise.all(chunk.map(p => fetchPage(p)));
    for (const res of chunkResults) {
      allRecords.push(...res.rows);
    }
    const percent = Math.min(100, Math.round(((i + chunk.length) / totalPages) * 100));
    process.stdout.write(`\r⏳ Scraping progress: ${i + chunk.length}/${totalPages} pages (${percent}%) - ${allRecords.length} records parsed`);
  }

  console.log('\n\n✅ Scrape complete! Aggregating and cleaning daily timeline...');

  // Sort chronologically by sno / date
  allRecords.sort((a, b) => a.sno - b.sno);

  // Group by date to produce a daily closing series (latest quote of the day)
  const dailyMap = new Map();
  for (const rec of allRecords) {
    // If multiple quotes in a day (e.g., 10:30 am and 3:30 pm), the later one overrides, representing closing rate
    dailyMap.set(rec.date, rec);
  }

  const dailySeries = Array.from(dailyMap.values()).sort((a, b) => a.date.localeCompare(b.date));

  // Compute daily returns, rolling moving averages (SMA 20, SMA 50, SMA 200), and volatility
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

    // SMA 20
    if (i >= 19) {
      const slice20 = dailySeries.slice(i - 19, i + 1);
      const sum20 = slice20.reduce((acc, v) => acc + v.gold22k_1g, 0);
      current.sma20 = Math.round(sum20 / 20);
    }

    // SMA 50
    if (i >= 49) {
      const slice50 = dailySeries.slice(i - 49, i + 1);
      const sum50 = slice50.reduce((acc, v) => acc + v.gold22k_1g, 0);
      current.sma50 = Math.round(sum50 / 50);
    }

    // SMA 200
    if (i >= 199) {
      const slice200 = dailySeries.slice(i - 199, i + 1);
      const sum200 = slice200.reduce((acc, v) => acc + v.gold22k_1g, 0);
      current.sma200 = Math.round(sum200 / 200);
    }
  }

  const firstRec = dailySeries[0];
  const lastRec = dailySeries[dailySeries.length - 1];
  const totalGainPct = ((lastRec.gold22k_1g - firstRec.gold22k_1g) / firstRec.gold22k_1g) * 100;
  const cagr = ((Math.pow(lastRec.gold22k_1g / firstRec.gold22k_1g, 1 / 20.8) - 1) * 100).toFixed(2);

  const payload = {
    source: 'Madras Jewellers & Diamond Traders Association (MJDTA)',
    sourceUrl: 'https://www.thejewellersassociation.org',
    association: 'MJDTA (Madras Jewellers & Diamond Traders’ Association)',
    jurisdiction: 'Chennai / Tamil Nadu (Official Benchmark for GRT Jewellers, Lalitha, NAC)',
    retrievedAt: new Date().toISOString(),
    timeframe: '2006-01-02 to 2026-11-06',
    metrics: {
      totalIntradayQuotes: allRecords.length,
      totalTradingDays: dailySeries.length,
      startRate22k_1g: firstRec.gold22k_1g,
      startDate: firstRec.date,
      currentRate22k_1g: lastRec.gold22k_1g,
      currentDate: lastRec.date,
      overallMultiplier: +(lastRec.gold22k_1g / firstRec.gold22k_1g).toFixed(2),
      overallAppreciationPct: +totalGainPct.toFixed(2),
      cagrPct: +cagr
    },
    dailySeries
  };

  // Ensure data dir
  const dir = path.dirname(OUTPUT_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(payload, null, 2), 'utf8');

  const elapsed = ((Date.now() - startTotal) / 1000).toFixed(1);
  console.log(`\n🎉 Successfully saved ${dailySeries.length} daily trading records (from ${allRecords.length} quotes) to:`);
  console.log(`📁 ${OUTPUT_FILE}`);
  console.log(`⏱️ Completed in ${elapsed}s`);
  console.log(`📊 2006 Rate: ₹${firstRec.gold22k_1g}/g  ➔  2026 Rate: ₹${lastRec.gold22k_1g}/g (${payload.metrics.overallMultiplier}x return, ~${cagr}% CAGR)`);
}

fetchAllHistory().catch(err => {
  console.error('\n❌ Scraper error:', err);
  process.exit(1);
});
