import { expect } from 'chai';
import { rateLimitBucketId } from '../src/utils/rateLimit';

describe('rateLimit.rateLimitBucketId', () => {
  it('produces the same bucket for timestamps within the same window', () => {
    const windowSeconds = 60;
    const base = 1_700_000_000_000; // arbitrary fixed ms timestamp
    const a = rateLimitBucketId('key', windowSeconds, base);
    const b = rateLimitBucketId('key', windowSeconds, base + 30_000); // 30s later, same minute window
    expect(a).to.equal(b);
  });

  it('produces different buckets across a window boundary', () => {
    const windowSeconds = 60;
    const windowStart = Math.floor(1_700_000_000_000 / (windowSeconds * 1000)) * (windowSeconds * 1000);
    const a = rateLimitBucketId('key', windowSeconds, windowStart);
    const b = rateLimitBucketId('key', windowSeconds, windowStart + windowSeconds * 1000);
    expect(a).to.not.equal(b);
  });

  it('produces different buckets for different keys at the same time', () => {
    const now = Date.now();
    const a = rateLimitBucketId('keyA', 60, now);
    const b = rateLimitBucketId('keyB', 60, now);
    expect(a).to.not.equal(b);
  });
});
