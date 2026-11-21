import { expect } from 'chai';
import { isE164, requireE164 } from '../src/utils/phone';

describe('phone.isE164', () => {
  it('accepts valid E.164 numbers', () => {
    expect(isE164('+15551234567')).to.equal(true);
    expect(isE164('+442071838750')).to.equal(true);
  });

  it('rejects numbers missing the leading +, with letters, or too short', () => {
    expect(isE164('15551234567')).to.equal(false);
    expect(isE164('+1555ABC4567')).to.equal(false);
    expect(isE164('+1')).to.equal(false);
    expect(isE164('')).to.equal(false);
  });
});

describe('phone.requireE164', () => {
  it('returns the phone unchanged when valid', () => {
    expect(requireE164('+15551234567')).to.equal('+15551234567');
  });

  it('throws an HttpsError with code invalid-argument when invalid', () => {
    expect(() => requireE164('not-a-phone')).to.throw();
  });
});
