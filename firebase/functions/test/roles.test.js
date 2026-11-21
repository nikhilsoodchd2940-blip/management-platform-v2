"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const chai_1 = require("chai");
const roles_1 = require("../src/modules/auth/roles");
describe('roles.isValidRole', () => {
    it('accepts the three defined roles', () => {
        (0, chai_1.expect)((0, roles_1.isValidRole)('admin')).to.equal(true);
        (0, chai_1.expect)((0, roles_1.isValidRole)('host')).to.equal(true);
        (0, chai_1.expect)((0, roles_1.isValidRole)('member')).to.equal(true);
    });
    it('rejects unknown strings, wrong types, and undefined', () => {
        (0, chai_1.expect)((0, roles_1.isValidRole)('superadmin')).to.equal(false);
        (0, chai_1.expect)((0, roles_1.isValidRole)('')).to.equal(false);
        (0, chai_1.expect)((0, roles_1.isValidRole)(42)).to.equal(false);
        (0, chai_1.expect)((0, roles_1.isValidRole)(undefined)).to.equal(false);
        (0, chai_1.expect)((0, roles_1.isValidRole)(null)).to.equal(false);
    });
});
//# sourceMappingURL=roles.test.js.map