const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', '..', 'data', 'prices.db');

// Ensure data directory exists
const fs = require('fs');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);

// Enable WAL mode for better performance
db.pragma('journal_mode = WAL');

// --- Create tables ---
db.exec(`
  CREATE TABLE IF NOT EXISTS price_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category TEXT NOT NULL,
    slug TEXT NOT NULL,
    name TEXT,
    price REAL,
    data_json TEXT,
    recorded_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_ph_slug_time ON price_history (slug, recorded_at);
  CREATE INDEX IF NOT EXISTS idx_ph_category_time ON price_history (category, recorded_at);

  CREATE TABLE IF NOT EXISTS alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    chat_id INTEGER NOT NULL,
    slug TEXT NOT NULL,
    category TEXT NOT NULL,
    direction TEXT NOT NULL,
    target_price REAL NOT NULL,
    triggered INTEGER DEFAULT 0,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_alerts_active ON alerts (triggered, slug);

  CREATE TABLE IF NOT EXISTS portfolios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    slug TEXT NOT NULL,
    category TEXT NOT NULL,
    amount REAL NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_portfolio_user ON portfolios (user_id);

  CREATE TABLE IF NOT EXISTS user_settings (
    user_id INTEGER PRIMARY KEY,
    lang TEXT DEFAULT 'fa'
  );

  CREATE TABLE IF NOT EXISTS group_settings (
    chat_id INTEGER PRIMARY KEY,
    summary_interval_min INTEGER DEFAULT 0,
    last_summary_at TEXT,
    enabled INTEGER DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS group_alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id INTEGER NOT NULL,
    slug TEXT NOT NULL,
    category TEXT NOT NULL,
    direction TEXT NOT NULL,
    target_price REAL NOT NULL,
    triggered INTEGER DEFAULT 0,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_group_alerts_active ON group_alerts (triggered, slug);
`);

// --- Price history ---
const insertPrice = db.prepare(`
  INSERT INTO price_history (category, slug, name, price, data_json, recorded_at)
  VALUES (?, ?, ?, ?, ?, ?)
`);

function savePriceSnapshot(snapshot) {
  const now = new Date().toISOString();
  const tx = db.transaction(() => {
    // Gold
    for (const item of Object.values(snapshot.gold || {})) {
      insertPrice.run('gold', item.slug, item.name, Number(item.price) || 0, JSON.stringify(item), now);
    }
    // Crypto
    for (const item of Object.values(snapshot.crypto || {})) {
      insertPrice.run('crypto', item.slug, item.name, Number(item.toman) || 0, JSON.stringify(item), now);
    }
    // Currencies
    for (const item of Object.values(snapshot.currencies || {})) {
      insertPrice.run('currency', item.slug, item.name, Number(item.sell) || 0, JSON.stringify(item), now);
    }
  });
  tx();
  console.log(`[db] price snapshot saved at ${now}`);
}

function getHistory(slug, hours = 24) {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  return db.prepare(`
    SELECT price, recorded_at FROM price_history
    WHERE slug = ? AND recorded_at >= ?
    ORDER BY recorded_at ASC
  `).all(slug, since);
}

