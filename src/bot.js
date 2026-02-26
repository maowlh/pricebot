require('dotenv').config();

const { Telegraf } = require('telegraf');
const {
  startBackgroundJobs,
  getSnapshot,
  FALLBACK_CHART_URL
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
    rates[currency.slug.toUpperCase()] = Number(currency.sell || 0) / 10;
  });

  Object.values(snapshot.crypto || {}).forEach((crypto) => {
    if (!crypto?.slug) return;
    rates[crypto.slug.toUpperCase()] = Number(crypto.toman || 0);
  });

  rates.USD = rates.USD || (snapshot.currencies?.usd?.sell || 0) / 10;
  return rates;
};

const formatGoldCaption = (item) => {
  const changeEmoji = trendEmoji(item.dayChange);
  return `🥇 | Gold ${String(item.slug || item.name || '').toUpperCase()}\n\n💲| Price: ${formatNumber(item.price)} Toman\n\n➕| Open: ${formatNumber(item.open)} Toman\n🔺| High: ${formatNumber(item.high)} Toman\n🔻| Low: ${formatNumber(item.low)} Toman\n\n${changeEmoji} | Today: ${formatNumber(item.dayChange, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  })}%\n\n▫️| Real Price: ${formatNumber(item.real_price)} Toman\n\n🫧| Bubble: ${formatNumber(item.bubble)} Toman\n📍| Bubble Per: ${formatNumber(item.bubble_per, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  })}%\n\nDev | maowlh`;
};

const formatCurrencyCaption = (item) => {
  const changeEmoji = trendEmoji(item.dayChange);
  return `${flagForCurrency(item.slug)} | ${item.name} (${String(item.slug || '').toUpperCase()})\n\n🇮🇷🔻| Toman (SELL): ${formatNumber(item.sell)} Toman\n🇮🇷🔺| Toman (BUY): ${formatNumber(item.buy)} Toman\n\n🇺🇸| Price Usd: ${formatNumber(item.dolar_rate, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 6
  })} $\n\n➕| Open: ${formatNumber(item.open)} Toman\n🔺| High: ${formatNumber(item.high)} Toman\n🔻| Low: ${formatNumber(item.low)} Toman\n\n${changeEmoji} | Day Change: ${formatNumber(item.dayChange, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  })}%\n\nDev | maowlh`;
};

const formatCryptoText = (item) => {
  const e24 = trendEmoji(item.change_24h);
  const e1 = trendEmoji(item.change_1h);
  const e7 = trendEmoji(item.change_7d);
  const e30 = trendEmoji(item.change_30d);
  const e90 = trendEmoji(item.change_90d);
  const e365 = trendEmoji(item.change_365d);
  const eTom = trendEmoji(item.toman24hchange);

  const pct = (v) =>
    `${formatNumber(v, { minimumFractionDigits: 0, maximumFractionDigits: 4 })}%`;

  return `${emojiForCrypto(item.slug)} | ${item.slug} (${item.name})\n\n🇮🇷| Price Toman: ${formatNumber(item.toman)} Toman\n🇺🇸| Price Usd: ${formatNumber(item.price, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 8
  })} $\n\n${e24} | Change 24h: ${pct(item.change_24h)}\n${e1} | Change 1h: ${pct(
    item.change_1h
  )}\n${e7} | Change 7d: ${pct(item.change_7d)}\n${e30} | Change 30d: ${pct(
    item.change_30d
  )}\n${e90} | Change 90d: ${pct(item.change_90d)}\n${e365} | Change 365d: ${pct(
    item.change_365d
  )}\n\n${eTom} | Toman 24h change: ${pct(item.toman24hchange)}\n\nDev | maowlh`;
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
    title: `${amount} ${from} to ${to}`,
    description: `${formatNumber(result)} ${to}`,
    input_message_content: { message_text: text }
  };
};

const includesSearch = (item, q) => {
  const haystack = `${item.slug || ''} ${item.name || ''}`.toLowerCase();
  return haystack.includes(q);
};

const buildSearchResults = (query, snapshot) => {
  const q = query.trim().toLowerCase();
  const isEmpty = !q.length;
  const charts = snapshot.chartsBySlug || {};

  const goldItems = Object.values(snapshot.gold || {}).filter((item) => isEmpty || includesSearch(item, q));
  const currencyItems = Object.values(snapshot.currencies || {}).filter(
    (item) => isEmpty || includesSearch(item, q)
  );
  const cryptoItems = Object.values(snapshot.crypto || {}).filter(
    (item) => isEmpty || includesSearch(item, q)
  );

  const goldResults = goldItems.map((item) => ({
    type: 'photo',
    id: `gold-${item.slug}`,
    title: `Gold | ${item.name}`,
    photo_url: charts[item.slug] || FALLBACK_CHART_URL,
    thumbnail_url: charts[item.slug] || FALLBACK_CHART_URL,
    caption: formatGoldCaption(item)
  }));

  const currencyResults = currencyItems.map((item) => ({
    type: 'photo',
    id: `cur-${item.slug}`,
    title: `${item.name} (${String(item.slug || '').toUpperCase()})`,
    photo_url: charts[item.slug] || FALLBACK_CHART_URL,
    thumbnail_url: charts[item.slug] || FALLBACK_CHART_URL,
    caption: formatCurrencyCaption(item)
  }));

  const cryptoResults = cryptoItems.map((item) => ({
    type: 'article',
    id: `crypto-${item.slug}`,
    title: `${item.slug} (${item.name})`,
    description: `Toman: ${formatNumber(item.toman)} | USD: ${formatNumber(item.price)}`,
    input_message_content: {
      message_text: formatCryptoText(item)
    }
  }));

  return [...goldResults, ...currencyResults, ...cryptoResults].slice(0, 50);
};

bot.on('inline_query', async (ctx) => {
  const query = ctx.inlineQuery.query || '';
  const snapshot = getSnapshot();

  try {
    const calculatorResult = buildCalculatorResult(query, snapshot);
    if (calculatorResult) {
      await ctx.answerInlineQuery([calculatorResult], { cache_time: 5, is_personal: true });
      return;
    }

    const results = buildSearchResults(query, snapshot);

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

    await ctx.answerInlineQuery(results, { cache_time: 3, is_personal: true });
  } catch (error) {
    console.error('[inline_query] error:', error.message);
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
  }
});

startBackgroundJobs();

bot
  .launch()
  .then(() => console.log('🤖 Price inline bot is running...'))
  .catch((error) => console.error('Failed to launch bot:', error.message));

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
