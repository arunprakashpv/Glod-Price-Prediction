/**
 * Vercel Serverless Function entry point
 * Delegates incoming API requests to AURUM MATRIX server
 */
const server = require('../server.js');

module.exports = (req, res) => {
  return server.emit('request', req, res);
};
