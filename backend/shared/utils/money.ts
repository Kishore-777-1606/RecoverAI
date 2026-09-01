/**
 * Precise currency arithmetic utilities for managing PostgreSQL NUMERIC(15,2) decimal fields.
 * Performs integer operations in subunits (paise) to avoid float precision rounding issues.
 */

/**
 * Converts a decimal value (number or string) into subunit integers (paise).
 * e.g., "12450.50" -> 1245050
 */
export function toSubunits(amount: number | string): number {
  const amtStr = typeof amount === 'number' ? amount.toFixed(2) : amount;
  const parts = amtStr.split('.');
  const whole = parseInt(parts[0], 10) || 0;
  const fraction = parts[1] ? parseInt(parts[1].padEnd(2, '0').slice(0, 2), 10) : 0;
  const total = whole * 100 + (whole >= 0 ? fraction : -fraction);
  return total;
}

/**
 * Converts subunit integer paise back to standard decimal string format.
 * e.g., 1245050 -> "12450.50"
 */
export function fromSubunits(subunits: number): string {
  const isNegative = subunits < 0;
  const absVal = Math.abs(subunits);
  const whole = Math.floor(absVal / 100);
  const fraction = absVal % 100;
  const sign = isNegative ? '-' : '';
  return `${sign}${whole}.${fraction.toString().padStart(2, '0')}`;
}

/**
 * Safe float-free addition of currency amounts.
 */
export function add(a: string | number, b: string | number): string {
  return fromSubunits(toSubunits(a) + toSubunits(b));
}

/**
 * Safe float-free subtraction of currency amounts.
 */
export function subtract(a: string | number, b: string | number): string {
  return fromSubunits(toSubunits(a) - toSubunits(b));
}

/**
 * Safe float-free multiplication of a currency amount by a scalar multiplier.
 */
export function multiply(a: string | number, multiplier: number): string {
  return fromSubunits(Math.round(toSubunits(a) * multiplier));
}
