/**
 * Neon Auth (Managed Better Auth) Integration Service
 * Interacts with Lakebase Postgres neon_auth schema & Neon Auth endpoints
 */
require('dotenv').config({ path: '.env.local' });
const { sql, isDbConnected } = require('./db');

const AUTH_BASE_URL = process.env.NEON_AUTH_BASE_URL || null;
const AUTH_JWKS_URL = process.env.NEON_AUTH_JWKS_URL || null;

async function getAuthConfig() {
  const connected = await isDbConnected();
  let userCount = 0;
  let activeSessionCount = 0;

  if (connected && sql) {
    try {
      const [uRes] = await sql`SELECT COUNT(*)::int as count FROM neon_auth.user;`;
      const [sRes] = await sql`SELECT COUNT(*)::int as count FROM neon_auth.session WHERE expires_at > CURRENT_TIMESTAMP;`;
      userCount = uRes ? uRes.count : 0;
      activeSessionCount = sRes ? sRes.count : 0;
    } catch (e) {
      // Schema may have different structure or empty
    }
  }

  return {
    enabled: true,
    provider: 'Neon Managed Better Auth',
    baseUrl: AUTH_BASE_URL,
    jwksUrl: AUTH_JWKS_URL,
    status: AUTH_BASE_URL ? 'ACTIVE' : 'CONFIGURED',
    metrics: {
      registeredUsers: userCount,
      activeSessions: activeSessionCount
    },
    supportedMethods: [
      'email-password',
      'magic-link',
      'google-oauth',
      'github-oauth'
    ]
  };
}

async function verifyToken(token) {
  if (!token) return null;
  if (!sql) return null;

  try {
    const rows = await sql`
      SELECT s.id, s.user_id, s.expires_at, u.email, u.name
      FROM neon_auth.session s
      JOIN neon_auth.user u ON s.user_id = u.id
      WHERE s.token = ${token} AND s.expires_at > CURRENT_TIMESTAMP
      LIMIT 1;
    `;
    return rows && rows.length > 0 ? rows[0] : null;
  } catch (err) {
    console.warn('[Neon Auth verifyToken]:', err.message);
    return null;
  }
}

module.exports = {
  getAuthConfig,
  verifyToken
};
