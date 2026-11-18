const { handleRequest } = require('../../server.js');

module.exports = async (req, res) => {
  req.url = '/api/organisations/select';
  return handleRequest(req, res);
};
