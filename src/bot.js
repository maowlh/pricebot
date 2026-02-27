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
  lines.push('', 'Dev | maowlh');
  return lines.join('\n');
};

const formatCurrencyText = (item) => {
  const changeEmoji = trendEmoji(item.dayChange);
  return [
    `${flagForCurrency(item.slug)} | ${item.name} (${String(item.slug || '').toUpperCase()})`,
    '',
    `🇮🇷🔻| Toman (SELL): ${formatNumber(item.sell)} Toman`,
    `🇮🇷🔺| Toman (BUY): ${formatNumber(item.buy)} Toman`,
    '',
    `🇺🇸| Price Usd: ${formatNumber(item.dolar_rate, { minimumFractionDigits: 0, maximumFractionDigits: 6 })} $`,
    '',
    `➕| Open: ${formatNumber(item.open)} Toman`,
    `🔺| High: ${formatNumber(item.high)} Toman`,
    `🔻| Low: ${formatNumber(item.low)} Toman`,
    '',
    `${changeEmoji} | Day Change: ${formatNumber(item.dayChange, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}%`,
    '',
    'Dev | maowlh'
  ].join('\n');
};

const formatCryptoText = (item) => {
  const pct = (v) =>
    `${formatNumber(v, { minimumFractionDigits: 0, maximumFractionDigits: 4 })}%`;

  return [
    `${emojiForCrypto(item.slug)} | ${item.slug} (${item.name})`,
    '',
    `🇮🇷| Price Toman: ${formatNumber(item.toman)} Toman`,
    `🇺🇸| Price Usd: ${formatNumber(item.price, { minimumFractionDigits: 0, maximumFractionDigits: 8 })} $`,
    '',
    `${trendEmoji(item.change_24h)} | Change 24h: ${pct(item.change_24h)}`,
    `${trendEmoji(item.change_1h)} | Change 1h: ${pct(item.change_1h)}`,
    `${trendEmoji(item.change_7d)} | Change 7d: ${pct(item.change_7d)}`,
    `${trendEmoji(item.change_30d)} | Change 30d: ${pct(item.change_30d)}`,
    `${trendEmoji(item.change_90d)} | Change 90d: ${pct(item.change_90d)}`,
    `${trendEmoji(item.change_365d)} | Change 365d: ${pct(item.change_365d)}`,
    '',
    `${trendEmoji(item.toman24hchange)} | Toman 24h change: ${pct(item.toman24hchange)}`,
    '',
    'Dev | maowlh'
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
        message_text: `❌ Conversion unavailable for ${match[1]} ${from} to ${to}.`
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
  )} Toman\n\nDev | maowlh`;

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
const GOLD_KEYWORDS = ['gold', 'طلا', 'سکه'];
const CRYPTO_KEYWORDS = ['crypto', 'کریپتو', 'رمزارز'];
const CURRENCY_KEYWORDS = ['currency', 'ارز', 'فیات', 'دلار'];

const matchesCategory = (q, keywords) => keywords.some((kw) => q === kw || q.startsWith(kw));

// --- Build inline result items ---
const makeGoldResult = (item) => ({
  type: 'article',
  id: `gold-${item.slug}-${Date.now()}`,
  title: `🥇 ${item.name}`,
  description: `💲 ${formatNumber(item.price)} Toman | ${trendEmoji(item.dayChange)} ${item.dayChange}%`,
  input_message_content: {
    message_text: formatGoldText(item)
  }
});

const makeCurrencyResult = (item) => ({
  type: 'article',
  id: `cur-${item.slug}-${Date.now()}`,
  title: `${flagForCurrency(item.slug)} ${item.name} (${String(item.slug || '').toUpperCase()})`,
  description: `🔻 Sell: ${formatNumber(item.sell)} | 🔺 Buy: ${formatNumber(item.buy)} Toman`,
  input_message_content: {
    message_text: formatCurrencyText(item)
  }
});

const makeCryptoResult = (item) => ({
  type: 'article',
  id: `crypto-${item.slug}-${Date.now()}`,
  title: `${emojiForCrypto(item.slug)} ${item.slug} (${item.name})`,
  description: `🇮🇷 ${formatNumber(item.toman)} T | 🇺🇸 ${formatNumber(item.price)} $ | ${trendEmoji(item.change_24h)} ${item.change_24h}%`,
  input_message_content: {
    message_text: formatCryptoText(item)
  }
});

const buildCategoryMenu = () => [
  {
    type: 'article',
    id: `cat-gold-${Date.now()}`,
    title: '🥇 Gold & Coins (طلا و سکه)',
    description: 'Type "gold" to see all gold & coin prices',
    input_message_content: {
      message_text: '🥇 To see gold prices, search: gold\n💱 To see currencies, search: currency\n🪙 To see crypto, search: crypto\n🧮 To convert, type: 25 USD to EUR\n\nDev | maowlh'
    }
  },
  {
    type: 'article',
    id: `cat-currency-${Date.now()}`,
    title: '💱 Currencies (ارز)',
    description: 'Type "currency" to see all fiat currency prices',
    input_message_content: {
      message_text: '🥇 To see gold prices, search: gold\n💱 To see currencies, search: currency\n🪙 To see crypto, search: crypto\n🧮 To convert, type: 25 USD to EUR\n\nDev | maowlh'
    }
  },
  {
    type: 'article',
    id: `cat-crypto-${Date.now()}`,
    title: '🪙 Crypto (رمزارز)',
    description: 'Type "crypto" to see all cryptocurrency prices',
    input_message_content: {
      message_text: '🥇 To see gold prices, search: gold\n💱 To see currencies, search: currency\n🪙 To see crypto, search: crypto\n🧮 To convert, type: 25 USD to EUR\n\nDev | maowlh'
    }
  }
];

const buildSearchResults = (query, snapshot, offset) => {
  const q = query.trim().toLowerCase();
  const pageSize = 50;
  const startIdx = Number(offset) || 0;

  // Empty query: show category menu
  if (!q.length) {
    return { results: buildCategoryMenu(), nextOffset: '' };
  }

  // Category: gold
  if (matchesCategory(q, GOLD_KEYWORDS)) {
    const items = Object.values(snapshot.gold || {});
    const results = items.map((item) => makeGoldResult(item));
    return { results, nextOffset: '' };
  }

  // Category: currency
  if (matchesCategory(q, CURRENCY_KEYWORDS)) {
    const items = Object.values(snapshot.currencies || {});
    const page = items.slice(startIdx, startIdx + pageSize);
    const results = page.map((item) => makeCurrencyResult(item));
    const nextOffset = (startIdx + pageSize < items.length) ? String(startIdx + pageSize) : '';
    return { results, nextOffset };
  }

  // Category: crypto
  if (matchesCategory(q, CRYPTO_KEYWORDS)) {
    const items = Object.values(snapshot.crypto || {});
    const results = items.slice(0, pageSize).map((item) => makeCryptoResult(item));
    return { results, nextOffset: '' };
  }

  // General search: search all 3 categories by slug/name
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

// --- Helper: format last updated timestamp ---
const lastUpdatedText = (snapshot) => {
  if (!snapshot.lastUpdatedAt) return '';
  const diff = Math.round((Date.now() - new Date(snapshot.lastUpdatedAt).getTime()) / 60000);
  if (diff < 1) return '\n\n🕐 Updated: just now';
  return `\n\n🕐 Updated: ${diff} min ago`;
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
    '👋 سلام! به ربات قیمت خوش آمدید\n\n' +
    '📌 دستورات:\n' +
    '/price [slug] — قیمت یه ارز (مثلاً /price usd)\n' +
    '/gold — لیست قیمت طلا و سکه\n' +
    '/crypto — لیست قیمت رمزارزها\n' +
    '/currency — لیست قیمت ارزها\n' +
    '/compare [slugs] — مقایسه ارزها (مثلاً /compare usd eur gbp)\n' +
    '/top — بیشترین رشد و ریزش کریپتو\n' +
    '/alert [slug] [>|<] [price] — هشدار قیمت\n' +
    '/myalerts — لیست هشدارهای فعال\n' +
    '/delalert [id] — حذف هشدار\n' +
    '/portfolio — نمایش سبد دارایی\n' +
    '/addportfolio [slug] [amount] — اضافه به سبد\n' +
    '/delportfolio [slug] — حذف از سبد\n' +
    '/summary — خلاصه بازار\n\n' +
    '🔎 Inline: در هر چتی @poolpricerbot بزنید\n' +
    '🧮 تبدیل: @poolpricerbot 25 USD to EUR\n\n' +
    'Dev | maowlh'
  );
});

// --- /help ---
bot.command('help', (ctx) => {
  ctx.reply(
    '📖 راهنمای ربات قیمت\n\n' +
    '/price usd — قیمت دلار\n' +
    '/price btc — قیمت بیتکوین\n' +
    '/price sekkeh — قیمت سکه\n' +
    '/gold — همه طلا و سکه‌ها\n' +
    '/crypto — همه رمزارزها\n' +
    '/currency — همه ارزها\n' +
    '/compare usd eur gbp — مقایسه\n' +
    '/top — بهترین و بدترین کریپتوها\n' +
    '/alert usd > 170000 — هشدار وقتی دلار بالای ۱۷۰ هزار شد\n' +
    '/alert btc < 50000000 — هشدار وقتی بیتکوین زیر ۵۰ میلیون شد\n' +
    '/myalerts — هشدارهای من\n' +
    '/addportfolio btc 0.5 — اضافه کردن ۰.۵ بیتکوین به سبد\n' +
    '/addportfolio sekkeh 2 — اضافه کردن ۲ سکه به سبد\n' +
    '/portfolio — نمایش ارزش سبد\n' +
    '/summary — خلاصه بازار\n\n' +
    'Dev | maowlh'
  );
});

// --- /price [slug] ---
bot.command('price', (ctx) => {
  const slug = (ctx.message.text.split(' ')[1] || '').trim().toLowerCase();
  if (!slug) return ctx.reply('❌ لطفاً slug ارز رو وارد کن\nمثال: /price usd');

  const snapshot = getSnapshot();
  const found = findItem(slug, snapshot);
  if (!found) return ctx.reply(`❌ ارزی با slug "${slug}" پیدا نشد`);

  let text;
  if (found.category === 'gold') text = formatGoldText(found.item);
  else if (found.category === 'currency') text = formatCurrencyText(found.item);
  else text = formatCryptoText(found.item);

  ctx.reply(text + lastUpdatedText(snapshot));
});

// --- /symbols ---
bot.command('symbols', (ctx) => {
  const snapshot = getSnapshot();
  const lines = [];

  const goldItems = Object.values(snapshot.gold || {});
  if (goldItems.length) {
    lines.push('🥇 طلا و سکه:');
    lines.push(goldItems.map((i) => `  ${i.slug} — ${i.name}`).join('\n'));
    lines.push('');
  }

  const curItems = Object.values(snapshot.currencies || {});
  if (curItems.length) {
    lines.push('💱 ارزها:');
    lines.push(curItems.map((i) => `  ${i.slug} — ${i.name}`).join('\n'));
    lines.push('');
  }

  const cryptoItems = Object.values(snapshot.crypto || {});
  if (cryptoItems.length) {
    lines.push('🪙 رمزارزها:');
    lines.push(cryptoItems.map((i) => `  ${i.slug} — ${i.name}`).join('\n'));
  }

  if (!lines.length) return ctx.reply('⏳ دیتا هنوز لود نشده...');
  ctx.reply('📋 لیست سمبل‌ها\n\n' + lines.join('\n') + '\n\nاستفاده: /price [slug] یا /addportfolio [slug] [amount]\n\nDev | maowlh');
});

// --- /gold ---
bot.command('gold', (ctx) => {
  const snapshot = getSnapshot();
  const items = Object.values(snapshot.gold || {});
  if (!items.length) return ctx.reply('⏳ دیتا هنوز لود نشده...');

  const lines = items.map((item) => {
    const unit = USD_GOLD_SLUGS.has(String(item.slug || '').toLowerCase()) ? '$' : 'T';
    return `🥇 ${item.name}: ${formatNumber(item.price)} ${unit}`;
  });
  ctx.reply('🥇 قیمت طلا و سکه\n\n' + lines.join('\n') + lastUpdatedText(snapshot) + '\n\nDev | maowlh');
});

// --- /crypto ---
bot.command('crypto', (ctx) => {
  const snapshot = getSnapshot();
  const items = Object.values(snapshot.crypto || {});
  if (!items.length) return ctx.reply('⏳ دیتا هنوز لود نشده...');

  const lines = items.slice(0, 40).map((item) =>
    `${emojiForCrypto(item.slug)} ${item.slug}: ${formatNumber(item.toman)} T`
  );
  ctx.reply('🪙 قیمت رمزارزها\n\n' + lines.join('\n') + lastUpdatedText(snapshot) + '\n\nDev | maowlh');
});

// --- /currency ---
bot.command('currency', (ctx) => {
  const snapshot = getSnapshot();
  const items = Object.values(snapshot.currencies || {});
  if (!items.length) return ctx.reply('⏳ دیتا هنوز لود نشده...');

  const lines = items.map((item) =>
    `${flagForCurrency(item.slug)} ${item.name}: ${formatNumber(item.sell)} T`
  );
  ctx.reply('💱 قیمت ارزها\n\n' + lines.join('\n') + lastUpdatedText(snapshot) + '\n\nDev | maowlh');
});

// --- /compare [slug1] [slug2] ... ---
bot.command('compare', (ctx) => {
  const parts = ctx.message.text.split(/\s+/).slice(1);
  if (parts.length < 2) return ctx.reply('❌ حداقل ۲ ارز وارد کن\nمثال: /compare usd eur gbp');

  const snapshot = getSnapshot();
  const lines = [];

  for (const slug of parts) {
    const found = findItem(slug.toLowerCase(), snapshot);
    if (!found) {
      lines.push(`❌ ${slug.toUpperCase()}: پیدا نشد`);
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

  ctx.reply('📊 مقایسه ارزها\n\n' + lines.join('\n') + lastUpdatedText(snapshot) + '\n\nDev | maowlh');
});

// --- /top ---
bot.command('top', (ctx) => {
  const snapshot = getSnapshot();
  const items = Object.values(snapshot.crypto || {});
  if (!items.length) return ctx.reply('⏳ دیتا هنوز لود نشده...');

  const sorted = [...items].sort((a, b) => Number(b.change_24h || 0) - Number(a.change_24h || 0));
  const gainers = sorted.slice(0, 5);
  const losers = sorted.slice(-5).reverse();

  const gLines = gainers.map((i, idx) => `${idx + 1}. ${emojiForCrypto(i.slug)} ${i.slug}: ${formatNumber(i.toman)} T | 🟢 +${i.change_24h}%`);
  const lLines = losers.map((i, idx) => `${idx + 1}. ${emojiForCrypto(i.slug)} ${i.slug}: ${formatNumber(i.toman)} T | 🔴 ${i.change_24h}%`);

  ctx.reply(
    '🏆 بیشترین رشد ۲۴ ساعته\n\n' + gLines.join('\n') +
    '\n\n📉 بیشترین ریزش ۲۴ ساعته\n\n' + lLines.join('\n') +
    lastUpdatedText(snapshot) + '\n\nDev | maowlh'
  );
});

// --- /alert [slug] [>|<] [price] ---
bot.command('alert', (ctx) => {
  const parts = ctx.message.text.split(/\s+/).slice(1);
  if (parts.length < 3) return ctx.reply('❌ فرمت: /alert usd > 170000\n\n> = وقتی بالاتر رفت\n< = وقتی پایین‌تر اومد');

  const slug = parts[0].toLowerCase();
  const direction = parts[1];
  const targetPrice = Number(parts[2].replace(/,/g, ''));

  if (direction !== '>' && direction !== '<') return ctx.reply('❌ جهت باید > یا < باشه');
  if (!targetPrice || isNaN(targetPrice)) return ctx.reply('❌ قیمت نامعتبر');

  const snapshot = getSnapshot();
  const found = findItem(slug, snapshot);
  if (!found) return ctx.reply(`❌ ارزی با slug "${slug}" پیدا نشد`);

  addAlert(ctx.from.id, ctx.chat.id, slug, found.category, direction, targetPrice);
  const dirText = direction === '>' ? 'بالاتر از' : 'پایین‌تر از';
  ctx.reply(`✅ هشدار ثبت شد!\n\n🔔 ${slug.toUpperCase()} وقتی ${dirText} ${formatNumber(targetPrice)} بشه بهت خبر میدم`);
});

// --- /myalerts ---
bot.command('myalerts', (ctx) => {
  const alerts = getUserAlerts(ctx.from.id);
  if (!alerts.length) return ctx.reply('📭 هشدار فعالی نداری');

  const lines = alerts.map((a) => {
    const dirText = a.direction === '>' ? '>' : '<';
    return `🔔 #${a.id} | ${a.slug.toUpperCase()} ${dirText} ${formatNumber(a.target_price)}`;
  });
  ctx.reply('🔔 هشدارهای فعال:\n\n' + lines.join('\n') + '\n\nبرای حذف: /delalert [id]');
});

