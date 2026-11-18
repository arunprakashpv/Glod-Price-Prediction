const { handleRequest } = require('../server.js');

module.exports = async (req, res) => {
  if (!req.url.startsWith('/api/benchmark')) {
    req.url = '/api/benchmark' + (req.url.startsWith('/') ? req.url : '/' + req.url);
  }
  return handleRequest(req, res);
};
