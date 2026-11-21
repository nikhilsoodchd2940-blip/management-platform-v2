import { httpsCallable as rawCallable, type Functions, type HttpsCallable, type HttpsCallableOptions, type HttpsCallableResult } from 'firebase/functions';

/**
 * Same as httpsCallable, with two speed-ups for the calls that only read:
 *  - two screens asking for the same thing at the same moment share one request;
 *  - the answer is reused for a few seconds, so moving between tabs does not wait again.
 * Any call that changes data clears the saved answers at once, so a screen never shows what it just changed as old.
 */
const READ = /^(get|list|search|preview)[A-Z]/;
const TTL = 3000;
const saved = new Map<string, { at: number; value: Promise<HttpsCallableResult<unknown>> }>();

export function httpsCallable<Req = unknown, Res = unknown>(functions: Functions, name: string, options?: HttpsCallableOptions): HttpsCallable<Req, Res> {
  const call = rawCallable<Req, Res>(functions, name, options);
  if (!READ.test(name)) {
    return ((data?: Req | null) => call(data).finally(() => saved.clear())) as HttpsCallable<Req, Res>;
  }
  return ((data?: Req | null) => {
    const key = `${name}|${JSON.stringify(data ?? null)}`;
    const hit = saved.get(key);
    if (hit && Date.now() - hit.at < TTL) return hit.value as Promise<HttpsCallableResult<Res>>;
    const value = call(data);
    saved.set(key, { at: Date.now(), value: value as Promise<HttpsCallableResult<unknown>> });
    value.catch(() => { if (saved.get(key)?.value === value) saved.delete(key); });
    if (saved.size > 200) saved.delete(saved.keys().next().value as string);
    return value;
  }) as HttpsCallable<Req, Res>;
}