// --- /delalert [id] ---
bot.command('delalert', (ctx) => {
  const id = Number(ctx.message.text.split(' ')[1]);
  if (!id) return ctx.reply('❌ فرمت: /delalert 5');

  const result = deleteAlert(id, ctx.from.id);
  if (result.changes > 0) {
    ctx.reply(`✅ هشدار #${id} حذف شد`);
  } else {
    ctx.reply(`❌ هشدار #${id} پیدا نشد یا مال تو نیست`);
  }
});

// --- /addportfolio [slug] [amount] or [amount] [slug] ---
bot.command('addportfolio', (ctx) => {
  const parts = ctx.message.text.split(/\s+/).slice(1);
  if (parts.length < 2) return ctx.reply('❌ فرمت: /addportfolio btc 0.5\nیا: /addportfolio 0.5 btc');

  let slug, amount;
  if (isNaN(parts[0])) {
    slug = parts[0].toLowerCase();
    amount = Number(parts[1]);
  } else {
    amount = Number(parts[0]);
    slug = parts[1].toLowerCase();
  }
  if (!amount || isNaN(amount) || amount <= 0) return ctx.reply('❌ مقدار نامعتبر');

  const snapshot = getSnapshot();
  const found = findItem(slug, snapshot);
  if (!found) return ctx.reply(`❌ ارزی با slug "${slug}" پیدا نشد\n\nلیست سمبل‌ها: /symbols`);

  setPortfolioItem(ctx.from.id, slug, found.category, amount);
  ctx.reply(`✅ ${amount} ${slug.toUpperCase()} به سبد اضافه شد`);
});

