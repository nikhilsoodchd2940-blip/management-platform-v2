"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const chai_1 = require("chai");
const geo_1 = require("../src/utils/geo");
describe('geo.haversineDistanceMeters', () => {
    it('returns ~0 for the same point', () => {
        const p = { lat: 40.7128, lng: -74.006 };
        (0, chai_1.expect)((0, geo_1.haversineDistanceMeters)(p, p)).to.be.closeTo(0, 0.001);
    });
    it('returns a known approximate distance (NYC to Philadelphia, ~130km)', () => {
        const nyc = { lat: 40.7128, lng: -74.006 };
        const philly = { lat: 39.9526, lng: -75.1652 };
        const distanceKm = (0, geo_1.haversineDistanceMeters)(nyc, philly) / 1000;
        (0, chai_1.expect)(distanceKm).to.be.closeTo(130, 10);
    });
    it('is symmetric', () => {
        const a = { lat: 51.5074, lng: -0.1278 };
        const b = { lat: 48.8566, lng: 2.3522 };
        (0, chai_1.expect)((0, geo_1.haversineDistanceMeters)(a, b)).to.be.closeTo((0, geo_1.haversineDistanceMeters)(b, a), 0.001);
    });
});
describe('geo.isWithinRadius', () => {
    const center = { lat: 37.7749, lng: -122.4194 };
    it('accepts a point at the exact same location', () => {
        (0, chai_1.expect)((0, geo_1.isWithinRadius)(center, center, 50)).to.equal(true);
    });
    it('rejects a point well outside a small radius', () => {
        const farPoint = { lat: 37.8044, lng: -122.2712 }; // Oakland, several km away
        (0, chai_1.expect)((0, geo_1.isWithinRadius)(farPoint, center, 100)).to.equal(false);
    });
    it('accepts a point just inside the radius, rejects just outside', () => {
        // ~0.0009 degrees latitude is roughly 100m
        const justInside = { lat: center.lat + 0.0007, lng: center.lng };
        const justOutside = { lat: center.lat + 0.002, lng: center.lng };
        (0, chai_1.expect)((0, geo_1.isWithinRadius)(justInside, center, 100)).to.equal(true);
        (0, chai_1.expect)((0, geo_1.isWithinRadius)(justOutside, center, 100)).to.equal(false);
    });
});
//# sourceMappingURL=geo.test.js.map