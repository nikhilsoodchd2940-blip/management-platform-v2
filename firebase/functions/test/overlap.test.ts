import { expect } from 'chai';
import { rangesOverlap, conflictDocId } from '../src/modules/conflicts/overlap';

describe('overlap.rangesOverlap', () => {
  it('detects a clear overlap', () => {
    expect(rangesOverlap(0, 100, 50, 150)).to.equal(true);
  });

  it('detects one range fully inside another', () => {
    expect(rangesOverlap(0, 100, 25, 75)).to.equal(true);
  });

  it('does not count back-to-back ranges (touching endpoint) as overlapping', () => {
    expect(rangesOverlap(0, 100, 100, 200)).to.equal(false);
  });

  it('does not count clearly separate ranges as overlapping', () => {
    expect(rangesOverlap(0, 100, 200, 300)).to.equal(false);
  });

  it('is symmetric', () => {
    expect(rangesOverlap(50, 150, 0, 100)).to.equal(rangesOverlap(0, 100, 50, 150));
  });
});

describe('overlap.conflictDocId', () => {
  it('produces the same ID regardless of event argument order', () => {
    const a = conflictDocId('user1', 'eventA', 'eventB');
    const b = conflictDocId('user1', 'eventB', 'eventA');
    expect(a).to.equal(b);
  });

  it('differs for different users with the same event pair', () => {
    const a = conflictDocId('user1', 'eventA', 'eventB');
    const b = conflictDocId('user2', 'eventA', 'eventB');
    expect(a).to.not.equal(b);
  });
});
