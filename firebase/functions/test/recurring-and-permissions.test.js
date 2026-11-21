"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const chai_1 = require("chai");
const recurring_1 = require("../src/modules/events/recurring");
const permissions_1 = require("../src/modules/admin/permissions");
describe('recurring.addOccurrence', () => {
    const start = new Date('2026-01-05T18:00:00.000Z'); // a Monday
    it('adds exactly 7 days per weekly occurrence', () => {
        const third = (0, recurring_1.addOccurrence)(start, 'weekly', 2);
        const expectedMs = start.getTime() + 2 * 7 * 24 * 60 * 60 * 1000;
        (0, chai_1.expect)(third.getTime()).to.equal(expectedMs);
    });
    it('returns the same date for occurrence 0', () => {
        (0, chai_1.expect)((0, recurring_1.addOccurrence)(start, 'weekly', 0).getTime()).to.equal(start.getTime());
        (0, chai_1.expect)((0, recurring_1.addOccurrence)(start, 'monthly', 0).getTime()).to.equal(start.getTime());
    });
    it('advances by calendar months for monthly, preserving day/time', () => {
        const third = (0, recurring_1.addOccurrence)(start, 'monthly', 2);
        (0, chai_1.expect)(third.getUTCMonth()).to.equal((start.getUTCMonth() + 2) % 12);
        (0, chai_1.expect)(third.getUTCDate()).to.equal(start.getUTCDate());
        (0, chai_1.expect)(third.getUTCHours()).to.equal(start.getUTCHours());
    });
    it('rolls over into the next year correctly', () => {
        const novStart = new Date('2026-11-15T12:00:00.000Z');
        const result = (0, recurring_1.addOccurrence)(novStart, 'monthly', 3); // Nov -> Feb next year
        (0, chai_1.expect)(result.getUTCFullYear()).to.equal(2027);
        (0, chai_1.expect)(result.getUTCMonth()).to.equal(1); // February
    });
});
describe('permissions.isValidPermission', () => {
    it('accepts each defined permission', () => {
        (0, chai_1.expect)((0, permissions_1.isValidPermission)('groups')).to.equal(true);
        (0, chai_1.expect)((0, permissions_1.isValidPermission)('members')).to.equal(true);
        (0, chai_1.expect)((0, permissions_1.isValidPermission)('events')).to.equal(true);
        (0, chai_1.expect)((0, permissions_1.isValidPermission)('requests')).to.equal(true);
        (0, chai_1.expect)((0, permissions_1.isValidPermission)('donations')).to.equal(true);
        (0, chai_1.expect)((0, permissions_1.isValidPermission)('reports')).to.equal(true);
    });
    it('rejects unknown strings and non-strings', () => {
        (0, chai_1.expect)((0, permissions_1.isValidPermission)('super_admin')).to.equal(false);
        (0, chai_1.expect)((0, permissions_1.isValidPermission)('')).to.equal(false);
        (0, chai_1.expect)((0, permissions_1.isValidPermission)(42)).to.equal(false);
        (0, chai_1.expect)((0, permissions_1.isValidPermission)(null)).to.equal(false);
        (0, chai_1.expect)((0, permissions_1.isValidPermission)(undefined)).to.equal(false);
    });
});
//# sourceMappingURL=recurring-and-permissions.test.js.map