require('dotenv').config();

const { Telegraf } = require('telegraf');
const {
  startBackgroundJobs,
  getSnapshot
} = require('./services/dataFetcher');
const {
  formatNumber,
  trendEmoji,
  flagForCurrency,
  emojiForCrypto
} = require('./utils/formatters');
const {
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
} = require('./services/database');

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
  throw new Error('Missing BOT_TOKEN in environment variables.');
}

const bot = new Telegraf(BOT_TOKEN);

const FOOTER = '\n\nJoin our channel | t.me/PoolPricer';

const calculatorRegex = /^([\d.]+)\s*([a-zA-Z0-9-]+)\s*to\s*([a-zA-Z0-9-]+)$/i;

const buildRateIndex = (snapshot) => {
  const rates = { TOMAN: 1 };

  Object.values(snapshot.currencies || {}).forEach((currency) => {
    if (!currency?.slug) return;
    rates[currency.slug.toUpperCase()] = Number(currency.sell || 0);
  });

  Object.values(snapshot.crypto || {}).forEach((crypto) => {
    if (!crypto?.slug) return;
    rates[crypto.slug.toUpperCase()] = Number(crypto.toman || 0);
  });

  rates.USD = rates.USD || Number(snapshot.currencies?.usd?.sell || 0);
  return rates;
};

const USD_GOLD_SLUGS = new Set(['usd_xau', 'xag']);

const formatGoldText = (item) => {
  const changeEmoji = trendEmoji(item.dayChange);
  const unit = USD_GOLD_SLUGS.has(String(item.slug || '').toLowerCase()) ? '$' : 'Toman';
  const lines = [
    `🥇 | Gold ${String(item.slug || item.name || '').toUpperCase()}`,
    '',
    `💲| Price: ${formatNumber(item.price)} ${unit}`,
    '',
    `➕| Open: ${formatNumber(item.open)} ${unit}`,
    `🔺| High: ${formatNumber(item.high)} ${unit}`,
    `🔻| Low: ${formatNumber(item.low)} ${unit}`,
    '',
    `${changeEmoji} | Today: ${formatNumber(item.dayChange, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}%`,
  ];
  if (item.real_price !== undefined) {
    lines.push('', `▫️| Real Price: ${formatNumber(item.real_price)} ${unit}`);
  }
  if (item.bubble !== undefined) {
    lines.push('', `🫧| Bubble: ${formatNumber(item.bubble)} ${unit}`);
    lines.push(`📍| Bubble Per: ${formatNumber(item.bubble_per, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}%`);
  }
  return lines.join('\n');
};

const formatCurrencyText = (item) => {
  const changeEmoji = trendEmoji(item.dayChange);
  return [
    `${flagForCurrency(item.slug)} | ${item.name} (${String(item.slug || '').toUpperCase()})`,
    '',
    `🔻| Toman (SELL): ${formatNumber(item.sell)} Toman`,
    `🔺| Toman (BUY): ${formatNumber(item.buy)} Toman`,
    '',
    `🇺🇸| Price USD: ${formatNumber(item.dolar_rate, { minimumFractionDigits: 0, maximumFractionDigits: 6 })} $`,
    '',
    `➕| Open: ${formatNumber(item.open)} Toman`,
    `🔺| High: ${formatNumber(item.high)} Toman`,
    `🔻| Low: ${formatNumber(item.low)} Toman`,
    '',
    `${changeEmoji} | Day Change: ${formatNumber(item.dayChange, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}%`,
  ].join('\n');
};

const formatCryptoText = (item) => {
  const pct = (v) =>
    `${formatNumber(v, { minimumFractionDigits: 0, maximumFractionDigits: 4 })}%`;

  return [
    `${emojiForCrypto(item.slug)} | ${item.slug} (${item.name})`,
    '',
    `💰| Price Toman: ${formatNumber(item.toman)} Toman`,
    `🇺🇸| Price USD: ${formatNumber(item.price, { minimumFractionDigits: 0, maximumFractionDigits: 8 })} $`,
    '',
    `${trendEmoji(item.change_24h)} | Change 24h: ${pct(item.change_24h)}`,
    `${trendEmoji(item.change_1h)} | Change 1h: ${pct(item.change_1h)}`,
    `${trendEmoji(item.change_7d)} | Change 7d: ${pct(item.change_7d)}`,
    `${trendEmoji(item.change_30d)} | Change 30d: ${pct(item.change_30d)}`,
    `${trendEmoji(item.change_90d)} | Change 90d: ${pct(item.change_90d)}`,
    `${trendEmoji(item.change_365d)} | Change 365d: ${pct(item.change_365d)}`,
    '',
    `${trendEmoji(item.toman24hchange)} | Toman 24h change: ${pct(item.toman24hchange)}`,
  ].join('\n');
};

