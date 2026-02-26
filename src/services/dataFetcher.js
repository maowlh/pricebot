const axios = require('axios');
const NodeCache = require('node-cache');

const API_BASE_URL = process.env.API_BASE_URL || 'https://price-gateway.liara.run/api/v1';
const API_KEY = process.env.API_KEY || 'Ma9073Ma3237100';
const FALLBACK_CHART_URL =
  process.env.FALLBACK_CHART_URL ||
  'https://quickchart.io/chart?c=%7Btype%3A%22line%22%2Cdata%3A%7Blabels%3A%5B%22-%22%5D%2Cdatasets%3A%5B%7Bdata%3A%5B0%5D%2CborderColor%3A%22%236b7280%22%2CpointRadius%3A0%7D%5D%7D%2Coptions%3A%7Bplugins%3A%7Blegend%3A%7Bdisplay%3Afalse%7D%7D%2Cscales%3A%7Bx%3A%7Bdisplay%3Afalse%7D%2Cy%3A%7Bdisplay%3Afalse%7D%7D%7D%7D';

const cache = new NodeCache({ stdTTL: 3600, useClones: false });

const brsSymbolMap = {
  abshodeh: 'IR_GOLD_ABSHODEH',
  '18ayar': 'IR_GOLD_18K',
  sekkeh: 'IR_COIN_EMAMI',
  bahar: 'IR_COIN_BAHAR',
  nim: 'IR_COIN_NIM',
  rob: 'IR_COIN_ROB',
  sek: 'IR_COIN_SEKG',
  usd: 'USD',
  eur: 'EUR',
  gbp: 'GBP',
  aed: 'AED',
  try: 'TRY',
  cny: 'CNY',
  cad: 'CAD',
  aud: 'AUD'
};

const http = axios.create({
  baseURL: API_BASE_URL,
  timeout: 15000,
  headers: {
    'x-api-key': API_KEY
  }
});

const quickChartUrl = (labels, prices) => {
  const chartConfig = {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          data: prices,
          borderColor: '#22c55e',
          borderWidth: 2,
          pointRadius: 0,
          fill: false,
          tension: 0.35
        }
      ]
    },
    options: {
      responsive: true,
      animation: false,
      plugins: {
        legend: { display: false },
        tooltip: { enabled: false }
      },
      layout: { padding: 2 },
      scales: {
        x: {
          display: false,
          grid: { display: false }
        },
        y: {
          display: false,
          grid: { color: 'rgba(255,255,255,0.05)' }
        }
      },
      elements: {
        line: { capBezierPoints: true }
      }
    }
  };

  return `https://quickchart.io/chart?w=800&h=320&backgroundColor=transparent&c=${encodeURIComponent(
    JSON.stringify(chartConfig)
  )}`;
};

const normalizeArrayPayload = (payload) => {
  if (!payload || typeof payload !== 'object') return [];
  if (Array.isArray(payload)) return payload;
  return Object.values(payload);
};

async function fetchLiveData() {
  const [gold, crypto, currencies] = await Promise.all([
    http.get('/market/acgold'),
    http.get('/market/accrypto'),
    http.get('/market/accurrencies')
  ]);

  cache.set('live:gold', gold.data || {});
  cache.set('live:crypto', crypto.data || {});
  cache.set('live:currencies', currencies.data || {});
  cache.set('live:lastUpdatedAt', new Date().toISOString());
}

async function fetchHistoryCharts() {
  const entries = Object.entries(brsSymbolMap);
  const chartEntries = await Promise.all(
    entries.map(async ([slug, symbol]) => {
      try {
        const response = await http.get('/market/brshistory24', {
          params: { symbol }
        });
        const history = normalizeArrayPayload(response.data?.history_24h).slice().reverse();

        if (!history.length) {
          return [slug, FALLBACK_CHART_URL];
        }

        const labels = history.map((item) => item.time);
        const prices = history.map((item) => Number(item.price) || 0);
        return [slug, quickChartUrl(labels, prices)];
      } catch (error) {
        console.error(`[history] failed for ${slug} (${symbol}):`, error.message);
        return [slug, FALLBACK_CHART_URL];
      }
    })
  );

  cache.set('charts:bySlug', Object.fromEntries(chartEntries));
  cache.set('charts:lastUpdatedAt', new Date().toISOString());
}

function getSnapshot() {
  return {
    gold: cache.get('live:gold') || {},
    crypto: cache.get('live:crypto') || {},
    currencies: cache.get('live:currencies') || {},
    chartsBySlug: cache.get('charts:bySlug') || {},
    fallbackChart: FALLBACK_CHART_URL,
    lastUpdatedAt: cache.get('live:lastUpdatedAt') || null,
    chartsLastUpdatedAt: cache.get('charts:lastUpdatedAt') || null
  };
}

async function warmup() {
  await fetchLiveData();
  await fetchHistoryCharts();
}

function startBackgroundJobs() {
  warmup().catch((error) => {
    console.error('[warmup] initial fetch failed:', error.message);
  });

  setInterval(() => {
    fetchLiveData().catch((error) => {
      console.error('[live] refresh failed:', error.message);
    });
  }, 30 * 1000);

  setInterval(() => {
    fetchHistoryCharts().catch((error) => {
      console.error('[history] refresh failed:', error.message);
    });
  }, 60 * 60 * 1000);
}

module.exports = {
  startBackgroundJobs,
  getSnapshot,
  fetchLiveData,
  fetchHistoryCharts,
  brsSymbolMap,
  FALLBACK_CHART_URL
};
