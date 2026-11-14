/**
 * One-shot synchronization & diagnostic runner for AURUM MATRIX
 * 1. Backfills all missed MJDTA historical dates up to today (IST)
 * 2. Syncs live global macro feeds (Yahoo Finance)
 * 3. Syncs live Indian organisation rates (GRT, MJDTA, IBJA, JAB)
 * 4. Runs quantitative backtest + current date technical analysis
 */

const historySync = require('../services/history_sync');
const macroService = require('../services/macro');
const orgService = require('../services/organisations');
const backtestService = require('../services/backtest_engine');

async function main() {
  console.log('=== AURUM MATRIX LIVE SYNC AS ON DATE ===');
  console.log('Timestamp:', new Date().toISOString());

  const [histRes, macroRes, orgRes] = await Promise.allSettled([
    historySync.syncMissedDates(),
    macroService.syncLiveMacro(),
    orgService.syncTop3Organisations()
  ]);

  console.log('\n--- 1. MJDTA MISSED DATES SYNC ---');
  if (histRes.status === 'fulfilled') {
    console.log(JSON.stringify(histRes.value, null, 2));
  } else {
    console.error('History Sync Error:', histRes.reason?.message || histRes.reason);
  }

  console.log('\n--- 2. GLOBAL MACRO LIVE SYNC ---');
  if (macroRes.status === 'fulfilled') {
    console.log('Synced feeds:', macroRes.value.successCount);
    console.log('Spot Gold:', macroRes.value.market.gold);
    console.log('USD/INR:', macroRes.value.market.usd_inr);
    console.log('WTI Crude:', macroRes.value.market.crude_oil);
    console.log('DXY:', macroRes.value.market.usd_index);
    console.log('US 10Y:', macroRes.value.market.treasury_yield);
    console.log('VIX:', macroRes.value.market.vix);
    console.log('Historical points:', macroRes.value.historical?.length || 0);
  } else {
    console.error('Macro Sync Error:', macroRes.reason?.message || macroRes.reason);
  }

  console.log('\n--- 3. INDIAN BULLION ASSOCIATIONS & GRT ---');
  if (orgRes.status === 'fulfilled') {
    orgRes.value.organisations.forEach(o => {
      console.log(`${o.acronym} | 22K: ₹${o.rate22k_1g}/g | Sov: ₹${o.rate22k_8g} | 24K: ₹${o.rate24k_1g}/g | Silver: ₹${o.rateSilver_1g}/g | Time: ${o.timeRecorded}`);
    });
    console.log('Comparison:', orgRes.value.comparison.explanation);
  } else {
    console.error('Org Sync Error:', orgRes.reason?.message || orgRes.reason);
  }

  console.log('\n--- 4. QUANTITATIVE BACKTEST & CURRENT TECHNICAL ANALYSIS ---');
  backtestService.invalidateCache();
  const bt = backtestService.getBacktestResults();
  console.log('Summary:', JSON.stringify(bt.summary, null, 2));
  console.log('Current Market Setup:', JSON.stringify(bt.currentMarketSetup, null, 2));
  console.log('2026 Breakdown:', JSON.stringify(bt.yearlyBreakdown.find(y => y.year === 2026), null, 2));
}

main().catch(err => {
  console.error('Fatal Sync Error:', err);
  process.exit(1);
});