const buildCalculatorResult = (query, snapshot) => {
  const match = query.match(calculatorRegex);
  if (!match) return null;

  const amount = Number(match[1]);
  const from = String(match[2]).toUpperCase();
  const to = String(match[3]).toUpperCase();
  const rates = buildRateIndex(snapshot);

  if (!rates[from] || !rates[to] || !amount) {
    return {
      type: 'article',
      id: `calc-invalid-${Date.now()}`,
      title: 'Conversion unavailable',
      description: `Could not convert ${match[1]} ${from} to ${to}`,
      input_message_content: {
        message_text: `❌ Conversion unavailable for ${match[1]} ${from} to ${to}.` + FOOTER
      }
    };
  }

  const tomanValue = amount * rates[from];
  const result = tomanValue / rates[to];

  const text = `🧮 ${formatNumber(amount)} ${from} = ${formatNumber(result, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 8
  })} ${to}\n\nRate basis:\n1 ${from} = ${formatNumber(rates[from])} Toman\n1 ${to} = ${formatNumber(
    rates[to]
  )} Toman` + FOOTER;

  return {
    type: 'article',
    id: `calc-${from}-${to}-${Date.now()}`,
    title: `🧮 ${amount} ${from} → ${to}`,
    description: `= ${formatNumber(result)} ${to}`,
    input_message_content: { message_text: text }
  };
};

const includesSearch = (item, q) => {
  const haystack = `${item.slug || ''} ${item.name || ''}`.toLowerCase();
  return haystack.includes(q);
};

// --- Category keywords ---
const GOLD_KEYWORDS = ['gold'];
const CRYPTO_KEYWORDS = ['crypto'];
const CURRENCY_KEYWORDS = ['currency'];

const matchesCategory = (q, keywords) => keywords.some((kw) => q === kw || q.startsWith(kw));

// --- Build inline result items ---
const makeGoldResult = (item) => ({
  type: 'article',
  id: `gold-${item.slug}-${Date.now()}`,
  title: `🥇 ${item.name}`,
  description: `💲 ${formatNumber(item.price)} Toman | ${trendEmoji(item.dayChange)} ${item.dayChange}%`,
  input_message_content: {
    message_text: formatGoldText(item) + FOOTER
  }
});

const makeCurrencyResult = (item) => ({
  type: 'article',
  id: `cur-${item.slug}-${Date.now()}`,
  title: `${flagForCurrency(item.slug)} ${item.name} (${String(item.slug || '').toUpperCase()})`,
  description: `🔻 Sell: ${formatNumber(item.sell)} | 🔺 Buy: ${formatNumber(item.buy)} Toman`,
  input_message_content: {
    message_text: formatCurrencyText(item) + FOOTER
  }
});

const makeCryptoResult = (item) => ({
  type: 'article',
  id: `crypto-${item.slug}-${Date.now()}`,
  title: `${emojiForCrypto(item.slug)} ${item.slug} (${item.name})`,
  description: `💰 ${formatNumber(item.toman)} T | 🇺🇸 ${formatNumber(item.price)} $ | ${trendEmoji(item.change_24h)} ${item.change_24h}%`,
  input_message_content: {
    message_text: formatCryptoText(item) + FOOTER
  }
});

const buildCategoryMenu = () => [
  {
    type: 'article',
    id: `cat-gold-${Date.now()}`,
    title: '🥇 Gold & Coins',
    description: 'Type "gold" to see all gold & coin prices',
    input_message_content: {
      message_text: '🥇 Gold prices: search "gold"\n💱 Currencies: search "currency"\n🪙 Crypto: search "crypto"\n🧮 Convert: type "25 USD to EUR"' + FOOTER
    }
  },
  {
    type: 'article',
    id: `cat-currency-${Date.now()}`,
    title: '💱 Currencies',
    description: 'Type "currency" to see all fiat currency prices',
    input_message_content: {
      message_text: '🥇 Gold prices: search "gold"\n💱 Currencies: search "currency"\n🪙 Crypto: search "crypto"\n🧮 Convert: type "25 USD to EUR"' + FOOTER
    }
  },
  {
    type: 'article',
    id: `cat-crypto-${Date.now()}`,
    title: '🪙 Crypto',
    description: 'Type "crypto" to see all cryptocurrency prices',
    input_message_content: {
      message_text: '🥇 Gold prices: search "gold"\n💱 Currencies: search "currency"\n🪙 Crypto: search "crypto"\n🧮 Convert: type "25 USD to EUR"' + FOOTER
    }
  }
];

