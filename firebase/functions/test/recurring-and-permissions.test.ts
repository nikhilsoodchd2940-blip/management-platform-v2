import { expect } from 'chai';
import { addOccurrence } from '../src/modules/events/recurring';
import { isValidPermission } from '../src/modules/admin/permissions';

describe('recurring.addOccurrence', () => {
  const start = new Date('2026-01-05T18:00:00.000Z'); // a Monday

  it('adds exactly 7 days per weekly occurrence', () => {
    const third = addOccurrence(start, 'weekly', 2);
    const expectedMs = start.getTime() + 2 * 7 * 24 * 60 * 60 * 1000;
    expect(third.getTime()).to.equal(expectedMs);
  });

  it('returns the same date for occurrence 0', () => {
    expect(addOccurrence(start, 'weekly', 0).getTime()).to.equal(start.getTime());
    expect(addOccurrence(start, 'monthly', 0).getTime()).to.equal(start.getTime());
  });

  it('advances by calendar months for monthly, preserving day/time', () => {
    const third = addOccurrence(start, 'monthly', 2);
    expect(third.getUTCMonth()).to.equal((start.getUTCMonth() + 2) % 12);
    expect(third.getUTCDate()).to.equal(start.getUTCDate());
    expect(third.getUTCHours()).to.equal(start.getUTCHours());
  });

  it('rolls over into the next year correctly', () => {
    const novStart = new Date('2026-11-15T12:00:00.000Z');
    const result = addOccurrence(novStart, 'monthly', 3); // Nov -> Feb next year
    expect(result.getUTCFullYear()).to.equal(2027);
    expect(result.getUTCMonth()).to.equal(1); // February
  });
});

describe('permissions.isValidPermission', () => {
  it('accepts each defined permission', () => {
    expect(isValidPermission('groups')).to.equal(true);
    expect(isValidPermission('members')).to.equal(true);
    expect(isValidPermission('events')).to.equal(true);
    expect(isValidPermission('requests')).to.equal(true);
    expect(isValidPermission('donations')).to.equal(true);
    expect(isValidPermission('reports')).to.equal(true);
  });

  it('rejects unknown strings and non-strings', () => {
    expect(isValidPermission('super_admin')).to.equal(false);
    expect(isValidPermission('')).to.equal(false);
    expect(isValidPermission(42)).to.equal(false);
    expect(isValidPermission(null)).to.equal(false);
    expect(isValidPermission(undefined)).to.equal(false);
  });
});