// --- /delportfolio [slug] ---
bot.command('delportfolio', (ctx) => {
  const slug = (ctx.message.text.split(' ')[1] || '').toLowerCase();
  if (!slug) return ctx.reply('❌ فرمت: /delportfolio btc');

  setPortfolioItem(ctx.from.id, slug, '', 0);
  ctx.reply(`✅ ${slug.toUpperCase()} از سبد حذف شد`);
});

// --- /portfolio ---
bot.command('portfolio', (ctx) => {
  const items = getPortfolio(ctx.from.id);
  if (!items.length) return ctx.reply('📭 سبد خالیه\n\nبرای اضافه کردن: /addportfolio btc 0.5');

  const snapshot = getSnapshot();
  let totalToman = 0;
  const lines = [];

  for (const p of items) {
    const found = findItem(p.slug, snapshot);
    if (!found) {
      lines.push(`❓ ${p.slug.toUpperCase()}: ${p.amount} (قیمت نامشخص)`);
      continue;
    }
    const price = getItemPrice(found.item, found.category);
    const value = price * p.amount;
    totalToman += value;
    lines.push(`${p.slug.toUpperCase()}: ${p.amount} × ${formatNumber(price)} = ${formatNumber(value)} T`);
  }

  ctx.reply(
    '💼 سبد دارایی\n\n' + lines.join('\n') +
    `\n\n💰 ارزش کل: ${formatNumber(totalToman)} Toman` +
    lastUpdatedText(snapshot) + '\n\nDev | maowlh'
  );
});

