const { handleRequest } = require('../../server.js');

module.exports = async (req, res) => {
  req.url = '/api/history/sync-missed';
  return handleRequest(req, res);
};
