import { NAMESPACES } from './dictionaries';

export type Dictionary = typeof NAMESPACES;

/** English originals. Screens read the current language through useLocale().t (see LocaleContext). */
export const DICTIONARY: Dictionary = NAMESPACES;
