const axios = require('axios');
const NodeCache = require('node-cache');
const { savePriceSnapshot, cleanupOldData } = require('./database');

const API_BASE_URL = process.env.API_BASE_URL || 'https://api.alanchand.com';
const API_TOKEN = process.env.API_TOKEN || 'zYAMhyxJUJyB0w3qn24R';

// --- Configuration ---
const RETRY_COUNT = 3;
const RETRY_BASE_DELAY_MS = 2000;
const REFRESH_INTERVAL_MS = 15 * 60 * 1000;

const cache = new NodeCache({ stdTTL: 7200, useClones: false });

let isFetching = false;

const http = axios.create({
  baseURL: API_BASE_URL,
  timeout: 20000
});

// --- Utility: delay helper ---
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// --- Utility: retry wrapper with exponential backoff for 500/429 ---
async function fetchWithRetry(requestFn, label, retries = RETRY_COUNT) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await requestFn();
    } catch (error) {
      const status = error.response?.status;
      const isRetryable = !status || status === 500 || status === 429 || status === 502 || status === 503 || status === 504;

      if (isRetryable && attempt < retries) {
        const backoff = RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1) + Math.random() * 500;
        console.warn(`[retry] ${label} attempt ${attempt}/${retries} failed (${status || 'NETWORK'}), retrying in ${Math.round(backoff)}ms...`);
        await delay(backoff);
      } else {
        throw error;
      }
    }
  }
}

// --- Fetch all live data: only update cache on success ---
async function fetchLiveData() {
  if (isFetching) {
    console.warn('[live] previous fetch still in progress, skipping');
    return;
  }
  isFetching = true;

  try {
    const gold = await fetchWithRetry(() => http.get('/', { params: { type: 'golds', token: API_TOKEN } }), 'golds');
    await delay(500);
    const crypto = await fetchWithRetry(() => http.get('/', { params: { type: 'crypto', token: API_TOKEN } }), 'crypto');
    await delay(500);
    const currencies = await fetchWithRetry(() => http.get('/', { params: { type: 'currencies', token: API_TOKEN } }), 'currencies');

    if (gold.data && Object.keys(gold.data).length) {
      cache.set('live:gold', gold.data);
    }
    if (crypto.data && Object.keys(crypto.data).length) {
      cache.set('live:crypto', crypto.data);
    }
    if (currencies.data && Object.keys(currencies.data).length) {
      cache.set('live:currencies', currencies.data);
    }

    cache.set('live:lastUpdatedAt', new Date().toISOString());
    console.log('[live] data refreshed successfully');

    // Save to database
    try {
      savePriceSnapshot(getSnapshot());
    } catch (dbErr) {
      console.error('[db] save failed:', dbErr.message);
    }
  } catch (error) {
    console.error('[live] refresh failed (keeping stale cache):', error.message);
  } finally {
    isFetching = false;
  }
}

function getSnapshot() {
  return {
    gold: cache.get('live:gold') || {},
    crypto: cache.get('live:crypto') || {},
    currencies: cache.get('live:currencies') || {},
    lastUpdatedAt: cache.get('live:lastUpdatedAt') || null
  };
}

async function warmup() {
  console.log('[warmup] fetching data...');
  await fetchLiveData();
  console.log('[warmup] complete');
}

function startBackgroundJobs() {
  warmup().catch((error) => {
    console.error('[warmup] initial fetch failed:', error.message);
  });

  setInterval(() => {
    fetchLiveData().catch((error) => {
      console.error('[live] interval error:', error.message);
    });
  }, REFRESH_INTERVAL_MS);

  // Cleanup old DB records daily
  setInterval(() => {
    try { cleanupOldData(); } catch (e) { console.error('[db] cleanup error:', e.message); }
  }, 24 * 60 * 60 * 1000);
}

module.exports = {
  startBackgroundJobs,
  getSnapshot
};