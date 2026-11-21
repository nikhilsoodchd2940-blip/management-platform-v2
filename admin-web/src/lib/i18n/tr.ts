import { tr } from './store';
export { tr as tx, dateLocale } from './store';
/** Translate a text that holds {placeholders}, then fill them in. */
export const txf = (key: string, vars: Record<string, string | number>) => tr(key).replace(/\{(\w+)\}/g, (_, n) => String(vars[n] ?? ''));
