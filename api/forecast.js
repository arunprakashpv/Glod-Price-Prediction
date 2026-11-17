const { handleRequest } = require('../server.js');

module.exports = async (req, res) => {
  req.url = '/api/forecast' + (req.url.includes('?') ? '?' + req.url.split('?')[1] : '');
  return handleRequest(req, res);
};
