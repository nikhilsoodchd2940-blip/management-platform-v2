import 'dart:convert';
import 'package:shared_preferences/shared_preferences.dart';

/// A QR scan the Host made while offline (or while the checkIn call
/// failed for a network reason), waiting to be synced. Deliberately
/// stores the RAW scanned data, not a decision — the server still makes
/// every authorization call once synced (docs/QR_DATAFLOW.md); this queue
/// never grants attendance on its own, it just remembers what to ask the
/// server once connectivity is back.
class PendingCheckIn {
  final String eventId;
  final String eventTitle;
  final String qrData;
  final double lat;
  final double lng;
  final int scannedAtMs;

  PendingCheckIn({
    required this.eventId,
    required this.eventTitle,
    required this.qrData,
    required this.lat,
    required this.lng,
    required this.scannedAtMs,
  });

  Map<String, dynamic> toJson() => {
        'eventId': eventId,
        'eventTitle': eventTitle,
        'qrData': qrData,
        'lat': lat,
        'lng': lng,
        'scannedAtMs': scannedAtMs,
      };

  factory PendingCheckIn.fromJson(Map<String, dynamic> json) => PendingCheckIn(
        eventId: json['eventId'] as String,
        eventTitle: json['eventTitle'] as String,
        qrData: json['qrData'] as String,
        lat: (json['lat'] as num).toDouble(),
        lng: (json['lng'] as num).toDouble(),
        scannedAtMs: json['scannedAtMs'] as int,
      );
}

const _storageKey = 'pending_check_ins_v1';

class OfflineCheckInQueue {
  Future<List<PendingCheckIn>> list() async {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString(_storageKey);
    if (raw == null || raw.isEmpty) return [];
    final decoded = jsonDecode(raw) as List<dynamic>;
    return decoded.map((e) => PendingCheckIn.fromJson(e as Map<String, dynamic>)).toList();
  }

  Future<void> add(PendingCheckIn item) async {
    final items = await list();
    items.add(item);
    await _save(items);
  }

  /// Removes by scannedAtMs — good enough as a unique key within one
  /// device's queue (two scans in the same millisecond is not a real risk
  /// for a human tapping a phone at a QR code).
  Future<void> remove(int scannedAtMs) async {
    final items = await list();
    items.removeWhere((i) => i.scannedAtMs == scannedAtMs);
    await _save(items);
  }

  Future<void> _save(List<PendingCheckIn> items) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_storageKey, jsonEncode(items.map((e) => e.toJson()).toList()));
  }
}
