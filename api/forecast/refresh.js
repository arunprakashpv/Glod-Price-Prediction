const { handleRequest } = require('../../server.js');

module.exports = async (req, res) => {
  req.url = '/api/forecast/refresh';
  return handleRequest(req, res);
};
