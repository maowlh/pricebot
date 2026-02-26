const FALLBACK_FLAG = '🏳️';

const currencyFlags = {
  usd: '🇺🇸',
  eur: '🇪🇺',
  gbp: '🇬🇧',
  aed: '🇦🇪',
  try: '🇹🇷',
  cny: '🇨🇳',
  cad: '🇨🇦',
  aud: '🇦🇺',
  rub: '🇷🇺',
  iqd: '🇮🇶',
  jpy: '🇯🇵',
  inr: '🇮🇳',
  omr: '🇴🇲',
  sar: '🇸🇦',
  chf: '🇨🇭',
  kwd: '🇰🇼',
  sgd: '🇸🇬',
  hkd: '🇭🇰'
};

const cryptoEmojis = {
  BTC: '🟠',
  ETH: '💎',
  USDT: '💵',
  XRP: '⚡️',
  BNB: '🟡',
  DOGE: '🐶',
  TON: '🔷',
  SOL: '🌞',
  ADA: '🔵',
  SHIB: '🐕'
};

const numberOrZero = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);

const formatNumber = (value, options = {}) => {
  const n = numberOrZero(value);
  return n.toLocaleString('en-US', options);
};

const trendEmoji = (value) => {
  const n = numberOrZero(value);
  if (n > 0) return '🟢';
  if (n < 0) return '🔴';
  return '⚪️';
};

const flagForCurrency = (slug) => currencyFlags[(slug || '').toLowerCase()] || FALLBACK_FLAG;
const emojiForCrypto = (slug) => cryptoEmojis[(slug || '').toUpperCase()] || '🟣';

module.exports = {
  formatNumber,
  trendEmoji,
  flagForCurrency,
  emojiForCrypto
};
