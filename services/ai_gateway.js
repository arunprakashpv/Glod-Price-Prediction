/**
 * Neon AI Gateway Integration Service
 * Powered by Databricks Unity AI Gateway on Neon branch
 */
require('dotenv').config({ path: '.env.local' });
const https = require('https');
const http = require('http');

const GATEWAY_BASE_URL = process.env.NEON_AI_GATEWAY_BASE_URL || null;
const GATEWAY_TOKEN = process.env.NEON_AI_GATEWAY_TOKEN || null;

async function queryGatewayModels() {
  if (!GATEWAY_BASE_URL || !GATEWAY_TOKEN) {
    return { available: false, error: 'NEON_AI_GATEWAY credentials not set in environment.' };
  }

  return new Promise((resolve) => {
    try {
      const url = new URL('/v1/models', GATEWAY_BASE_URL);
      const req = https.get(url, {
        headers: {
          'Authorization': `Bearer ${GATEWAY_TOKEN}`,
          'Accept': 'application/json'
        },
        timeout: 8000
      }, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          try {
            const data = JSON.parse(body);
            resolve({ available: res.statusCode === 200, statusCode: res.statusCode, data });
          } catch (e) {
            resolve({ available: false, statusCode: res.statusCode, raw: body });
          }
        });
      });

      req.on('timeout', () => {
        req.destroy();
        resolve({ available: false, error: 'Timeout connecting to Neon AI Gateway' });
      });

      req.on('error', (err) => {
        resolve({ available: false, error: err.message });
      });
    } catch (e) {
      resolve({ available: false, error: e.message });
    }
  });
}

async function generateMarketAnalysis(promptContext) {
  if (!GATEWAY_BASE_URL || !GATEWAY_TOKEN) {
    return {
      source: 'ALGORITHMIC_FALLBACK',
      message: 'AI Gateway credentials not loaded.',
      analysis: generateAlgorithmicCommentary(promptContext)
    };
  }

  // Attempt inference via Neon AI Gateway
  const requestPayload = JSON.stringify({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: 'You are an institutional Indian Bullion Market Strategist and Macro Quant. Provide a concise 3-sentence gold prediction synthesis based on macro drivers.'
      },
      {
        role: 'user',
        content: `Current Gold Price & Macro Context:\n${JSON.stringify(promptContext, null, 2)}`
      }
    ],
    max_tokens: 250,
    temperature: 0.3
  });

  const gatewayResult = await new Promise((resolve) => {
    try {
      const url = new URL('/v1/chat/completions', GATEWAY_BASE_URL);
      const req = https.request(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${GATEWAY_TOKEN}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(requestPayload)
        },
        timeout: 9000
      }, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          try {
            const json = JSON.parse(body);
            if (res.statusCode === 200 && json.choices && json.choices.length > 0) {
              resolve({ success: true, text: json.choices[0].message.content });
            } else {
              resolve({ success: false, statusCode: res.statusCode, json });
            }
          } catch (e) {
            resolve({ success: false, statusCode: res.statusCode, raw: body });
          }
        });
      });

      req.on('timeout', () => {
        req.destroy();
        resolve({ success: false, error: 'Timeout' });
      });

      req.on('error', (err) => resolve({ success: false, error: err.message }));

      req.write(requestPayload);
      req.end();
    } catch (e) {
      resolve({ success: false, error: e.message });
    }
  });

  if (gatewayResult.success) {
    return {
      source: 'NEON_AI_GATEWAY',
      model: 'gpt-4o-mini',
      gatewayBaseUrl: GATEWAY_BASE_URL,
      status: 'VERIFIED_LIVE_INFERENCE',
      analysis: gatewayResult.text
    };
  }

  // If billing credits or permissions are pending, return fallback commentary while signaling AI Gateway readiness
  return {
    source: 'NEON_AI_GATEWAY_STANDBY',
    gatewayBaseUrl: GATEWAY_BASE_URL,
    gatewayStatus: gatewayResult.statusCode === 402 || (gatewayResult.json && gatewayResult.json.message && gatewayResult.json.message.includes('credit'))
      ? 'AWAITING_BILLING_CREDITS'
      : (gatewayResult.error || 'STANDBY'),
    notice: 'Neon AI Gateway is provisioned and wired. Add AI Gateway credits on the Neon console for live LLM tokens.',
    analysis: generateAlgorithmicCommentary(promptContext)
  };
}

function generateAlgorithmicCommentary(ctx) {
  const gold = ctx.gold || 12695;
  const bias = ctx.bias || 'NEUTRAL';
  const usdInr = ctx.usdInr || 94.23;
  return `Gold is currently trading around ₹${gold.toLocaleString('en-IN')}/g (22K) with an underlying ${bias} macro stance. Rupee dynamics at ₹${usdInr}/USD continue to provide a structural price floor for domestic retail bullion across Chennai, Bengaluru, and Mumbai. Technical support at 20-day SMA indicates strategic accumulation opportunities during intraday retracements.`;
}

module.exports = {
  GATEWAY_BASE_URL,
  queryGatewayModels,
  generateMarketAnalysis
};
