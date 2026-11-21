import { expect } from 'chai';
import { signQrPayload, verifyQrPayload } from '../src/modules/qr/personalQr';

describe('personalQr sign/verify', () => {
  const secret = 'test-secret-not-real';

  it('produces a signature that verifies for the same userId + secret', () => {
    const sig = signQrPayload('user123', secret);
    expect(verifyQrPayload('user123', sig, secret)).to.equal(true);
  });

  it('rejects a signature for a different userId', () => {
    const sig = signQrPayload('user123', secret);
    expect(verifyQrPayload('user456', sig, secret)).to.equal(false);
  });

  it('rejects a signature verified against the wrong secret', () => {
    const sig = signQrPayload('user123', secret);
    expect(verifyQrPayload('user123', sig, 'a-different-secret')).to.equal(false);
  });

  it('rejects a tampered signature (wrong length)', () => {
    expect(verifyQrPayload('user123', 'not-a-real-signature', secret)).to.equal(false);
  });

  it('is deterministic — same inputs always produce the same signature', () => {
    const sigA = signQrPayload('user123', secret);
    const sigB = signQrPayload('user123', secret);
    expect(sigA).to.equal(sigB);
  });
});