const buildSearchResults = (query, snapshot, offset) => {
  const q = query.trim().toLowerCase();
  const pageSize = 50;
  const startIdx = Number(offset) || 0;

  if (!q.length) {
    return { results: buildCategoryMenu(), nextOffset: '' };
  }

  if (matchesCategory(q, GOLD_KEYWORDS)) {
    const items = Object.values(snapshot.gold || {});
    const results = items.map((item) => makeGoldResult(item));
    return { results, nextOffset: '' };
  }

  if (matchesCategory(q, CURRENCY_KEYWORDS)) {
    const items = Object.values(snapshot.currencies || {});
    const page = items.slice(startIdx, startIdx + pageSize);
    const results = page.map((item) => makeCurrencyResult(item));
    const nextOffset = (startIdx + pageSize < items.length) ? String(startIdx + pageSize) : '';
    return { results, nextOffset };
  }

  if (matchesCategory(q, CRYPTO_KEYWORDS)) {
    const items = Object.values(snapshot.crypto || {});
    const results = items.slice(0, pageSize).map((item) => makeCryptoResult(item));
    return { results, nextOffset: '' };
  }

  const goldItems = Object.values(snapshot.gold || {}).filter((item) => includesSearch(item, q));
  const currencyItems = Object.values(snapshot.currencies || {}).filter((item) => includesSearch(item, q));
  const cryptoItems = Object.values(snapshot.crypto || {}).filter((item) => includesSearch(item, q));

  const results = [
    ...goldItems.map((item) => makeGoldResult(item)),
    ...currencyItems.map((item) => makeCurrencyResult(item)),
    ...cryptoItems.map((item) => makeCryptoResult(item))
  ].slice(0, pageSize);

  return { results, nextOffset: '' };
};

// --- Helper: find item by slug across all categories ---
const findItem = (slug, snapshot) => {
  const s = slug.toLowerCase();
  const gold = Object.values(snapshot.gold || {}).find((i) => i.slug?.toLowerCase() === s);
  if (gold) return { item: gold, category: 'gold' };
  const cur = Object.values(snapshot.currencies || {}).find((i) => i.slug?.toLowerCase() === s);
  if (cur) return { item: cur, category: 'currency' };
  const crypto = Object.values(snapshot.crypto || {}).find((i) => i.slug?.toLowerCase() === s);
  if (crypto) return { item: crypto, category: 'crypto' };
  return null;
};

// --- Helper: get item price for alerts/portfolio ---
const getItemPrice = (item, category) => {
  if (category === 'gold') return Number(item.price) || 0;
  if (category === 'currency') return Number(item.sell) || 0;
  if (category === 'crypto') return Number(item.toman) || 0;
  return 0;
};

// ==================== COMMANDS ====================

// --- /start ---
bot.command('start', (ctx) => {
  ctx.reply(
    '👋 Welcome to PoolPricer Bot!\n\n' +
    '📌 Commands:\n' +
    '/price [slug] — Get price (e.g. /price usd)\n' +
    '/gold — Gold & coin prices\n' +
    '/crypto — Cryptocurrency prices\n' +
    '/currency — Fiat currency prices\n' +
    '/symbols — List all available symbols\n' +
    '/compare [slugs] — Compare (e.g. /compare usd eur gbp)\n' +
    '/top — Top gainers & losers\n' +
    '/alert [slug] [>|<] [price] — Price alert\n' +
    '/myalerts — Active alerts\n' +
    '/delalert [id] — Delete alert\n' +
    '/portfolio — View portfolio\n' +
    '/addportfolio [slug] [amount] — Add to portfolio\n' +
    '/delportfolio [slug] — Remove from portfolio\n' +
    '/summary — Market summary\n\n' +
    '🔎 Inline: Type @poolpricerbot in any chat\n' +
    '🧮 Convert: @poolpricerbot 25 USD to EUR' + FOOTER
  );
});

// --- /help ---
bot.command('help', (ctx) => {
  ctx.reply(
    '📖 Bot Help\n\n' +
    '/price usd — USD price\n' +
    '/price btc — Bitcoin price\n' +
    '/price sekkeh — Gold coin price\n' +
    '/gold — All gold & coins\n' +
    '/crypto — All cryptocurrencies\n' +
    '/currency — All fiat currencies\n' +
    '/symbols — List all symbols\n' +
    '/compare usd eur gbp — Compare\n' +
    '/top — Top gainers & losers\n' +
    '/alert usd > 170000 — Alert when USD goes above 170,000\n' +
    '/alert btc < 50000000 — Alert when BTC drops below 50M\n' +
    '/myalerts — My alerts\n' +
    '/addportfolio btc 0.5 — Add 0.5 BTC to portfolio\n' +
    '/addportfolio sekkeh 2 — Add 2 gold coins\n' +
    '/portfolio — Portfolio value\n' +
    '/summary — Market summary' + FOOTER
  );
});

