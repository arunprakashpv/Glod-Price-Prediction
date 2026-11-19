const { handleRequest } = require('../../server.js');

module.exports = async (req, res) => {
  req.url = '/api/history/download';
  return handleRequest(req, res);
};