// --- Alerts ---
const insertAlert = db.prepare(`
  INSERT INTO alerts (user_id, chat_id, slug, category, direction, target_price, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);

function addAlert(userId, chatId, slug, category, direction, targetPrice) {
  const now = new Date().toISOString();
  insertAlert.run(userId, chatId, slug, category, direction, targetPrice, now);
}

function getActiveAlerts() {
  return db.prepare(`SELECT * FROM alerts WHERE triggered = 0`).all();
}

function triggerAlert(alertId) {
  db.prepare(`UPDATE alerts SET triggered = 1 WHERE id = ?`).run(alertId);
}

function getUserAlerts(userId) {
  return db.prepare(`SELECT * FROM alerts WHERE user_id = ? AND triggered = 0`).all(userId);
}

function deleteAlert(alertId, userId) {
  return db.prepare(`DELETE FROM alerts WHERE id = ? AND user_id = ?`).run(alertId, userId);
}

// --- Portfolio ---
function setPortfolioItem(userId, slug, category, amount) {
  const existing = db.prepare(`SELECT id FROM portfolios WHERE user_id = ? AND slug = ?`).get(userId, slug);
  if (existing) {
    if (amount <= 0) {
      db.prepare(`DELETE FROM portfolios WHERE id = ?`).run(existing.id);
    } else {
      db.prepare(`UPDATE portfolios SET amount = ?, category = ? WHERE id = ?`).run(amount, category, existing.id);
    }
  } else if (amount > 0) {
    db.prepare(`INSERT INTO portfolios (user_id, slug, category, amount) VALUES (?, ?, ?, ?)`).run(userId, slug, category, amount);
  }
}

function getPortfolio(userId) {
  return db.prepare(`SELECT * FROM portfolios WHERE user_id = ?`).all(userId);
}

// --- User settings ---
function setUserLang(userId, lang) {
  db.prepare(`INSERT OR REPLACE INTO user_settings (user_id, lang) VALUES (?, ?)`).run(userId, lang);
}

function getUserLang(userId) {
  const row = db.prepare(`SELECT lang FROM user_settings WHERE user_id = ?`).get(userId);
  return row?.lang || 'fa';
}

// --- Group settings ---
function setGroupSummaryInterval(chatId, intervalMin) {
  const existing = db.prepare(`SELECT chat_id FROM group_settings WHERE chat_id = ?`).get(chatId);
  if (existing) {
    db.prepare(`UPDATE group_settings SET summary_interval_min = ?, enabled = 1 WHERE chat_id = ?`).run(intervalMin, chatId);
  } else {
    db.prepare(`INSERT INTO group_settings (chat_id, summary_interval_min, enabled) VALUES (?, ?, 1)`).run(chatId, intervalMin);
  }
}

function disableGroupSummary(chatId) {
  db.prepare(`UPDATE group_settings SET enabled = 0 WHERE chat_id = ?`).run(chatId);
}

function getActiveGroupSummaries() {
  return db.prepare(`SELECT * FROM group_settings WHERE enabled = 1 AND summary_interval_min > 0`).all();
}

function updateGroupLastSummary(chatId) {
  db.prepare(`UPDATE group_settings SET last_summary_at = ? WHERE chat_id = ?`).run(new Date().toISOString(), chatId);
}

// --- Group alerts ---
function addGroupAlert(chatId, slug, category, direction, targetPrice) {
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO group_alerts (chat_id, slug, category, direction, target_price, created_at) VALUES (?, ?, ?, ?, ?, ?)`).run(chatId, slug, category, direction, targetPrice, now);
}

function getActiveGroupAlerts() {
  return db.prepare(`SELECT * FROM group_alerts WHERE triggered = 0`).all();
}

function triggerGroupAlert(alertId) {
  db.prepare(`UPDATE group_alerts SET triggered = 1 WHERE id = ?`).run(alertId);
}

function getGroupAlerts(chatId) {
  return db.prepare(`SELECT * FROM group_alerts WHERE chat_id = ? AND triggered = 0`).all(chatId);
}

function deleteGroupAlert(alertId, chatId) {
  return db.prepare(`DELETE FROM group_alerts WHERE id = ? AND chat_id = ?`).run(alertId, chatId);
}

// --- Cleanup old data (keep 30 days) ---
function cleanupOldData() {
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const result = db.prepare(`DELETE FROM price_history WHERE recorded_at < ?`).run(cutoff);
  if (result.changes > 0) {
    console.log(`[db] cleaned up ${result.changes} old price records`);
  }
}

module.exports = {
  db,
  savePriceSnapshot,
  getHistory,
  addAlert,
  getActiveAlerts,
  triggerAlert,
  getUserAlerts,
  deleteAlert,
  setPortfolioItem,
  getPortfolio,
  setUserLang,
  getUserLang,
  setGroupSummaryInterval,
  disableGroupSummary,
  getActiveGroupSummaries,
  updateGroupLastSummary,
  addGroupAlert,
  getActiveGroupAlerts,
  triggerGroupAlert,
  getGroupAlerts,
  deleteGroupAlert,
  cleanupOldData
};
