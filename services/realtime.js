/**
 * Neon Realtime Integration Service
 * Manages live queries and Realtime WebSocket configuration
 */
require('dotenv').config({ path: '.env.local' });
const { sql, isDbConnected } = require('./db');

const REALTIME_URL = process.env.NEON_REALTIME_URL || null;
const REALTIME_SECRET = process.env.NEON_REALTIME_SECRET || null;

async function getRealtimeConfig() {
  const dbOk = await isDbConnected();

  return {
    enabled: !!(REALTIME_URL && REALTIME_SECRET),
    url: REALTIME_URL,
    configured: true,
    features: [
      'live-sql-queries',
      'websocket-subscription',
      'optimistic-mutations',
      'sealed-query-engine'
    ],
    status: REALTIME_URL ? 'ACTIVE_READY' : 'STANDBY',
    lakebaseConnected: dbOk
  };
}

module.exports = {
  REALTIME_URL,
  getRealtimeConfig
};
