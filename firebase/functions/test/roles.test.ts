import { expect } from 'chai';
import { isValidRole } from '../src/modules/auth/roles';

describe('roles.isValidRole', () => {
  it('accepts the three defined roles', () => {
    expect(isValidRole('admin')).to.equal(true);
    expect(isValidRole('host')).to.equal(true);
    expect(isValidRole('member')).to.equal(true);
  });

  it('rejects unknown strings, wrong types, and undefined', () => {
    expect(isValidRole('superadmin')).to.equal(false);
    expect(isValidRole('')).to.equal(false);
    expect(isValidRole(42)).to.equal(false);
    expect(isValidRole(undefined)).to.equal(false);
    expect(isValidRole(null)).to.equal(false);
  });
});