// --- /summary ---
bot.command('summary', (ctx) => {
  const snapshot = getSnapshot();
  ctx.reply(buildSummaryText(snapshot), { parse_mode: 'Markdown' });
});

// ==================== CHANNEL AUTO-POST ====================
const CHANNEL_ID = process.env.CHANNEL_ID || '@poolpricer';
const CHANNEL_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

const buildSummaryText = (snapshot) => {
  const lines = [];

  const goldItems = Object.values(snapshot.gold || {});
  if (goldItems.length) {
    lines.push('🥇 طلا و سکه:');
    for (const item of goldItems) {
      const unit = USD_GOLD_SLUGS.has(String(item.slug || '').toLowerCase()) ? '$' : 'T';
      lines.push(`  ${item.name}: \`${formatNumber(item.price)}\` ${unit}`);
    }
    lines.push('');
  }

  const curItems = Object.values(snapshot.currencies || {});
  if (curItems.length) {
    lines.push('💱 ارزها:');
    for (const item of curItems) {
      lines.push(`  ${flagForCurrency(item.slug)} ${item.name}: \`${formatNumber(item.sell)}\` T`);
    }
    lines.push('');
  }

  const cryptoItems = Object.values(snapshot.crypto || {});
  if (cryptoItems.length) {
    lines.push('🪙 رمزارزها:');
    for (const item of cryptoItems) {
      lines.push(`  ${emojiForCrypto(item.slug)} ${item.slug}: \`${formatNumber(item.toman)}\` T`);
    }
    lines.push('');
  }

  if (cryptoItems.length) {
    const sorted = [...cryptoItems].sort((a, b) => Number(b.change_24h || 0) - Number(a.change_24h || 0));
    lines.push(`🏆 بهترین: ${sorted[0].slug} 🟢 +${sorted[0].change_24h}%`);
    lines.push(`📉 بدترین: ${sorted[sorted.length - 1].slug} 🔴 ${sorted[sorted.length - 1].change_24h}%`);
  }

  return '📊 خلاصه بازار\n\n' + lines.join('\n') + lastUpdatedText(snapshot) + '\n\nDev | maowlh';
};

