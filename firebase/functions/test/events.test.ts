import { expect } from 'chai';
import { validateEventInput } from '../src/modules/events/events';

const baseInput = {
  title: 'Sunday Service',
  mainGroupId: 'main1',
  subGroupIds: ['sub1'],
  location: { lat: 37.7749, lng: -122.4194 },
  geofenceRadiusMeters: 100,
  startAtMs: 1_000_000,
  endAtMs: 2_000_000,
};

describe('events.validateEventInput', () => {
  it('accepts a well-formed input', () => {
    expect(() => validateEventInput(baseInput)).to.not.throw();
  });

  it('rejects a missing/blank title', () => {
    expect(() => validateEventInput({ ...baseInput, title: '  ' })).to.throw();
  });

  it('rejects a missing mainGroupId', () => {
    expect(() => validateEventInput({ ...baseInput, mainGroupId: '' })).to.throw();
  });

  it('rejects non-numeric or missing lat/lng', () => {
    expect(() =>
      validateEventInput({ ...baseInput, location: { lat: NaN, lng: -122.4194 } })
    ).to.throw();
  });

  it('rejects a zero or negative geofence radius', () => {
    expect(() => validateEventInput({ ...baseInput, geofenceRadiusMeters: 0 })).to.throw();
    expect(() => validateEventInput({ ...baseInput, geofenceRadiusMeters: -5 })).to.throw();
  });

  it('rejects endAt at or before startAt', () => {
    expect(() =>
      validateEventInput({ ...baseInput, startAtMs: 2_000_000, endAtMs: 2_000_000 })
    ).to.throw();
    expect(() =>
      validateEventInput({ ...baseInput, startAtMs: 2_000_000, endAtMs: 1_000_000 })
    ).to.throw();
  });
});
