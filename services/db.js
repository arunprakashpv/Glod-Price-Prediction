/**
 * Centralized Database Module for Lakebase Postgres (Neon)
 * Uses @neondatabase/serverless with resilient fallback
 */
require('dotenv').config({ path: '.env.local' });
const fs = require('fs');
const path = require('path');
const { neon } = require('@neondatabase/serverless');

const connectionString = process.env.DATABASE_URL || process.env.DATABASE_URL_UNPOOLED;
let sql = null;

if (connectionString) {
  try {
    sql = neon(connectionString);
  } catch (err) {
    console.warn('[Neon DB Init Warning]:', err.message);
  }
}

async function isDbConnected() {
  if (!sql) return false;
  try {
    const res = await sql`SELECT 1 as connected;`;
    return res && res.length > 0 && res[0].connected === 1;
  } catch (err) {
    return false;
  }
}

// MJDTA History
async function getMjdtaHistory() {
  if (sql) {
    try {
      const rows = await sql`
        SELECT 
          to_char(date, 'YYYY-MM-DD') as date,
          sno,
          date_raw as "dateRaw",
          gold22k_1g::float as "gold22k_1g",
          gold22k_8g::float as "gold22k_8g",
          gold22k_10g::float as "gold22k_10g",
          gold24k_1g::float as "gold24k_1g",
          silver_1g::float as "silver_1g",
          silver_1kg::float as "silver_1kg",
          change::float as "change",
          pct_change::float as "pctChange",
          sma20::float as "sma20",
          sma50::float as "sma50",
          sma200::float as "sma200"
        FROM mjdta_history
        ORDER BY date ASC;
      `;
      if (rows && rows.length > 0) {
        return rows;
      }
    } catch (err) {
      console.warn('[DB Error getMjdtaHistory]:', err.message, 'Falling back to local file.');
    }
  }

  // Fallback to local file
  const localFile = path.join(__dirname, '..', 'data', 'mjdta_history_2006_2026.json');
  if (fs.existsSync(localFile)) {
    const data = JSON.parse(fs.readFileSync(localFile, 'utf8'));
    return data.dailySeries || [];
  }
  return [];
}

async function saveMjdtaRows(rows) {
  if (!rows || rows.length === 0) return false;
  if (sql) {
    try {
      for (const r of rows) {
        await sql`
          INSERT INTO mjdta_history (
            date, sno, date_raw, gold22k_1g, gold22k_8g, gold22k_10g,
            gold24k_1g, silver_1g, silver_1kg, change, pct_change,
            sma20, sma50, sma200
          ) VALUES (
            ${r.date}, ${r.sno || null}, ${r.dateRaw || null},
            ${r.gold22k_1g || null}, ${r.gold22k_8g || null}, ${r.gold22k_10g || null},
            ${r.gold24k_1g || null}, ${r.silver_1g || null}, ${r.silver_1kg || null},
            ${r.change || 0}, ${r.pctChange || 0},
            ${r.sma20 || null}, ${r.sma50 || null}, ${r.sma200 || null}
          )
          ON CONFLICT (date) DO UPDATE SET
            gold22k_1g = EXCLUDED.gold22k_1g,
            gold22k_8g = EXCLUDED.gold22k_8g,
            gold22k_10g = EXCLUDED.gold22k_10g,
            gold24k_1g = EXCLUDED.gold24k_1g,
            silver_1g = EXCLUDED.silver_1g,
            change = EXCLUDED.change,
            pct_change = EXCLUDED.pct_change,
            sma20 = EXCLUDED.sma20,
            sma50 = EXCLUDED.sma50,
            sma200 = EXCLUDED.sma200;
        `;
      }
      return true;
    } catch (err) {
      console.warn('[DB Error saveMjdtaRows]:', err.message);
    }
  }
  return false;
}

// Macro History
async function getMacroHistory() {
  if (sql) {
    try {
      const rows = await sql`
        SELECT 
          to_char(date, 'YYYY-MM-DD') as date,
          gold::float as "gold",
          gold_sma20::float as "goldSma20",
          gold_sma50::float as "goldSma50",
          gold_chg1d::float as "goldChg1d",
          usd_inr::float as "usd_inr",
          usd_inr_sma20::float as "usdInrSma20",
          usd_inr_sma50::float as "usdInrSma50",
          usd_inr_chg1d::float as "usdInrChg1d",
          usd_index::float as "usd_index",
          dxy_sma20::float as "dxySma20",
          dxy_sma50::float as "dxySma50",
          dxy_chg1d::float as "dxyChg1d",
          treasury_yield::float as "treasury_yield",
          yield_sma20::float as "yieldSma20",
          yield_sma50::float as "yieldSma50",
          yield_chg1d::float as "yieldChg1d",
          raw_spot_inr22k::float as "rawSpotInr22k",
          macro_score as "macroScore",
          macro_bias as "macroBias",
          pillars
        FROM macro_history
        ORDER BY date ASC;
      `;
      if (rows && rows.length > 0) {
        return rows;
      }
    } catch (err) {
      console.warn('[DB Error getMacroHistory]:', err.message, 'Falling back to local file.');
    }
  }

  const localFile = path.join(__dirname, '..', 'data', 'macro_history_2006_2026.json');
  if (fs.existsSync(localFile)) {
    const data = JSON.parse(fs.readFileSync(localFile, 'utf8'));
    return data.dailySeries || [];
  }
  return [];
}

