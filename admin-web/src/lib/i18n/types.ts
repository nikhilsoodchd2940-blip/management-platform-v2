/**
 * The admin panel is English-only. Each screen keeps its UI text in one
 * dictionary file (./dictionaries) so wording stays in one place and is
 * type-checked where it is used; `ns` only gives the object a name.
 */
export function ns<T>(strings: T): T {
  return strings;
}
