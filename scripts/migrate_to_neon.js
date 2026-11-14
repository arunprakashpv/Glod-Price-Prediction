/**
 * Migration Script: Migrate local file DB to Lakebase Postgres (Neon)
 * Ultra-fast batch multi-row inserts
 */
require('dotenv').config({ path: '.env.local' });
const fs = require('fs');
const path = require('path');
const { neon } = require('@neondatabase/serverless');

const connectionString = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!connectionString) {
  console.error('ERROR: DATABASE_URL not found in .env.local');
  process.exit(1);
}

const sql = neon(connectionString);

async function runMigration() {
  console.log('🚀 Starting Lakebase Postgres (Neon) Migration...');

  // 1. Create Tables
  console.log('📦 Step 1: Ensuring Postgres tables exist...');

  await sql`
    CREATE TABLE IF NOT EXISTS mjdta_history (
      date DATE PRIMARY KEY,
      sno INT,
      date_raw VARCHAR(64),
      gold22k_1g NUMERIC(10,2),
      gold22k_8g NUMERIC(10,2),
      gold22k_10g NUMERIC(10,2),
      gold24k_1g NUMERIC(10,2),
      silver_1g NUMERIC(10,2),
      silver_1kg NUMERIC(10,2),
      change NUMERIC(10,2),
      pct_change NUMERIC(6,2),
      sma20 NUMERIC(10,2),
      sma50 NUMERIC(10,2),
      sma200 NUMERIC(10,2),
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS macro_history (
      date DATE PRIMARY KEY,
      gold NUMERIC(10,2),
      gold_sma20 NUMERIC(10,2),
      gold_sma50 NUMERIC(10,2),
      gold_chg1d NUMERIC(6,2),
      usd_inr NUMERIC(10,3),
      usd_inr_sma20 NUMERIC(10,3),
      usd_inr_sma50 NUMERIC(10,3),
      usd_inr_chg1d NUMERIC(6,2),
      usd_index NUMERIC(10,2),
      dxy_sma20 NUMERIC(10,2),
      dxy_sma50 NUMERIC(10,2),
      dxy_chg1d NUMERIC(6,2),
      treasury_yield NUMERIC(10,3),
      yield_sma20 NUMERIC(10,3),
      yield_sma50 NUMERIC(10,3),
      yield_chg1d NUMERIC(6,2),
      raw_spot_inr22k NUMERIC(10,2),
      macro_score INT,
      macro_bias VARCHAR(32),
      pillars JSONB,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS organisations (
      id VARCHAR(32) PRIMARY KEY,
      name TEXT NOT NULL,
      acronym VARCHAR(16),
      jurisdiction TEXT,
      official_url TEXT,
      retailers_followed JSONB,
      importance TEXT,
      rate22k_1g NUMERIC(10,2),
      rate22k_8g NUMERIC(10,2),
      rate22k_10g NUMERIC(10,2),
      rate24k_1g NUMERIC(10,2),
      rate24k_10g NUMERIC(10,2),
      rate18k_1g NUMERIC(10,2),
      rate18k_10g NUMERIC(10,2),
      rate_silver_1g NUMERIC(10,2),
      rate_silver_1kg NUMERIC(10,2),
      spread_vs_benchmark NUMERIC(10,2),
      spread_vs_mjdta NUMERIC(10,2),
      time_recorded VARCHAR(64),
      status VARCHAR(32),
      official_base_10g NUMERIC(10,2),
      gst_rate22k_1g NUMERIC(10,2),
      gst_rate24k_1g NUMERIC(10,2),
      session_name VARCHAR(32),
      session_date VARCHAR(32),
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS app_kv_store (
      key VARCHAR(64) PRIMARY KEY,
      value JSONB NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
  `;

  console.log('✅ Tables ready.');

  // 2. Migrate MJDTA History (Batch Multi-row)
  const mjdtaPath = path.join(__dirname, '..', 'data', 'mjdta_history_2006_2026.json');
  if (fs.existsSync(mjdtaPath)) {
    const rawData = JSON.parse(fs.readFileSync(mjdtaPath, 'utf8'));
    const series = rawData.dailySeries || [];
    console.log(`📊 Step 2: Batch migrating MJDTA History (${series.length} records)...`);

    const meta = {
      source: rawData.source,
      sourceUrl: rawData.sourceUrl,
      association: rawData.association,
      jurisdiction: rawData.jurisdiction,
      retrievedAt: rawData.retrievedAt,
      timeframe: rawData.timeframe,
      metrics: rawData.metrics
    };
    await sql`
      INSERT INTO app_kv_store (key, value, updated_at)
      VALUES ('mjdta_meta', ${JSON.stringify(meta)}, CURRENT_TIMESTAMP)
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP;
    `;

    const CHUNK_SIZE = 500;
    for (let i = 0; i < series.length; i += CHUNK_SIZE) {
      const chunk = series.slice(i, i + CHUNK_SIZE);
      const rowsSql = chunk.map(r => `(
        '${r.date}',
        ${r.sno || 'NULL'},
        ${r.dateRaw ? `'${r.dateRaw.replace(/'/g, "''")}'` : 'NULL'},
        ${r.gold22k_1g || 'NULL'},
        ${r.gold22k_8g || 'NULL'},
        ${r.gold22k_10g || 'NULL'},
        ${r.gold24k_1g || 'NULL'},
        ${r.silver_1g || 'NULL'},
        ${r.silver_1kg || 'NULL'},
        ${r.change || 0},
        ${r.pctChange || 0},
        ${r.sma20 || 'NULL'},
        ${r.sma50 || 'NULL'},
        ${r.sma200 || 'NULL'}
      )`).join(',\n');

      const query = `
        INSERT INTO mjdta_history (
          date, sno, date_raw, gold22k_1g, gold22k_8g, gold22k_10g,
          gold24k_1g, silver_1g, silver_1kg, change, pct_change,
          sma20, sma50, sma200
        ) VALUES ${rowsSql}
        ON CONFLICT (date) DO UPDATE SET
          gold22k_1g = EXCLUDED.gold22k_1g,
          gold22k_8g = EXCLUDED.gold22k_8g,
          gold22k_10g = EXCLUDED.gold22k_10g,
          gold24k_1g = EXCLUDED.gold24k_1g,
          silver_1g = EXCLUDED.silver_1g,
          silver_1kg = EXCLUDED.silver_1kg,
          change = EXCLUDED.change,
          pct_change = EXCLUDED.pct_change,
          sma20 = EXCLUDED.sma20,
          sma50 = EXCLUDED.sma50,
          sma200 = EXCLUDED.sma200;
      `;
      await sql.query(query);
      process.stdout.write(`\r   -> Migrated MJDTA: ${Math.min(i + CHUNK_SIZE, series.length)} / ${series.length}`);
    }
    console.log('\n✅ MJDTA records migrated.');
  }

  // 3. Migrate Macro History (Batch Multi-row)
  const macroPath = path.join(__dirname, '..', 'data', 'macro_history_2006_2026.json');
  if (fs.existsSync(macroPath)) {
    const rawData = JSON.parse(fs.readFileSync(macroPath, 'utf8'));
    const series = rawData.dailySeries || [];
    console.log(`📈 Step 3: Batch migrating Macro History (${series.length} records)...`);

    const meta = {
      lastSyncedAt: rawData.lastSyncedAt,
      coreDrivers: rawData.coreDrivers,
      coverage: rawData.coverage,
      alignedStartDate: rawData.alignedStartDate,
      alignedEndDate: rawData.alignedEndDate,
      alignedCount: rawData.alignedCount,
      latestBaselines: rawData.latestBaselines
    };
    await sql`
      INSERT INTO app_kv_store (key, value, updated_at)
      VALUES ('macro_meta', ${JSON.stringify(meta)}, CURRENT_TIMESTAMP)
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP;
    `;

    const CHUNK_SIZE = 500;
    for (let i = 0; i < series.length; i += CHUNK_SIZE) {
      const chunk = series.slice(i, i + CHUNK_SIZE);
      const rowsSql = chunk.map(r => `(
        '${r.date}',
        ${r.gold || 'NULL'},
        ${r.goldSma20 || 'NULL'},
        ${r.goldSma50 || 'NULL'},
        ${r.goldChg1d || 0},
        ${r.usd_inr || 'NULL'},
        ${r.usdInrSma20 || 'NULL'},
        ${r.usdInrSma50 || 'NULL'},
        ${r.usdInrChg1d || 0},
        ${r.usd_index || 'NULL'},
        ${r.dxySma20 || 'NULL'},
        ${r.dxySma50 || 'NULL'},
        ${r.dxyChg1d || 0},
        ${r.treasury_yield || 'NULL'},
        ${r.yieldSma20 || 'NULL'},
        ${r.yieldSma50 || 'NULL'},
        ${r.yieldChg1d || 0},
        ${r.rawSpotInr22k || 'NULL'},
        ${r.macroScore || 0},
        ${r.macroBias ? `'${r.macroBias}'` : 'NULL'},
        ${r.pillars ? `'${JSON.stringify(r.pillars).replace(/'/g, "''")}'::jsonb` : 'NULL'}
      )`).join(',\n');

      const query = `
        INSERT INTO macro_history (
          date, gold, gold_sma20, gold_sma50, gold_chg1d,
          usd_inr, usd_inr_sma20, usd_inr_sma50, usd_inr_chg1d,
          usd_index, dxy_sma20, dxy_sma50, dxy_chg1d,
          treasury_yield, yield_sma20, yield_sma50, yield_chg1d,
          raw_spot_inr22k, macro_score, macro_bias, pillars
        ) VALUES ${rowsSql}
        ON CONFLICT (date) DO UPDATE SET
          gold = EXCLUDED.gold,
          gold_sma20 = EXCLUDED.gold_sma20,
          gold_sma50 = EXCLUDED.gold_sma50,
          gold_chg1d = EXCLUDED.gold_chg1d,
          usd_inr = EXCLUDED.usd_inr,
          usd_inr_sma20 = EXCLUDED.usd_inr_sma20,
          usd_inr_sma50 = EXCLUDED.usd_inr_sma50,
          usd_inr_chg1d = EXCLUDED.usd_inr_chg1d,
          usd_index = EXCLUDED.usd_index,
          dxy_sma20 = EXCLUDED.dxy_sma20,
          dxy_sma50 = EXCLUDED.dxy_sma50,
          dxy_chg1d = EXCLUDED.dxy_chg1d,
          treasury_yield = EXCLUDED.treasury_yield,
          yield_sma20 = EXCLUDED.yield_sma20,
          yield_sma50 = EXCLUDED.yield_sma50,
          yield_chg1d = EXCLUDED.yield_chg1d,
          raw_spot_inr22k = EXCLUDED.raw_spot_inr22k,
          macro_score = EXCLUDED.macro_score,
          macro_bias = EXCLUDED.macro_bias,
          pillars = EXCLUDED.pillars;
      `;
      await sql.query(query);
      process.stdout.write(`\r   -> Migrated Macro: ${Math.min(i + CHUNK_SIZE, series.length)} / ${series.length}`);
    }
    console.log('\n✅ Macro records migrated.');
  }

  // 4. Migrate Organisations Cache
  const orgPath = path.join(__dirname, '..', 'data', 'organisations_cache.json');
  if (fs.existsSync(orgPath)) {
    const orgData = JSON.parse(fs.readFileSync(orgPath, 'utf8'));
    console.log(`🏢 Step 4: Migrating Organisations Cache (${orgData.organisations.length} orgs)...`);

    await sql`
      INSERT INTO app_kv_store (key, value, updated_at)
      VALUES (
        'organisations_meta',
        ${JSON.stringify({
          lastUpdated: orgData.lastUpdated,
          activeBenchmarkId: orgData.activeBenchmarkId,
          comparison: orgData.comparison
        })},
        CURRENT_TIMESTAMP
      )
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP;
    `;

    for (const org of orgData.organisations) {
      await sql`
        INSERT INTO organisations (
          id, name, acronym, jurisdiction, official_url, retailers_followed, importance,
          rate22k_1g, rate22k_8g, rate22k_10g, rate24k_1g, rate24k_10g,
          rate18k_1g, rate18k_10g, rate_silver_1g, rate_silver_1kg,
          spread_vs_benchmark, spread_vs_mjdta, time_recorded, status,
          official_base_10g, gst_rate22k_1g, gst_rate24k_1g, session_name, session_date
        ) VALUES (
          ${org.id}, ${org.name}, ${org.acronym || null}, ${org.jurisdiction || null},
          ${org.officialUrl || null}, ${JSON.stringify(org.retailersFollowed || [])}, ${org.importance || null},
          ${org.rate22k_1g || null}, ${org.rate22k_8g || null}, ${org.rate22k_10g || null},
          ${org.rate24k_1g || null}, ${org.rate24k_10g || null},
          ${org.rate18k_1g || null}, ${org.rate18k_10g || null},
          ${org.rateSilver_1g || null}, ${org.rateSilver_1kg || null},
          ${org.spreadVsBenchmark || 0}, ${org.spreadVsMjdta || 0},
          ${org.timeRecorded || null}, ${org.status || null},
          ${org.officialBase10g || null}, ${org.gstRate22k_1g || null},
          ${org.gstRate24k_1g || null}, ${org.sessionName || null}, ${org.sessionDate || null}
        )
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          acronym = EXCLUDED.acronym,
          jurisdiction = EXCLUDED.jurisdiction,
          official_url = EXCLUDED.official_url,
          retailers_followed = EXCLUDED.retailers_followed,
          importance = EXCLUDED.importance,
          rate22k_1g = EXCLUDED.rate22k_1g,
          rate22k_8g = EXCLUDED.rate22k_8g,
          rate22k_10g = EXCLUDED.rate22k_10g,
          rate24k_1g = EXCLUDED.rate24k_1g,
          rate24k_10g = EXCLUDED.rate24k_10g,
          rate18k_1g = EXCLUDED.rate18k_1g,
          rate18k_10g = EXCLUDED.rate18k_10g,
          rate_silver_1g = EXCLUDED.rate_silver_1g,
          rate_silver_1kg = EXCLUDED.rate_silver_1kg,
          spread_vs_benchmark = EXCLUDED.spread_vs_benchmark,
          spread_vs_mjdta = EXCLUDED.spread_vs_mjdta,
          time_recorded = EXCLUDED.time_recorded,
          status = EXCLUDED.status,
          official_base_10g = EXCLUDED.official_base_10g,
          gst_rate22k_1g = EXCLUDED.gst_rate22k_1g,
          gst_rate24k_1g = EXCLUDED.gst_rate24k_1g,
          session_name = EXCLUDED.session_name,
          session_date = EXCLUDED.session_date,
          updated_at = CURRENT_TIMESTAMP;
      `;
    }
    console.log('✅ Organisations migrated.');
  }

  // 5. Migrate Forecast & Macro Live
  const fcPath = path.join(__dirname, '..', 'data', 'forecast.json');
  if (fs.existsSync(fcPath)) {
    const fcData = JSON.parse(fs.readFileSync(fcPath, 'utf8'));
    await sql`
      INSERT INTO app_kv_store (key, value, updated_at)
      VALUES ('forecast', ${JSON.stringify(fcData)}, CURRENT_TIMESTAMP)
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP;
    `;
    console.log('✅ Forecast migrated to app_kv_store.');
  }

  const mlPath = path.join(__dirname, '..', 'data', 'macro_live.json');
  if (fs.existsSync(mlPath)) {
    const mlData = JSON.parse(fs.readFileSync(mlPath, 'utf8'));
    await sql`
      INSERT INTO app_kv_store (key, value, updated_at)
      VALUES ('macro_live', ${JSON.stringify(mlData)}, CURRENT_TIMESTAMP)
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP;
    `;
    console.log('✅ Macro live migrated to app_kv_store.');
  }

  // 6. Verify row counts in Lakebase Postgres
  const [mjdtaCount] = await sql`SELECT COUNT(*)::int as count FROM mjdta_history;`;
  const [macroCount] = await sql`SELECT COUNT(*)::int as count FROM macro_history;`;
  const [orgCount] = await sql`SELECT COUNT(*)::int as count FROM organisations;`;
  const [kvCount] = await sql`SELECT COUNT(*)::int as count FROM app_kv_store;`;

  console.log('\n=========================================');
  console.log('🎉 LAKEBASE POSTGRES (NEON) MIGRATION COMPLETE');
  console.log(`📊 mjdta_history:  ${mjdtaCount.count} rows`);
  console.log(`📈 macro_history:  ${macroCount.count} rows`);
  console.log(`🏢 organisations:  ${orgCount.count} rows`);
  console.log(`🔑 app_kv_store:   ${kvCount.count} keys`);
  console.log('=========================================\n');
}

runMigration().catch(err => {
  console.error('❌ Migration failed:', err);
  process.exit(1);
});
