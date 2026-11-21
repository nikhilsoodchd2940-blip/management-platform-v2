"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const chai_1 = require("chai");
const overlap_1 = require("../src/modules/conflicts/overlap");
describe('overlap.rangesOverlap', () => {
    it('detects a clear overlap', () => {
        (0, chai_1.expect)((0, overlap_1.rangesOverlap)(0, 100, 50, 150)).to.equal(true);
    });
    it('detects one range fully inside another', () => {
        (0, chai_1.expect)((0, overlap_1.rangesOverlap)(0, 100, 25, 75)).to.equal(true);
    });
    it('does not count back-to-back ranges (touching endpoint) as overlapping', () => {
        (0, chai_1.expect)((0, overlap_1.rangesOverlap)(0, 100, 100, 200)).to.equal(false);
    });
    it('does not count clearly separate ranges as overlapping', () => {
        (0, chai_1.expect)((0, overlap_1.rangesOverlap)(0, 100, 200, 300)).to.equal(false);
    });
    it('is symmetric', () => {
        (0, chai_1.expect)((0, overlap_1.rangesOverlap)(50, 150, 0, 100)).to.equal((0, overlap_1.rangesOverlap)(0, 100, 50, 150));
    });
});
describe('overlap.conflictDocId', () => {
    it('produces the same ID regardless of event argument order', () => {
        const a = (0, overlap_1.conflictDocId)('user1', 'eventA', 'eventB');
        const b = (0, overlap_1.conflictDocId)('user1', 'eventB', 'eventA');
        (0, chai_1.expect)(a).to.equal(b);
    });
    it('differs for different users with the same event pair', () => {
        const a = (0, overlap_1.conflictDocId)('user1', 'eventA', 'eventB');
        const b = (0, overlap_1.conflictDocId)('user2', 'eventA', 'eventB');
        (0, chai_1.expect)(a).to.not.equal(b);
    });
});
//# sourceMappingURL=overlap.test.js.map