// ==================== GROUP COMMANDS ====================

// --- /setsummary [minutes] ---
bot.command('setsummary', async (ctx) => {
  if (ctx.chat.type === 'private') return ctx.reply('❌ این دستور فقط توی گروه کار میکنه');

  const member = await ctx.getChatMember(ctx.from.id);
  if (!['creator', 'administrator'].includes(member.status)) {
    return ctx.reply('❌ فقط ادمین‌ها میتونن این دستور رو بزنن');
  }

  const minutes = Number(ctx.message.text.split(' ')[1]);
  if (!minutes || minutes < 1) return ctx.reply('❌ فرمت: /setsummary 60\n(عدد بر حسب دقیقه، حداقل ۱)');

  setGroupSummaryInterval(ctx.chat.id, minutes);
  ctx.reply(`✅ خلاصه بازار هر ${minutes} دقیقه ارسال میشه`);
});

// --- /stopsummary ---
bot.command('stopsummary', async (ctx) => {
  if (ctx.chat.type === 'private') return ctx.reply('❌ این دستور فقط توی گروه کار میکنه');

  const member = await ctx.getChatMember(ctx.from.id);
  if (!['creator', 'administrator'].includes(member.status)) {
    return ctx.reply('❌ فقط ادمین‌ها میتونن این دستور رو بزنن');
  }

  disableGroupSummary(ctx.chat.id);
  ctx.reply('✅ ارسال خودکار خلاصه بازار متوقف شد');
});

