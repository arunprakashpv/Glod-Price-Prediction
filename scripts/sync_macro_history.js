const fs = require('fs');
const path = require('path');
const {
  syncHistoricalMacroSince2006,
  syncLiveMacro,
  loadMacroCache
} = require('../services/macro');

async function main() {
  console.log('Syncing Core >= 8/10 Historical Macro Series (2005-10-01 -> Now)...');
  const hist = await syncHistoricalMacroSince2006();
  console.log('Coverage:', JSON.stringify(hist.coverage, null, 2));
  console.log(`Aligned Daily Series: ${hist.alignedStartDate} -> ${hist.alignedEndDate} (${hist.alignedCount} trading days)`);
  console.log('Latest Baselines:', JSON.stringify(hist.latestBaselines, null, 2));

  const post2006 = hist.dailySeries.filter(d => d.date >= '2006-01-02');
  console.log('Post-2006 trading days:', post2006.length);
  console.log('First >= 2006-01-02 row:', JSON.stringify(post2006[0]));
  console.log('Latest row:', JSON.stringify(hist.dailySeries[hist.dailySeries.length - 1]));

  try {
    console.log('Refreshing macro_live.json with live feeds & SMA baselines...');
    const live = await syncLiveMacro();
    console.log(`Live synced (${live.successCount}/6 feeds) at ${live.lastSyncedAt}`);
  } catch (err) {
    console.warn('Live Yahoo sync skipped/rate-limited; updating macro_live.json baselines from historical series:', err.message);
    const livePath = path.join(__dirname, '..', 'data', 'macro_live.json');
    const cached = loadMacroCache();
    if (cached && cached.market) {
      for (const k of ['gold', 'usd_inr', 'usd_index', 'treasury_yield']) {
        if (cached.market[k] && hist.latestBaselines[k]) {
          const b = hist.latestBaselines[k];
          cached.market[k].sma20 = b.sma20;
          cached.market[k].sma50 = b.sma50;
          cached.market[k].devSma20Pct = b.sma20 > 0 ? +(((cached.market[k].price - b.sma20) / b.sma20) * 100).toFixed(2) : 0;
        }
      }
      fs.writeFileSync(livePath, JSON.stringify(cached, null, 2), 'utf8');
      console.log('Updated macro_live.json rolling SMA baselines successfully.');
    }
  }
}

main().catch(err => {
  console.error('Sync failed:', err);
  process.exit(1);
});
