export interface ParsedMoney {
  minor: bigint;
  negative: boolean;
  exponent: number;
}

const EXPONENTS: Record<string, number> = {
  BIF:0, CLP:0, DJF:0, GNF:0, ISK:0, JPY:0, KMF:0, KRW:0, PYG:0, RWF:0,
  UGX:0, UYI:0, VND:0, VUV:0, XAF:0, XOF:0, XPF:0,
  BHD:3, IQD:3, JOD:3, KWD:3, LYD:3, OMR:3, TND:3,
  CLF:4, UYW:4,
};

export function currencyExponent(currency: string) {
  return EXPONENTS[currency.toUpperCase()] ?? 2;
}

function normalizedMoneyText(value: unknown) {
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('amount is not finite');
    return value.toString();
  }
  if (typeof value !== 'string') throw new Error('amount must be a number or string');
  let candidate = value.trim();
  if (!candidate) throw new Error('amount is empty');
  if (candidate.length > 128) throw new Error('amount representation is too long');
  const accountingNegative = /^\(.*\)$/.test(candidate);
  if (accountingNegative) candidate = candidate.slice(1, -1);
  if (/\d\s+\d/.test(candidate)) throw new Error('amount contains whitespace between digits');
  candidate = candidate.replace(/[₹$€£¥\s]/g, '');
  const unsignedForGrouping = candidate.replace(/^[+-]/, '');
  const integerForGrouping = unsignedForGrouping.split('.')[0];
  if (integerForGrouping.includes(',')) {
    const western = /^\d{1,3}(?:,\d{3})+$/.test(integerForGrouping);
    const indian = /^\d{1,2}(?:,\d{2})*,\d{3}$/.test(integerForGrouping);
    if (!western && !indian) throw new Error('amount has invalid digit grouping');
  }
  candidate = candidate.replaceAll(',', '');
  if (!/^[+-]?\d+(?:\.\d+)?$/.test(candidate)) throw new Error('amount has invalid characters or format');
  return accountingNegative && !candidate.startsWith('-') ? `-${candidate}` : candidate;
}

export function parseMoney(value: unknown, currency = 'INR', alreadyMinor = false): ParsedMoney {
  const exponent = currencyExponent(currency);
  const candidate = normalizedMoneyText(value);
  const negative = candidate.startsWith('-');
  const unsigned = candidate.replace(/^[+-]/, '');
  const [integer, fraction = ''] = unsigned.split('.');
  if (alreadyMinor && fraction) throw new Error('minor-unit amount must be an integer');
  if (!alreadyMinor && fraction.length > exponent) throw new Error(`amount exceeds ${exponent} decimal places for ${currency}`);
  const scale = 10n ** BigInt(exponent);
  const minor = alreadyMinor
    ? BigInt(integer)
    : BigInt(integer) * scale + BigInt((fraction + '0'.repeat(exponent)).slice(0, exponent) || '0');
  const signedMinor = negative ? -minor : minor;
  if (signedMinor > BigInt(Number.MAX_SAFE_INTEGER) || signedMinor < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new Error('amount exceeds supported safe minor-unit range');
  }
  return { minor:signedMinor, negative, exponent };
}

export function minorToDecimal(minor: bigint, exponent: number) {
  const negative = minor < 0n;
  const absolute = negative ? -minor : minor;
  if (exponent === 0) return `${negative ? '-' : ''}${absolute}`;
  const digits = absolute.toString().padStart(exponent + 1, '0');
  return `${negative ? '-' : ''}${digits.slice(0, -exponent)}.${digits.slice(-exponent)}`;
}

export function minorToNumber(minor: bigint, exponent: number) {
  return Number(minorToDecimal(minor, exponent));
}

export function toleranceToMinor(value: number, exponent: number) {
  const representativeCurrency = exponent === 0 ? 'JPY' : exponent === 3 ? 'KWD' : exponent === 4 ? 'CLF' : 'INR';
  return parseMoney(value, representativeCurrency).minor;
}