// --- /groupalert [slug] [>|<] [price] ---
bot.command('groupalert', async (ctx) => {
  if (ctx.chat.type === 'private') return ctx.reply('❌ این دستور فقط توی گروه کار میکنه');

  const member = await ctx.getChatMember(ctx.from.id);
  if (!['creator', 'administrator'].includes(member.status)) {
    return ctx.reply('❌ فقط ادمین‌ها میتونن این دستور رو بزنن');
  }

  const parts = ctx.message.text.split(/\s+/).slice(1);
  if (parts.length < 3) return ctx.reply('❌ فرمت: /groupalert usd > 170000');

  const slug = parts[0].toLowerCase();
  const direction = parts[1];
  const targetPrice = Number(parts[2].replace(/,/g, ''));

  if (direction !== '>' && direction !== '<') return ctx.reply('❌ جهت باید > یا < باشه');
  if (!targetPrice || isNaN(targetPrice)) return ctx.reply('❌ قیمت نامعتبر');

  const snapshot = getSnapshot();
  const found = findItem(slug, snapshot);
  if (!found) return ctx.reply(`❌ ارزی با slug "${slug}" پیدا نشد`);

  addGroupAlert(ctx.chat.id, slug, found.category, direction, targetPrice);
  const dirText = direction === '>' ? 'بالاتر از' : 'پایین‌تر از';
  ctx.reply(`✅ هشدار گروهی ثبت شد!\n\n🔔 ${slug.toUpperCase()} وقتی ${dirText} ${formatNumber(targetPrice)} بشه خبر میدم`);
});

