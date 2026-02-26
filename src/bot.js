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

const formatGoldText = (item) => {
  const changeEmoji = trendEmoji(item.dayChange);
  const lines = [
    `🥇 | Gold ${String(item.slug || item.name || '').toUpperCase()}`,
    '',
    `💲| Price: ${formatNumber(item.price)} Toman`,
    '',
    `➕| Open: ${formatNumber(item.open)} Toman`,
    `🔺| High: ${formatNumber(item.high)} Toman`,
    `🔻| Low: ${formatNumber(item.low)} Toman`,
    '',
    `${changeEmoji} | Today: ${formatNumber(item.dayChange, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}%`,
  ];
  if (item.real_price !== undefined) {
    lines.push('', `▫️| Real Price: ${formatNumber(item.real_price)} Toman`);
  }
  if (item.bubble !== undefined) {
    lines.push('', `🫧| Bubble: ${formatNumber(item.bubble)} Toman`);
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
