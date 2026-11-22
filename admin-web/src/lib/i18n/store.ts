/**
 * Language store (no React in here, so `tr()` can be called from anywhere).
 *
 * Every piece of text is looked up in this order:
 *   1. what an admin typed in the Language screen (Firestore `translations/{lang}`)
 *   2. the built-in translation shipped with the app (./bundles/{lang}.json)
 *   3. the English original
 *
 * Keys: dictionary entries are "@namespace.key" (arrays add ".0", ".1"…),
 * every other text on screen uses its English wording as the key.
 */
import { NAMESPACES } from './dictionaries';

export type Lang = 'en' | 'fr' | 'es' | 'it';

export const LANGS: { code: Lang; label: string; short: string; intl: string }[] = [
  { code: 'en', label: 'English', short: 'EN', intl: 'en-US' },
  { code: 'fr', label: 'Français', short: 'FR', intl: 'fr-FR' },
  { code: 'es', label: 'Español', short: 'ES', intl: 'es-ES' },
  { code: 'it', label: 'Italiano', short: 'IT', intl: 'it-IT' },
];

export type StringMap = Record<string, string>;

const STORAGE_KEY = 'admin.lang';

let lang: Lang = 'en';
let version = 0;
let ready = false;
const bundles: Partial<Record<Lang, StringMap>> = {};
const overrides: Partial<Record<Lang, StringMap>> = {};
const listeners = new Set<() => void>();

function emit() {
  version += 1;
  dictCache = null;
  listeners.forEach((l) => l());
}

export function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}
export const getVersion = () => version;
export const getLang = () => lang;
export const isReady = () => ready;
export const intlLocale = () => LANGS.find((l) => l.code === lang)?.intl ?? 'en-US';
/** Locale for dates and times shown on screen (English stays day-first, as before). */
export const dateLocale = () => (lang === 'en' ? 'en-GB' : intlLocale());

export function isLang(v: unknown): v is Lang {
  return v === 'en' || v === 'fr' || v === 'es' || v === 'it';
}

async function loadBundle(l: Lang) {
  if (bundles[l]) return;
  try {
    const mod = await import(`./bundles/${l}.json`);
    bundles[l] = (mod.default ?? mod) as StringMap;
  } catch {
    bundles[l] = {};
  }
}

/** Reads the saved language (or the browser's) and loads its built-in translation. Runs once on the client. */
export async function initLanguage() {
  let next: Lang = 'en';
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (isLang(saved)) next = saved;
    else {
      const nav = (navigator.language || 'en').slice(0, 2).toLowerCase();
      if (isLang(nav)) next = nav;
    }
  } catch {
    /* private mode: keep English */
  }
  await loadBundle(next);
  lang = next;
  ready = true;
  document.documentElement.lang = next;
  emit();
}

export async function setLanguage(next: Lang) {
  if (next === lang) return;
  await loadBundle(next);
  lang = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, next);
  } catch {
    /* ignore */
  }
  document.documentElement.lang = next;
  emit();
}

/** Called with the admin-edited strings of one language (from Firestore). Returns true when something changed. */
export function setOverrides(l: Lang, map: StringMap) {
  const prev = overrides[l];
  if (!prev && Object.keys(map).length === 0) {
    overrides[l] = map;
    return false;
  }
  if (prev && JSON.stringify(prev) === JSON.stringify(map)) return false;
  overrides[l] = map;
  if (l === lang) emit();
  return true;
}

/** Built-in translation (for the Language screen's "default" column and "reset"). */
export async function builtIn(l: Lang): Promise<StringMap> {
  await loadBundle(l);
  return bundles[l] ?? {};
}

const ciCache: Record<string, { src: Record<string, string>; map: Map<string, string> }> = {};
/** Same text with different capital letters (Title Case headings) still finds its translation. */
function ciFind(key: string): string | undefined {
  const src = bundles[lang];
  if (!src) return undefined;
  let c = ciCache[lang];
  if (!c || c.src !== src) {
    const map = new Map<string, string>();
    for (const k of Object.keys(src)) { const low = k.toLowerCase(); if (!map.has(low)) map.set(low, src[k]); }
    c = ciCache[lang] = { src, map };
  }
  return c.map.get(key.toLowerCase());
}

function lookup(key: string): string | undefined {
  const o = overrides[lang]?.[key];
  if (o !== undefined && o !== '') return o;
  return bundles[lang]?.[key] ?? ciFind(key);
}

/** Text written directly in a screen. The English wording is the key. */
export function tr(text: string): string {
  return lookup(text) ?? text;
}

/* ───────────── dictionary entries (typed `t.namespace.key`) ───────────── */

type Leaf = string | ((...a: never[]) => string);
export type Flat = { key: string; section: string; en: string; kind: 'text' | 'template' };

/** "{0} members" style template filler. `{0:one~many}` picks by the first number. */
export function fill(tpl: string, args: unknown[]): string {
  return tpl
    .replace(/\{(\d+):([^~}]*)~([^}]*)\}/g, (_m, i, one, many) => (Number(args[Number(i)]) === 1 ? one : many))
    .replace(/\{(\d+)\}/g, (_m, i) => String(args[Number(i)] ?? ''));
}

function probe(fn: (...a: never[]) => string): string | null {
  try {
    const n = Math.max(fn.length, 1);
    const args = Array.from({ length: n }, (_, i) => `{${i}}`);
    const out = (fn as (...a: unknown[]) => string)(...args);
    return typeof out === 'string' ? out : null;
  } catch {
    return null;
  }
}

function walk(node: unknown, path: string, section: string, visit: (path: string, section: string, v: Leaf) => void) {
  if (typeof node === 'string' || typeof node === 'function') return visit(path, section, node as Leaf);
  if (Array.isArray(node)) return node.forEach((n, i) => walk(n, `${path}.${i}`, section, visit));
  if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) walk(v, path ? `${path}.${k}` : k, section || k, visit);
  }
}

let flatCache: Flat[] | null = null;
/** Every dictionary entry with its English wording — what the Language screen lists. */
export function dictionaryEntries(): Flat[] {
  if (flatCache) return flatCache;
  const out: Flat[] = [];
  walk(NAMESPACES, '', '', (path, section, v) => {
    if (typeof v === 'string') out.push({ key: `@${path}`, section, en: v, kind: 'text' });
    else {
      const p = probe(v);
      if (p !== null) out.push({ key: `@${path}`, section, en: p, kind: 'template' });
    }
  });
  flatCache = out;
  return out;
}

let dictCache: typeof NAMESPACES | null = null;
function build(node: unknown, path: string): unknown {
  if (typeof node === 'string') return lookup(`@${path}`) ?? node;
  if (typeof node === 'function') {
    const tpl = lookup(`@${path}`);
    return tpl === undefined ? node : (...args: unknown[]) => fill(tpl, args);
  }
  if (Array.isArray(node)) return node.map((n, i) => build(n, `${path}.${i}`));
  if (node && typeof node === 'object') {
    const o: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node)) o[k] = build(v, path ? `${path}.${k}` : k);
    return o;
  }
  return node;
}

/** The typed dictionary in the current language (rebuilt only when the language or an edit changes). */
export function dictionary(): typeof NAMESPACES {
  if (!dictCache) dictCache = build(NAMESPACES, '') as typeof NAMESPACES;
  return dictCache;
}
