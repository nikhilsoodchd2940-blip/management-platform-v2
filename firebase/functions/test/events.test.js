"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const chai_1 = require("chai");
const events_1 = require("../src/modules/events/events");
const baseInput = {
    title: 'Sunday Service',
    mainGroupId: 'main1',
    subGroupIds: ['sub1'],
    location: { lat: 37.7749, lng: -122.4194 },
    geofenceRadiusMeters: 100,
    startAtMs: 1000000,
    endAtMs: 2000000,
};
describe('events.validateEventInput', () => {
    it('accepts a well-formed input', () => {
        (0, chai_1.expect)(() => (0, events_1.validateEventInput)(baseInput)).to.not.throw();
    });
    it('rejects a missing/blank title', () => {
        (0, chai_1.expect)(() => (0, events_1.validateEventInput)({ ...baseInput, title: '  ' })).to.throw();
    });
    it('rejects a missing mainGroupId', () => {
        (0, chai_1.expect)(() => (0, events_1.validateEventInput)({ ...baseInput, mainGroupId: '' })).to.throw();
    });
    it('rejects non-numeric or missing lat/lng', () => {
        (0, chai_1.expect)(() => (0, events_1.validateEventInput)({ ...baseInput, location: { lat: NaN, lng: -122.4194 } })).to.throw();
    });
    it('rejects a zero or negative geofence radius', () => {
        (0, chai_1.expect)(() => (0, events_1.validateEventInput)({ ...baseInput, geofenceRadiusMeters: 0 })).to.throw();
        (0, chai_1.expect)(() => (0, events_1.validateEventInput)({ ...baseInput, geofenceRadiusMeters: -5 })).to.throw();
    });
    it('rejects endAt at or before startAt', () => {
        (0, chai_1.expect)(() => (0, events_1.validateEventInput)({ ...baseInput, startAtMs: 2000000, endAtMs: 2000000 })).to.throw();
        (0, chai_1.expect)(() => (0, events_1.validateEventInput)({ ...baseInput, startAtMs: 2000000, endAtMs: 1000000 })).to.throw();
    });
});
//# sourceMappingURL=events.test.js.map