// --- /price [slug] ---
bot.command('price', (ctx) => {
  const slug = (ctx.message.text.split(' ')[1] || '').trim().toLowerCase();
  if (!slug) return ctx.reply('❌ Please enter a symbol\nExample: /price usd' + FOOTER);

  const snapshot = getSnapshot();
  const found = findItem(slug, snapshot);
  if (!found) return ctx.reply(`❌ Symbol "${slug}" not found\n\nUse /symbols to see all available symbols` + FOOTER);

  let text;
  if (found.category === 'gold') text = formatGoldText(found.item);
  else if (found.category === 'currency') text = formatCurrencyText(found.item);
  else text = formatCryptoText(found.item);

  ctx.reply(text + FOOTER);
});

// --- /symbols ---
bot.command('symbols', (ctx) => {
  const snapshot = getSnapshot();
  const lines = [];

  const goldItems = Object.values(snapshot.gold || {});
  if (goldItems.length) {
    lines.push('🥇 Gold & Coins:');
    lines.push(goldItems.map((i) => `  ${i.slug} — ${i.name}`).join('\n'));
    lines.push('');
  }

  const curItems = Object.values(snapshot.currencies || {});
  if (curItems.length) {
    lines.push('💱 Currencies:');
    lines.push(curItems.map((i) => `  ${i.slug} — ${i.name}`).join('\n'));
    lines.push('');
  }

  const cryptoItems = Object.values(snapshot.crypto || {});
  if (cryptoItems.length) {
    lines.push('🪙 Crypto:');
    lines.push(cryptoItems.map((i) => `  ${i.slug} — ${i.name}`).join('\n'));
  }

  if (!lines.length) return ctx.reply('⏳ Data not loaded yet...' + FOOTER);
  ctx.reply('📋 Available Symbols\n\n' + lines.join('\n') + '\n\nUsage: /price [slug] or /addportfolio [slug] [amount]' + FOOTER);
});

// --- /gold ---
bot.command('gold', (ctx) => {
  const snapshot = getSnapshot();
  const items = Object.values(snapshot.gold || {});
  if (!items.length) return ctx.reply('⏳ Data not loaded yet...' + FOOTER);

  const lines = items.map((item) => {
    const unit = USD_GOLD_SLUGS.has(String(item.slug || '').toLowerCase()) ? '$' : 'T';
    return `🥇 ${item.name}: \`${formatNumber(item.price)}\` ${unit}`;
  });
  ctx.reply('🥇 Gold & Coin Prices\n\n' + lines.join('\n') + FOOTER, { parse_mode: 'Markdown' });
});

// --- /crypto ---
bot.command('crypto', (ctx) => {
  const snapshot = getSnapshot();
  const items = Object.values(snapshot.crypto || {});
  if (!items.length) return ctx.reply('⏳ Data not loaded yet...' + FOOTER);

  const lines = items.slice(0, 40).map((item) =>
    `${emojiForCrypto(item.slug)} ${item.slug}: \`${formatNumber(item.toman)}\` T`
  );
  ctx.reply('🪙 Cryptocurrency Prices\n\n' + lines.join('\n') + FOOTER, { parse_mode: 'Markdown' });
});

// --- /currency ---
bot.command('currency', (ctx) => {
  const snapshot = getSnapshot();
  const items = Object.values(snapshot.currencies || {});
  if (!items.length) return ctx.reply('⏳ Data not loaded yet...' + FOOTER);

  const lines = items.map((item) =>
    `${flagForCurrency(item.slug)} ${item.name}: \`${formatNumber(item.sell)}\` T`
  );
  ctx.reply('💱 Currency Prices\n\n' + lines.join('\n') + FOOTER, { parse_mode: 'Markdown' });
});

// --- /compare [slug1] [slug2] ... ---
bot.command('compare', (ctx) => {
  const parts = ctx.message.text.split(/\s+/).slice(1);
  if (parts.length < 2) return ctx.reply('❌ Enter at least 2 symbols\nExample: /compare usd eur gbp' + FOOTER);

  const snapshot = getSnapshot();
  const lines = [];

  for (const slug of parts) {
    const found = findItem(slug.toLowerCase(), snapshot);
    if (!found) {
      lines.push(`❌ ${slug.toUpperCase()}: Not found`);
      continue;
    }
    const { item, category } = found;
    if (category === 'gold') {
      const unit = USD_GOLD_SLUGS.has(item.slug?.toLowerCase()) ? '$' : 'Toman';
      lines.push(`🥇 ${item.name}: ${formatNumber(item.price)} ${unit}`);
    } else if (category === 'currency') {
      lines.push(`${flagForCurrency(item.slug)} ${item.name}: Sell ${formatNumber(item.sell)} T | Buy ${formatNumber(item.buy)} T`);
    } else {
      lines.push(`${emojiForCrypto(item.slug)} ${item.slug}: ${formatNumber(item.toman)} T | $${formatNumber(item.price)}`);
    }
  }

  ctx.reply('📊 Price Comparison\n\n' + lines.join('\n') + FOOTER);
});

