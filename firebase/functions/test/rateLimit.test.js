"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const chai_1 = require("chai");
const rateLimit_1 = require("../src/utils/rateLimit");
describe('rateLimit.rateLimitBucketId', () => {
    it('produces the same bucket for timestamps within the same window', () => {
        const windowSeconds = 60;
        const base = 1700000000000; // arbitrary fixed ms timestamp
        const a = (0, rateLimit_1.rateLimitBucketId)('key', windowSeconds, base);
        const b = (0, rateLimit_1.rateLimitBucketId)('key', windowSeconds, base + 30000); // 30s later, same minute window
        (0, chai_1.expect)(a).to.equal(b);
    });
    it('produces different buckets across a window boundary', () => {
        const windowSeconds = 60;
        const windowStart = Math.floor(1700000000000 / (windowSeconds * 1000)) * (windowSeconds * 1000);
        const a = (0, rateLimit_1.rateLimitBucketId)('key', windowSeconds, windowStart);
        const b = (0, rateLimit_1.rateLimitBucketId)('key', windowSeconds, windowStart + windowSeconds * 1000);
        (0, chai_1.expect)(a).to.not.equal(b);
    });
    it('produces different buckets for different keys at the same time', () => {
        const now = Date.now();
        const a = (0, rateLimit_1.rateLimitBucketId)('keyA', 60, now);
        const b = (0, rateLimit_1.rateLimitBucketId)('keyB', 60, now);
        (0, chai_1.expect)(a).to.not.equal(b);
    });
});
//# sourceMappingURL=rateLimit.test.js.map