/**
 * Vercel Serverless Function Catch-All Entry Point
 * Routes requests to AURUM MATRIX request handler
 */
const { handleRequest } = require('../server.js');

module.exports = async (req, res) => {
  try {
    // If Vercel rewrote the path into query parameter 'match'
    let matchPath = null;
    if (req.query && req.query.match) {
      matchPath = Array.isArray(req.query.match) ? req.query.match.join('/') : req.query.match;
    } else if (req.url && req.url.includes('match=')) {
      try {
        const u = new URL(req.url, 'http://localhost');
        const m = u.searchParams.get('match');
        if (m) matchPath = m;
      } catch (e) {}
    }

    if (matchPath) {
      try {
        const u = new URL(req.url, 'http://localhost');
        u.searchParams.delete('match');
        const remainingQuery = u.searchParams.toString();
        req.url = '/api/' + matchPath.replace(/^\/+/, '') + (remainingQuery ? '?' + remainingQuery : '');
      } catch (e) {
        req.url = '/api/' + matchPath.replace(/^\/+/, '');
      }
    }
    await handleRequest(req, res);
  } catch (err) {
    console.error('[Vercel Serverless Handler Error]:', err);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message, stack: err.stack }));
    }
  }
};
