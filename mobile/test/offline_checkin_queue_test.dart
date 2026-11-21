import 'package:flutter_test/flutter_test.dart';
import 'package:management_platform/core/offline_checkin_queue.dart';

void main() {
  group('PendingCheckIn', () {
    test('toJson/fromJson round-trips all fields exactly', () {
      final original = PendingCheckIn(
        eventId: 'event123',
        eventTitle: 'Sunday Service',
        qrData: '{"userId":"u1","sig":"abc123"}',
        lat: 37.7749,
        lng: -122.4194,
        scannedAtMs: 1700000000000,
      );

      final restored = PendingCheckIn.fromJson(original.toJson());

      expect(restored.eventId, original.eventId);
      expect(restored.eventTitle, original.eventTitle);
      expect(restored.qrData, original.qrData);
      expect(restored.lat, original.lat);
      expect(restored.lng, original.lng);
      expect(restored.scannedAtMs, original.scannedAtMs);
    });

    test('fromJson handles integer lat/lng (JSON numbers without decimals)', () {
      // A location that happens to land on a whole number should still
      // decode correctly — jsonDecode gives an int in that case, not a
      // double, so fromJson must handle both via num.
      final json = {
        'eventId': 'e1',
        'eventTitle': 'Test',
        'qrData': 'data',
        'lat': 40, // int, not 40.0
        'lng': -70,
        'scannedAtMs': 123456,
      };

      final restored = PendingCheckIn.fromJson(json);

      expect(restored.lat, 40.0);
      expect(restored.lng, -70.0);
    });
  });
}
