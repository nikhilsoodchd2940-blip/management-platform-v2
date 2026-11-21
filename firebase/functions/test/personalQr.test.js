"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const chai_1 = require("chai");
const personalQr_1 = require("../src/modules/qr/personalQr");
describe('personalQr sign/verify', () => {
    const secret = 'test-secret-not-real';
    it('produces a signature that verifies for the same userId + secret', () => {
        const sig = (0, personalQr_1.signQrPayload)('user123', secret);
        (0, chai_1.expect)((0, personalQr_1.verifyQrPayload)('user123', sig, secret)).to.equal(true);
    });
    it('rejects a signature for a different userId', () => {
        const sig = (0, personalQr_1.signQrPayload)('user123', secret);
        (0, chai_1.expect)((0, personalQr_1.verifyQrPayload)('user456', sig, secret)).to.equal(false);
    });
    it('rejects a signature verified against the wrong secret', () => {
        const sig = (0, personalQr_1.signQrPayload)('user123', secret);
        (0, chai_1.expect)((0, personalQr_1.verifyQrPayload)('user123', sig, 'a-different-secret')).to.equal(false);
    });
    it('rejects a tampered signature (wrong length)', () => {
        (0, chai_1.expect)((0, personalQr_1.verifyQrPayload)('user123', 'not-a-real-signature', secret)).to.equal(false);
    });
    it('is deterministic — same inputs always produce the same signature', () => {
        const sigA = (0, personalQr_1.signQrPayload)('user123', secret);
        const sigB = (0, personalQr_1.signQrPayload)('user123', secret);
        (0, chai_1.expect)(sigA).to.equal(sigB);
    });
});
//# sourceMappingURL=personalQr.test.js.map