// --- /top ---
bot.command('top', (ctx) => {
  const snapshot = getSnapshot();
  const items = Object.values(snapshot.crypto || {});
  if (!items.length) return ctx.reply('⏳ Data not loaded yet...' + FOOTER);

  const sorted = [...items].sort((a, b) => Number(b.change_24h || 0) - Number(a.change_24h || 0));
  const gainers = sorted.slice(0, 10);
  const losers = sorted.slice(-10).reverse();

  const gLines = gainers.map((i, idx) => `${idx + 1}. ${emojiForCrypto(i.slug)} ${i.slug}: ${formatNumber(i.toman)} T | 🟢 +${i.change_24h}%`);
  const lLines = losers.map((i, idx) => `${idx + 1}. ${emojiForCrypto(i.slug)} ${i.slug}: ${formatNumber(i.toman)} T | 🔴 ${i.change_24h}%`);

  ctx.reply(
    '🏆 Top 10 Gainers (24h)\n\n' + gLines.join('\n') +
    '\n\n📉 Top 10 Losers (24h)\n\n' + lLines.join('\n') + FOOTER
  );
});

// --- /alert [slug] [>|<] [price] ---
bot.command('alert', (ctx) => {
  const parts = ctx.message.text.split(/\s+/).slice(1);
  if (parts.length < 3) return ctx.reply('❌ Format: /alert usd > 170000\n\n> = when price goes above\n< = when price goes below' + FOOTER);

  const slug = parts[0].toLowerCase();
  const direction = parts[1];
  const targetPrice = Number(parts[2].replace(/,/g, ''));

  if (direction !== '>' && direction !== '<') return ctx.reply('❌ Direction must be > or <' + FOOTER);
  if (!targetPrice || isNaN(targetPrice)) return ctx.reply('❌ Invalid price' + FOOTER);

  const snapshot = getSnapshot();
  const found = findItem(slug, snapshot);
  if (!found) return ctx.reply(`❌ Symbol "${slug}" not found` + FOOTER);

  addAlert(ctx.from.id, ctx.chat.id, slug, found.category, direction, targetPrice);
  const dirText = direction === '>' ? 'goes above' : 'drops below';
  ctx.reply(`✅ Alert set!\n\n🔔 ${slug.toUpperCase()} — will notify when it ${dirText} ${formatNumber(targetPrice)}` + FOOTER);
});

// --- /myalerts ---
bot.command('myalerts', (ctx) => {
  const alerts = getUserAlerts(ctx.from.id);
  if (!alerts.length) return ctx.reply('📭 No active alerts' + FOOTER);

  const lines = alerts.map((a) => {
    return `🔔 #${a.id} | ${a.slug.toUpperCase()} ${a.direction} ${formatNumber(a.target_price)}`;
  });
  ctx.reply('🔔 Active Alerts:\n\n' + lines.join('\n') + '\n\nTo delete: /delalert [id]' + FOOTER);
});

// --- /delalert [id] ---
bot.command('delalert', (ctx) => {
  const id = Number(ctx.message.text.split(' ')[1]);
  if (!id) return ctx.reply('❌ Format: /delalert 5' + FOOTER);

  const result = deleteAlert(id, ctx.from.id);
  if (result.changes > 0) {
    ctx.reply(`✅ Alert #${id} deleted` + FOOTER);
  } else {
    ctx.reply(`❌ Alert #${id} not found or not yours` + FOOTER);
  }
});

// --- /addportfolio [slug] [amount] or [amount] [slug] ---
bot.command('addportfolio', (ctx) => {
  const parts = ctx.message.text.split(/\s+/).slice(1);
  if (parts.length < 2) return ctx.reply('❌ Format: /addportfolio btc 0.5\nOr: /addportfolio 0.5 btc' + FOOTER);

  let slug, amount;
  if (isNaN(parts[0])) {
    slug = parts[0].toLowerCase();
    amount = Number(parts[1]);
  } else {
    amount = Number(parts[0]);
    slug = parts[1].toLowerCase();
  }
  if (!amount || isNaN(amount) || amount <= 0) return ctx.reply('❌ Invalid amount' + FOOTER);

  const snapshot = getSnapshot();
  const found = findItem(slug, snapshot);
  if (!found) return ctx.reply(`❌ Symbol "${slug}" not found\n\nSee all symbols: /symbols` + FOOTER);

  setPortfolioItem(ctx.from.id, slug, found.category, amount);
  ctx.reply(`✅ Added ${amount} ${slug.toUpperCase()} to portfolio` + FOOTER);
});

// --- /delportfolio [slug] ---
bot.command('delportfolio', (ctx) => {
  const slug = (ctx.message.text.split(' ')[1] || '').toLowerCase();
  if (!slug) return ctx.reply('❌ Format: /delportfolio btc' + FOOTER);

  setPortfolioItem(ctx.from.id, slug, '', 0);
  ctx.reply(`✅ ${slug.toUpperCase()} removed from portfolio` + FOOTER);
});