// Organisations
async function getOrganisationsData() {
  if (sql) {
    try {
      const orgRows = await sql`
        SELECT 
          id,
          name,
          acronym,
          jurisdiction,
          official_url as "officialUrl",
          retailers_followed as "retailersFollowed",
          importance,
          rate22k_1g::float as "rate22k_1g",
          rate22k_8g::float as "rate22k_8g",
          rate22k_10g::float as "rate22k_10g",
          rate24k_1g::float as "rate24k_1g",
          rate24k_10g::float as "rate24k_10g",
          rate18k_1g::float as "rate18k_1g",
          rate18k_10g::float as "rate18k_10g",
          rate_silver_1g::float as "rateSilver_1g",
          rate_silver_1kg::float as "rateSilver_1kg",
          spread_vs_benchmark::float as "spreadVsBenchmark",
          spread_vs_mjdta::float as "spreadVsMjdta",
          time_recorded as "timeRecorded",
          status,
          official_base_10g::float as "officialBase10g",
          gst_rate22k_1g::float as "gstRate22k_1g",
          gst_rate24k_1g::float as "gstRate24k_1g",
          session_name as "sessionName",
          session_date as "sessionDate"
        FROM organisations
        ORDER BY 
          CASE id
            WHEN 'grt' THEN 1
            WHEN 'mjdta' THEN 2
            WHEN 'ibja' THEN 3
            WHEN 'jab' THEN 4
            ELSE 5
          END;
      `;

      const metaRow = await sql`SELECT value FROM app_kv_store WHERE key = 'organisations_meta' LIMIT 1;`;
      const meta = (metaRow && metaRow[0]) ? metaRow[0].value : {};

      if (orgRows && orgRows.length > 0) {
        return {
          lastUpdated: meta.lastUpdated || new Date().toISOString(),
          activeBenchmarkId: meta.activeBenchmarkId || 'grt',
          comparison: meta.comparison || {},
          organisations: orgRows
        };
      }
    } catch (err) {
      console.warn('[DB Error getOrganisationsData]:', err.message, 'Falling back to local cache.');
    }
  }

  const localFile = path.join(__dirname, '..', 'data', 'organisations_cache.json');
  if (fs.existsSync(localFile)) {
    return JSON.parse(fs.readFileSync(localFile, 'utf8'));
  }
  return null;
}

async function saveOrganisationsData(cache) {
  if (!cache || !Array.isArray(cache.organisations)) return false;

  // Persist locally for redundancy
  try {
    const localFile = path.join(__dirname, '..', 'data', 'organisations_cache.json');
    fs.writeFileSync(localFile, JSON.stringify(cache, null, 2), 'utf8');
  } catch (e) {}

  if (sql) {
    try {
      await sql`
        INSERT INTO app_kv_store (key, value, updated_at)
        VALUES (
          'organisations_meta',
          ${JSON.stringify({
            lastUpdated: cache.lastUpdated,
            activeBenchmarkId: cache.activeBenchmarkId,
            comparison: cache.comparison
          })},
          CURRENT_TIMESTAMP
        )
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP;
      `;

      for (const org of cache.organisations) {
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
      return true;
    } catch (err) {
      console.warn('[DB Error saveOrganisationsData]:', err.message);
    }
  }
  return false;
}

// App Key-Value Store (Forecast, Live Macro, Settings)
async function getKv(key, fallbackFile = null) {
  if (sql) {
    try {
      const res = await sql`SELECT value FROM app_kv_store WHERE key = ${key} LIMIT 1;`;
      if (res && res.length > 0) return res[0].value;
    } catch (err) {
      console.warn(`[DB Error getKv ${key}]:`, err.message);
    }
  }
  if (fallbackFile && fs.existsSync(fallbackFile)) {
    try {
      return JSON.parse(fs.readFileSync(fallbackFile, 'utf8'));
    } catch (e) {}
  }
  return null;
}

async function setKv(key, value, fallbackFile = null) {
  if (fallbackFile) {
    try {
      fs.writeFileSync(fallbackFile, JSON.stringify(value, null, 2), 'utf8');
    } catch (e) {}
  }
  if (sql) {
    try {
      await sql`
        INSERT INTO app_kv_store (key, value, updated_at)
        VALUES (${key}, ${JSON.stringify(value)}, CURRENT_TIMESTAMP)
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP;
      `;
      return true;
    } catch (err) {
      console.warn(`[DB Error setKv ${key}]:`, err.message);
    }
  }
  return false;
}

module.exports = {
  sql,
  isDbConnected,
  getMjdtaHistory,
  saveMjdtaRows,
  getMacroHistory,
  getOrganisationsData,
  saveOrganisationsData,
  getKv,
  setKv
};
