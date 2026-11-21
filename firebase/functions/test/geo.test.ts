import { expect } from 'chai';
import { haversineDistanceMeters, isWithinRadius } from '../src/utils/geo';

describe('geo.haversineDistanceMeters', () => {
  it('returns ~0 for the same point', () => {
    const p = { lat: 40.7128, lng: -74.006 };
    expect(haversineDistanceMeters(p, p)).to.be.closeTo(0, 0.001);
  });

  it('returns a known approximate distance (NYC to Philadelphia, ~130km)', () => {
    const nyc = { lat: 40.7128, lng: -74.006 };
    const philly = { lat: 39.9526, lng: -75.1652 };
    const distanceKm = haversineDistanceMeters(nyc, philly) / 1000;
    expect(distanceKm).to.be.closeTo(130, 10);
  });

  it('is symmetric', () => {
    const a = { lat: 51.5074, lng: -0.1278 };
    const b = { lat: 48.8566, lng: 2.3522 };
    expect(haversineDistanceMeters(a, b)).to.be.closeTo(haversineDistanceMeters(b, a), 0.001);
  });
});

describe('geo.isWithinRadius', () => {
  const center = { lat: 37.7749, lng: -122.4194 };

  it('accepts a point at the exact same location', () => {
    expect(isWithinRadius(center, center, 50)).to.equal(true);
  });

  it('rejects a point well outside a small radius', () => {
    const farPoint = { lat: 37.8044, lng: -122.2712 }; // Oakland, several km away
    expect(isWithinRadius(farPoint, center, 100)).to.equal(false);
  });

  it('accepts a point just inside the radius, rejects just outside', () => {
    // ~0.0009 degrees latitude is roughly 100m
    const justInside = { lat: center.lat + 0.0007, lng: center.lng };
    const justOutside = { lat: center.lat + 0.002, lng: center.lng };
    expect(isWithinRadius(justInside, center, 100)).to.equal(true);
    expect(isWithinRadius(justOutside, center, 100)).to.equal(false);
  });
});