// --- /portfolio ---
bot.command('portfolio', (ctx) => {
  const items = getPortfolio(ctx.from.id);
  if (!items.length) return ctx.reply('📭 Portfolio is empty\n\nTo add: /addportfolio btc 0.5' + FOOTER);

  const snapshot = getSnapshot();
  let totalToman = 0;
  const lines = [];

  for (const p of items) {
    const found = findItem(p.slug, snapshot);
    if (!found) {
      lines.push(`❓ ${p.slug.toUpperCase()}: ${p.amount} (price unknown)`);
      continue;
    }
    const price = getItemPrice(found.item, found.category);
    const value = price * p.amount;
    totalToman += value;
    lines.push(`${p.slug.toUpperCase()}: ${p.amount} x ${formatNumber(price)} = ${formatNumber(value)} T`);
  }

  ctx.reply(
    '💼 Portfolio\n\n' + lines.join('\n') +
    `\n\n💰 Total Value: ${formatNumber(totalToman)} Toman` + FOOTER
  );
});

// --- /summary ---
bot.command('summary', (ctx) => {
  const snapshot = getSnapshot();
  sendFullSummary(ctx.chat.id, snapshot);
});

// ==================== CHANNEL AUTO-POST ====================
const CHANNEL_ID = process.env.CHANNEL_ID || '@poolpricer';
const CHANNEL_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

// Build separate message texts
const buildGoldText = (snapshot) => {
  const items = Object.values(snapshot.gold || {});
  if (!items.length) return null;
  const lines = items.map((item) => {
    const unit = USD_GOLD_SLUGS.has(String(item.slug || '').toLowerCase()) ? '$' : 'T';
    return `  ${item.name}: \`${formatNumber(item.price)}\` ${unit}`;
  });
  return '🥇 Gold & Coin Prices\n\n' + lines.join('\n') + FOOTER;
};

const buildCryptoText = (snapshot) => {
  const items = Object.values(snapshot.crypto || {});
  if (!items.length) return null;
  const lines = items.map((item) =>
    `  ${emojiForCrypto(item.slug)} ${item.slug}: \`${formatNumber(item.toman)}\` T`
  );
  return '🪙 Cryptocurrency Prices\n\n' + lines.join('\n') + FOOTER;
};

const buildCurrencyText = (snapshot) => {
  const items = Object.values(snapshot.currencies || {});
  if (!items.length) return null;
  const lines = items.map((item) =>
    `  ${flagForCurrency(item.slug)} ${item.name}: \`${formatNumber(item.sell)}\` T`
  );
  return '💱 Currency Prices\n\n' + lines.join('\n') + FOOTER;
};

const buildTopText = (snapshot) => {
  const items = Object.values(snapshot.crypto || {});
  if (!items.length) return null;
  const sorted = [...items].sort((a, b) => Number(b.change_24h || 0) - Number(a.change_24h || 0));
  const gainers = sorted.slice(0, 10);
  const losers = sorted.slice(-10).reverse();
  const gLines = gainers.map((i, idx) => `${idx + 1}. ${emojiForCrypto(i.slug)} ${i.slug} 🟢 +${i.change_24h}%`);
  const lLines = losers.map((i, idx) => `${idx + 1}. ${emojiForCrypto(i.slug)} ${i.slug} 🔴 ${i.change_24h}%`);
  return '🏆 Top 10 Gainers (24h)\n\n' + gLines.join('\n') +
    '\n\n� Top 10 Losers (24h)\n\n' + lLines.join('\n') + FOOTER;
};

// Send full summary as separate messages
const sendFullSummary = async (chatId, snapshot) => {
  const messages = [
    buildGoldText(snapshot),
    buildCurrencyText(snapshot),
    buildCryptoText(snapshot),
    buildTopText(snapshot)
  ].filter(Boolean);

  for (const msg of messages) {
    try {
      await bot.telegram.sendMessage(chatId, msg, { parse_mode: 'Markdown' });
    } catch (e) {
      console.error(`[summary] send failed to ${chatId}:`, e.message);
    }
  }
};

// ==================== GROUP COMMANDS ====================

// --- /setsummary [minutes] ---
bot.command('setsummary', async (ctx) => {
  if (ctx.chat.type === 'private') return ctx.reply('❌ This command only works in groups' + FOOTER);

  const member = await ctx.getChatMember(ctx.from.id);
  if (!['creator', 'administrator'].includes(member.status)) {
    return ctx.reply('❌ Only admins can use this command' + FOOTER);
  }

  const minutes = Number(ctx.message.text.split(' ')[1]);
  if (!minutes || minutes < 1) return ctx.reply('❌ Format: /setsummary 60\n(minutes, minimum 1)' + FOOTER);

  setGroupSummaryInterval(ctx.chat.id, minutes);
  ctx.reply(`✅ Market summary will be sent every ${minutes} minutes` + FOOTER);
});

