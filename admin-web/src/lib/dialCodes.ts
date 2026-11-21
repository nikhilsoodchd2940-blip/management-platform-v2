/** Phone country codes for the member forms. Senegal is the default. */
export const DEFAULT_DIAL = '+221';

export const DIAL_CODES: { code: string; label: string }[] = [
  { code: '+221', label: 'Senegal (+221)' },
  { code: '+91', label: 'India (+91)' },
  { code: '+1', label: 'USA / Canada (+1)' },
  { code: '+44', label: 'United Kingdom (+44)' },
  { code: '+33', label: 'France (+33)' },
  { code: '+49', label: 'Germany (+49)' },
  { code: '+34', label: 'Spain (+34)' },
  { code: '+39', label: 'Italy (+39)' },
  { code: '+31', label: 'Netherlands (+31)' },
  { code: '+32', label: 'Belgium (+32)' },
  { code: '+41', label: 'Switzerland (+41)' },
  { code: '+351', label: 'Portugal (+351)' },
  { code: '+212', label: 'Morocco (+212)' },
  { code: '+213', label: 'Algeria (+213)' },
  { code: '+216', label: 'Tunisia (+216)' },
  { code: '+220', label: 'Gambia (+220)' },
  { code: '+222', label: 'Mauritania (+222)' },
  { code: '+223', label: 'Mali (+223)' },
  { code: '+224', label: 'Guinea (+224)' },
  { code: '+225', label: 'Ivory Coast (+225)' },
  { code: '+226', label: 'Burkina Faso (+226)' },
  { code: '+227', label: 'Niger (+227)' },
  { code: '+228', label: 'Togo (+228)' },
  { code: '+229', label: 'Benin (+229)' },
  { code: '+233', label: 'Ghana (+233)' },
  { code: '+234', label: 'Nigeria (+234)' },
  { code: '+237', label: 'Cameroon (+237)' },
  { code: '+20', label: 'Egypt (+20)' },
  { code: '+27', label: 'South Africa (+27)' },
  { code: '+90', label: 'Turkey (+90)' },
  { code: '+92', label: 'Pakistan (+92)' },
  { code: '+880', label: 'Bangladesh (+880)' },
  { code: '+94', label: 'Sri Lanka (+94)' },
  { code: '+971', label: 'United Arab Emirates (+971)' },
  { code: '+966', label: 'Saudi Arabia (+966)' },
  { code: '+974', label: 'Qatar (+974)' },
  { code: '+61', label: 'Australia (+61)' },
  { code: '+55', label: 'Brazil (+55)' },
  { code: '+52', label: 'Mexico (+52)' },
];

/** Joins a country code and a local number into one international number. A number that already starts with "+" is kept as typed. */
export function withDialCode(code: string, local: string): string {
  const t = local.trim().replace(/[\s\-().]/g, '');
  if (!t) return '';
  if (t.startsWith('+')) return t;
  const digits = t.replace(/^0+/, '');
  const cc = code.replace(/\D/g, '');
  // A number that already begins with the country code (e.g. 919000000002) is not doubled.
  if (cc && digits.startsWith(cc) && digits.length > cc.length + 6) return `+${digits}`;
  return `+${cc}${digits}`;
}

/** Splits "+221779007070" into its country code and the rest. Unknown codes stay in the number. */
export function splitDialCode(phone: string): { code: string; local: string } {
  const t = phone.trim();
  const hit = [...DIAL_CODES].sort((a, b) => b.code.length - a.code.length).find((d) => t.startsWith(d.code));
  return hit ? { code: hit.code, local: t.slice(hit.code.length) } : { code: '', local: t };
}
