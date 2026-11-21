/**
 * Money formatting that follows the UI language instead of a hardcoded
 * "$" + toFixed(2). Amounts are stored in minor units (cents).
 */
export function formatMoney(cents: number, currency: string | undefined, locale: string): string {
  const major = cents / 100;
  if (!currency) return new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(major);
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency: currency.toUpperCase() }).format(major);
  } catch {
    // Unknown/invalid ISO code stored on a record — show number + code rather than crash.
    return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(major)} ${currency.toUpperCase()}`;
  }
}