// --- /stopsummary ---
bot.command('stopsummary', async (ctx) => {
  if (ctx.chat.type === 'private') return ctx.reply('❌ This command only works in groups' + FOOTER);

  const member = await ctx.getChatMember(ctx.from.id);
  if (!['creator', 'administrator'].includes(member.status)) {
    return ctx.reply('❌ Only admins can use this command' + FOOTER);
  }

  disableGroupSummary(ctx.chat.id);
  ctx.reply('✅ Auto summary stopped' + FOOTER);
});

// --- /groupalert [slug] [>|<] [price] ---
bot.command('groupalert', async (ctx) => {
  if (ctx.chat.type === 'private') return ctx.reply('❌ This command only works in groups' + FOOTER);

  const member = await ctx.getChatMember(ctx.from.id);
  if (!['creator', 'administrator'].includes(member.status)) {
    return ctx.reply('❌ Only admins can use this command' + FOOTER);
  }

  const parts = ctx.message.text.split(/\s+/).slice(1);
  if (parts.length < 3) return ctx.reply('❌ Format: /groupalert usd > 170000' + FOOTER);

  const slug = parts[0].toLowerCase();
  const direction = parts[1];
  const targetPrice = Number(parts[2].replace(/,/g, ''));

  if (direction !== '>' && direction !== '<') return ctx.reply('❌ Direction must be > or <' + FOOTER);
  if (!targetPrice || isNaN(targetPrice)) return ctx.reply('❌ Invalid price' + FOOTER);

  const snapshot = getSnapshot();
  const found = findItem(slug, snapshot);
  if (!found) return ctx.reply(`❌ Symbol "${slug}" not found` + FOOTER);

  addGroupAlert(ctx.chat.id, slug, found.category, direction, targetPrice);
  const dirText = direction === '>' ? 'goes above' : 'drops below';
  ctx.reply(`✅ Group alert set!\n\n🔔 ${slug.toUpperCase()} — will notify when it ${dirText} ${formatNumber(targetPrice)}` + FOOTER);
});

// --- /groupalerts ---
bot.command('groupalerts', (ctx) => {
  if (ctx.chat.type === 'private') return ctx.reply('❌ This command only works in groups' + FOOTER);

  const alerts = getGroupAlerts(ctx.chat.id);
  if (!alerts.length) return ctx.reply('📭 No active group alerts' + FOOTER);

  const lines = alerts.map((a) => `🔔 #${a.id} | ${a.slug.toUpperCase()} ${a.direction} ${formatNumber(a.target_price)}`);
  ctx.reply('🔔 Group Alerts:\n\n' + lines.join('\n') + '\n\nTo delete: /delgroupalert [id]' + FOOTER);
});

// --- /delgroupalert [id] ---
bot.command('delgroupalert', async (ctx) => {
  if (ctx.chat.type === 'private') return ctx.reply('❌ This command only works in groups' + FOOTER);

  const member = await ctx.getChatMember(ctx.from.id);
  if (!['creator', 'administrator'].includes(member.status)) {
    return ctx.reply('❌ Only admins can use this command' + FOOTER);
  }

  const id = Number(ctx.message.text.split(' ')[1]);
  if (!id) return ctx.reply('❌ Format: /delgroupalert 5' + FOOTER);

  const result = deleteGroupAlert(id, ctx.chat.id);
  if (result.changes > 0) {
    ctx.reply(`✅ Group alert #${id} deleted` + FOOTER);
  } else {
    ctx.reply(`❌ Alert #${id} not found or not from this group` + FOOTER);
  }
});

// ==================== ALERT CHECKER (user + group) ====================
setInterval(() => {
  try {
    const snapshot = getSnapshot();

    // User alerts
    const alerts = getActiveAlerts();
    for (const alert of alerts) {
      const found = findItem(alert.slug, snapshot);
      if (!found) continue;
      const currentPrice = getItemPrice(found.item, found.category);
      if (!currentPrice) continue;
      const triggered =
        (alert.direction === '>' && currentPrice >= alert.target_price) ||
        (alert.direction === '<' && currentPrice <= alert.target_price);
      if (triggered) {
        triggerAlert(alert.id);
        const dirText = alert.direction === '>' ? 'above' : 'below';
        bot.telegram.sendMessage(
          alert.chat_id,
          `🔔 Alert Triggered!\n\n${alert.slug.toUpperCase()} reached ${formatNumber(currentPrice)}!\n(${dirText} ${formatNumber(alert.target_price)})` + FOOTER
        ).catch((e) => console.error('[alert] send failed:', e.message));
      }
    }

    // Group alerts
    const groupAlerts = getActiveGroupAlerts();
    for (const alert of groupAlerts) {
      const found = findItem(alert.slug, snapshot);
      if (!found) continue;
      const currentPrice = getItemPrice(found.item, found.category);
      if (!currentPrice) continue;
      const triggered =
        (alert.direction === '>' && currentPrice >= alert.target_price) ||
        (alert.direction === '<' && currentPrice <= alert.target_price);
      if (triggered) {
        triggerGroupAlert(alert.id);
        const dirText = alert.direction === '>' ? 'above' : 'below';
        bot.telegram.sendMessage(
          alert.chat_id,
          `🔔 Group Alert!\n\n${alert.slug.toUpperCase()} reached ${formatNumber(currentPrice)}!\n(${dirText} ${formatNumber(alert.target_price)})` + FOOTER
        ).catch((e) => console.error('[group-alert] send failed:', e.message));
      }
    }
  } catch (e) {
    console.error('[alert-checker] error:', e.message);
  }
}, 60 * 1000);

