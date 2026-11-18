const { handleRequest } = require('../../server.js');

module.exports = async (req, res) => {
  req.url = '/api/benchmark/update';
  return handleRequest(req, res);
};
