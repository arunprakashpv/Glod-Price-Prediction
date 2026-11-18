const { handleRequest } = require('../../server.js');

module.exports = async (req, res) => {
  req.url = '/api/organisations/sync';
  return handleRequest(req, res);
};