// ==================== AUTO-POST: Channel + Groups ====================
let lastChannelPostAt = 0;

setInterval(() => {
  try {
    const snapshot = getSnapshot();
    const now = Date.now();

    // Channel auto-post (every 15 min — separate messages)
    if (CHANNEL_ID && now - lastChannelPostAt >= CHANNEL_INTERVAL_MS) {
      lastChannelPostAt = now;
      sendFullSummary(CHANNEL_ID, snapshot)
        .then(() => console.log('[channel] summary posted'))
        .catch((e) => console.error('[channel] post failed:', e.message));
    }

    // Group auto-summaries
    const groups = getActiveGroupSummaries();
    for (const group of groups) {
      const lastAt = group.last_summary_at ? new Date(group.last_summary_at).getTime() : 0;
      const intervalMs = group.summary_interval_min * 60 * 1000;
      if (now - lastAt >= intervalMs) {
        updateGroupLastSummary(group.chat_id);
        sendFullSummary(group.chat_id, snapshot)
          .then(() => console.log(`[group] summary posted to ${group.chat_id}`))
          .catch((e) => console.error(`[group] post failed for ${group.chat_id}:`, e.message));
      }
    }
  } catch (e) {
    console.error('[auto-post] error:', e.message);
  }
}, 60 * 1000);

// ==================== INLINE QUERY ====================

bot.on('inline_query', async (ctx) => {
  const query = ctx.inlineQuery.query || '';
  const snapshot = getSnapshot();

  const dataCount = Object.keys(snapshot.gold).length +
    Object.keys(snapshot.crypto).length +
    Object.keys(snapshot.currencies).length;

  if (dataCount === 0) {
    console.warn('[inline_query] cache is empty, data not loaded yet');
    await ctx.answerInlineQuery(
      [{
        type: 'article',
        id: `loading-${Date.now()}`,
        title: '⏳ Loading data...',
        description: 'Please wait a few seconds and try again',
        input_message_content: {
          message_text: '⏳ Data is loading, please try again in a few seconds.' + FOOTER
        }
      }],
      { cache_time: 2, is_personal: true }
    );
    return;
  }

  try {
    const calculatorResult = buildCalculatorResult(query, snapshot);
    if (calculatorResult) {
      await ctx.answerInlineQuery([calculatorResult], { cache_time: 5, is_personal: true });
      return;
    }

    const offset = ctx.inlineQuery.offset || '';
    const { results, nextOffset } = buildSearchResults(query, snapshot, offset);
    console.log(`[inline_query] q="${query}" offset="${offset}" results=${results.length}`);

    if (!results.length) {
      await ctx.answerInlineQuery(
        [
          {
            type: 'article',
            id: `empty-${Date.now()}`,
            title: 'No results found',
            description: 'Try searching by slug, symbol, or name',
            input_message_content: {
              message_text: 'No matching asset found.' + FOOTER
            }
          }
        ],
        { cache_time: 3, is_personal: true }
      );
      return;
    }

    await ctx.answerInlineQuery(results, {
      cache_time: 3,
      is_personal: true,
      next_offset: nextOffset
    });
  } catch (error) {
    console.error('[inline_query] error:', error.message);
    if (error.response?.description) {
      console.error('[inline_query] telegram error detail:', error.response.description);
    }
    try {
      await ctx.answerInlineQuery(
        [
          {
            type: 'article',
            id: `error-${Date.now()}`,
            title: 'Temporary error',
            description: 'Please try again in a few seconds',
            input_message_content: {
              message_text: '⚠️ Temporary error. Please try again shortly.' + FOOTER
            }
          }
        ],
        { cache_time: 1, is_personal: true }
      );
    } catch (innerErr) {
      console.error('[inline_query] failed to send error response:', innerErr.message);
    }
  }
});

startBackgroundJobs();

bot
  .launch()
  .then(() => console.log('🤖 Price inline bot is running...'))
  .catch((error) => console.error('Failed to launch bot:', error.message));

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