// --- /groupalerts ---
bot.command('groupalerts', (ctx) => {
  if (ctx.chat.type === 'private') return ctx.reply('❌ این دستور فقط توی گروه کار میکنه');

  const alerts = getGroupAlerts(ctx.chat.id);
  if (!alerts.length) return ctx.reply('📭 هشدار گروهی فعالی نداری');

  const lines = alerts.map((a) => `🔔 #${a.id} | ${a.slug.toUpperCase()} ${a.direction} ${formatNumber(a.target_price)}`);
  ctx.reply('🔔 هشدارهای گروه:\n\n' + lines.join('\n') + '\n\nبرای حذف: /delgroupalert [id]');
});

// --- /delgroupalert [id] ---
bot.command('delgroupalert', async (ctx) => {
  if (ctx.chat.type === 'private') return ctx.reply('❌ این دستور فقط توی گروه کار میکنه');

  const member = await ctx.getChatMember(ctx.from.id);
  if (!['creator', 'administrator'].includes(member.status)) {
    return ctx.reply('❌ فقط ادمین‌ها میتونن این دستور رو بزنن');
  }

  const id = Number(ctx.message.text.split(' ')[1]);
  if (!id) return ctx.reply('❌ فرمت: /delgroupalert 5');

  const result = deleteGroupAlert(id, ctx.chat.id);
  if (result.changes > 0) {
    ctx.reply(`✅ هشدار گروهی #${id} حذف شد`);
  } else {
    ctx.reply(`❌ هشدار #${id} پیدا نشد یا مال این گروه نیست`);
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
        const dirText = alert.direction === '>' ? 'بالاتر از' : 'پایین‌تر از';
        bot.telegram.sendMessage(
          alert.chat_id,
          `🔔 هشدار!\n\n${alert.slug.toUpperCase()} به ${formatNumber(currentPrice)} رسید!\n(${dirText} ${formatNumber(alert.target_price)})\n\nDev | maowlh`
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
        const dirText = alert.direction === '>' ? 'بالاتر از' : 'پایین‌تر از';
        bot.telegram.sendMessage(
          alert.chat_id,
          `🔔 هشدار گروهی!\n\n${alert.slug.toUpperCase()} به ${formatNumber(currentPrice)} رسید!\n(${dirText} ${formatNumber(alert.target_price)})\n\nDev | maowlh`
        ).catch((e) => console.error('[group-alert] send failed:', e.message));
      }
    }
  } catch (e) {
    console.error('[alert-checker] error:', e.message);
  }
}, 60 * 1000); // Check every 1 minute

// ==================== AUTO-POST: Channel + Groups ====================
let lastChannelPostAt = 0;

setInterval(() => {
  try {
    const snapshot = getSnapshot();
    const now = Date.now();

    // Channel auto-post (hourly)
    if (CHANNEL_ID && now - lastChannelPostAt >= CHANNEL_INTERVAL_MS) {
      lastChannelPostAt = now;
      bot.telegram.sendMessage(CHANNEL_ID, buildSummaryText(snapshot), { parse_mode: 'Markdown' })
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
        bot.telegram.sendMessage(group.chat_id, buildSummaryText(snapshot), { parse_mode: 'Markdown' })
          .then(() => console.log(`[group] summary posted to ${group.chat_id}`))
          .catch((e) => console.error(`[group] post failed for ${group.chat_id}:`, e.message));
      }
    }
  } catch (e) {
    console.error('[auto-post] error:', e.message);
  }
}, 60 * 1000); // Check every 1 minute

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
          message_text: '⏳ Data is loading, please try again in a few seconds.\n\nDev | maowlh'
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
              message_text: 'No matching asset found.\n\nDev | maowlh'
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
              message_text: '⚠️ Temporary error. Please try again shortly.\n\nDev | maowlh'
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
