"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const chai_1 = require("chai");
const phone_1 = require("../src/utils/phone");
describe('phone.isE164', () => {
    it('accepts valid E.164 numbers', () => {
        (0, chai_1.expect)((0, phone_1.isE164)('+15551234567')).to.equal(true);
        (0, chai_1.expect)((0, phone_1.isE164)('+442071838750')).to.equal(true);
    });
    it('rejects numbers missing the leading +, with letters, or too short', () => {
        (0, chai_1.expect)((0, phone_1.isE164)('15551234567')).to.equal(false);
        (0, chai_1.expect)((0, phone_1.isE164)('+1555ABC4567')).to.equal(false);
        (0, chai_1.expect)((0, phone_1.isE164)('+1')).to.equal(false);
        (0, chai_1.expect)((0, phone_1.isE164)('')).to.equal(false);
    });
});
describe('phone.requireE164', () => {
    it('returns the phone unchanged when valid', () => {
        (0, chai_1.expect)((0, phone_1.requireE164)('+15551234567')).to.equal('+15551234567');
    });
    it('throws an HttpsError with code invalid-argument when invalid', () => {
        (0, chai_1.expect)(() => (0, phone_1.requireE164)('not-a-phone')).to.throw();
    });
});
//# sourceMappingURL=phone.test.js.map