const axios = require('axios');

const CF_WORKER_URL = process.env.CF_WORKER_URL || '';
const CF_API_SECRET = process.env.CF_API_SECRET || '';

const cfHttp = axios.create({
  baseURL: CF_WORKER_URL,
  timeout: 10000,
  headers: { Authorization: `Bearer ${CF_API_SECRET}` }
});

// ==================== CF Worker: Gold Prices ====================

const TRACKED_GOLD_SLUGS = new Set([
  'geram18',     // Gold 18k gram
  'sekkeh',      // Emami coin (new design)
  'sekkebahar',  // Bahar Azadi coin
  'nim',         // Half coin
  'rob'          // Quarter coin
]);

async function saveGoldPricesToCF(snapshot) {
  if (!CF_WORKER_URL) return;
  try {
    const goldItems = Object.values(snapshot.gold || {});
    const items = goldItems
      .filter((item) => TRACKED_GOLD_SLUGS.has(String(item.slug || '').toLowerCase()))
      .map((item) => ({
        slug: item.slug,
        name: item.name,
        price: Number(item.price) || 0,
        open: Number(item.open) || null,
        high: Number(item.high) || null,
        low: Number(item.low) || null,
        day_change: Number(item.dayChange) || null,
        real_price: item.real_price !== undefined ? Number(item.real_price) : null,
        bubble: item.bubble !== undefined ? Number(item.bubble) : null,
        bubble_per: item.bubble_per !== undefined ? Number(item.bubble_per) : null
      }));

    if (!items.length) return;
    await cfHttp.post('/prices', { items });
    console.log(`[cf] gold prices saved (${items.length} items)`);
  } catch (e) {
    console.error('[cf] save gold prices failed:', e.message);
  }
}

// ==================== CF Worker: User Tracking ====================

async function saveUserToCF(telegramUser) {
  if (!CF_WORKER_URL) return;
  try {
    await cfHttp.post('/users', {
      telegram_id: telegramUser.id,
      first_name: telegramUser.first_name || null,
      last_name: telegramUser.last_name || null,
      username: telegramUser.username || null,
      language_code: telegramUser.language_code || null
    });
    console.log(`[cf] user saved: ${telegramUser.id}`);
  } catch (e) {
    console.error('[cf] save user failed:', e.message);
  }
}

// ==================== In-Memory: Alerts ====================

let alertIdCounter = 0;
const alerts = []; // { id, user_id, chat_id, slug, category, direction, target_price, triggered, created_at }

function addAlert(userId, chatId, slug, category, direction, targetPrice) {
  alertIdCounter++;
  alerts.push({
    id: alertIdCounter,
    user_id: userId,
    chat_id: chatId,
    slug,
    category,
    direction,
    target_price: targetPrice,
    triggered: 0,
    created_at: new Date().toISOString()
  });
}

function getActiveAlerts() {
  return alerts.filter((a) => a.triggered === 0);
}

function triggerAlert(alertId) {
  const a = alerts.find((a) => a.id === alertId);
  if (a) a.triggered = 1;
}

function getUserAlerts(userId) {
  return alerts.filter((a) => a.user_id === userId && a.triggered === 0);
}

function deleteAlert(alertId, userId) {
  const idx = alerts.findIndex((a) => a.id === alertId && a.user_id === userId);
  if (idx !== -1) {
    alerts.splice(idx, 1);
    return { changes: 1 };
  }
  return { changes: 0 };
}

// ==================== In-Memory: Portfolio ====================

const portfolios = []; // { user_id, slug, category, amount }

function setPortfolioItem(userId, slug, category, amount) {
  const idx = portfolios.findIndex((p) => p.user_id === userId && p.slug === slug);
  if (idx !== -1) {
    if (amount <= 0) {
      portfolios.splice(idx, 1);
    } else {
      portfolios[idx].amount = amount;
      portfolios[idx].category = category;
    }
  } else if (amount > 0) {
    portfolios.push({ user_id: userId, slug, category, amount });
  }
}

function getPortfolio(userId) {
  return portfolios.filter((p) => p.user_id === userId);
}

// ==================== In-Memory: Group Settings ====================

const groupSettings = []; // { chat_id, summary_interval_min, last_summary_at, enabled }

function setGroupSummaryInterval(chatId, intervalMin) {
  const existing = groupSettings.find((g) => g.chat_id === chatId);
  if (existing) {
    existing.summary_interval_min = intervalMin;
    existing.enabled = 1;
  } else {
    groupSettings.push({ chat_id: chatId, summary_interval_min: intervalMin, last_summary_at: null, enabled: 1 });
  }
}

function disableGroupSummary(chatId) {
  const existing = groupSettings.find((g) => g.chat_id === chatId);
  if (existing) existing.enabled = 0;
}

function getActiveGroupSummaries() {
  return groupSettings.filter((g) => g.enabled === 1 && g.summary_interval_min > 0);
}

function updateGroupLastSummary(chatId) {
  const existing = groupSettings.find((g) => g.chat_id === chatId);
  if (existing) existing.last_summary_at = new Date().toISOString();
}

// ==================== In-Memory: Group Alerts ====================

let groupAlertIdCounter = 0;
const groupAlerts = [];

function addGroupAlert(chatId, slug, category, direction, targetPrice) {
  groupAlertIdCounter++;
  groupAlerts.push({
    id: groupAlertIdCounter,
    chat_id: chatId,
    slug,
    category,
    direction,
    target_price: targetPrice,
    triggered: 0,
    created_at: new Date().toISOString()
  });
}

function getActiveGroupAlerts() {
  return groupAlerts.filter((a) => a.triggered === 0);
}

function triggerGroupAlert(alertId) {
  const a = groupAlerts.find((a) => a.id === alertId);
  if (a) a.triggered = 1;
}

function getGroupAlerts(chatId) {
  return groupAlerts.filter((a) => a.chat_id === chatId && a.triggered === 0);
}

function deleteGroupAlert(alertId, chatId) {
  const idx = groupAlerts.findIndex((a) => a.id === alertId && a.chat_id === chatId);
  if (idx !== -1) {
    groupAlerts.splice(idx, 1);
    return { changes: 1 };
  }
  return { changes: 0 };
}

module.exports = {
  saveGoldPricesToCF,
  saveUserToCF,
  addAlert,
  getActiveAlerts,
  triggerAlert,
  getUserAlerts,
  deleteAlert,
  setPortfolioItem,
  getPortfolio,
  setGroupSummaryInterval,
  disableGroupSummary,
  getActiveGroupSummaries,
  updateGroupLastSummary,
  addGroupAlert,
  getActiveGroupAlerts,
  triggerGroupAlert,
  getGroupAlerts,
  deleteGroupAlert
};
