const { handleRequest } = require('../server.js');

module.exports = async (req, res) => {
  // Preserve incoming subpaths (e.g. /api/organisations/sync or /api/organisations/select)
  if (!req.url.startsWith('/api/organisations')) {
    req.url = '/api/organisations' + (req.url.startsWith('/') ? req.url : '/' + req.url);
  }
  return handleRequest(req, res);
};
