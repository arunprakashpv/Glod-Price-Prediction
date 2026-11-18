const { handleRequest } = require('../server.js');

module.exports = async (req, res) => {
  if (!req.url.startsWith('/api/forecast')) {
    req.url = '/api/forecast' + (req.url.startsWith('/') ? req.url : '/' + req.url);
  }
  return handleRequest(req, res);
};
