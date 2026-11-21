import 'package:cloud_functions/cloud_functions.dart';
import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter/material.dart';
import 'package:geolocator/geolocator.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
import '../../core/offline_checkin_queue.dart';

/// The Host-facing scan screen (blueprint §6). Every scan follows exactly
/// the flow in docs/QR_DATAFLOW.md: this screen's only job is to collect
/// the raw QR payload and a device location reading and hand both to the
/// `checkIn` Cloud Function — it makes no allow/deny decision itself.
/// The location reading is explicitly a hint on the server side; nothing
/// here should be read as "the client decides proximity".
///
/// Offline support (Phase 4): if the device has no connectivity when a
/// scan happens, the raw scan is queued locally (OfflineCheckInQueue)
/// instead of failing outright. Queued scans are still just raw data —
/// the server makes every real decision once synced; this screen never
/// grants attendance on its own. Sync happens automatically when
/// connectivity returns, or manually via the app bar action.
class QrScanScreen extends StatefulWidget {
  final String eventId;
  final String eventTitle;

  const QrScanScreen({super.key, required this.eventId, required this.eventTitle});

  @override
  State<QrScanScreen> createState() => _QrScanScreenState();
}

enum _ScanFeedback { none, checking, allowed, alreadyIn, denied, queued, error }

class _QrScanScreenState extends State<QrScanScreen> {
  final _controller = MobileScannerController();
  final _queue = OfflineCheckInQueue();
  _ScanFeedback _feedback = _ScanFeedback.none;
  String _message = '';
  bool _busy = false;
  int _pendingCount = 0;
  bool _syncing = false;

  @override
  void initState() {
    super.initState();
    _refreshPendingCount();
    Connectivity().onConnectivityChanged.listen((results) {
      final isOnline = !results.contains(ConnectivityResult.none);
      if (isOnline) _syncPending();
    });
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _refreshPendingCount() async {
    final items = await _queue.list();
    if (mounted) setState(() => _pendingCount = items.length);
  }

  Future<Position?> _getLocation() async {
    var permission = await Geolocator.checkPermission();
    if (permission == LocationPermission.denied) {
      permission = await Geolocator.requestPermission();
    }
    if (permission == LocationPermission.denied || permission == LocationPermission.deniedForever) {
      return null;
    }
    if (!await Geolocator.isLocationServiceEnabled()) return null;
    return Geolocator.getCurrentPosition(desiredAccuracy: LocationAccuracy.high);
  }

  bool _isNetworkError(Object e) {
    if (e is FirebaseFunctionsException) {
      return e.code == 'unavailable' || e.code == 'deadline-exceeded' || e.code == 'internal';
    }
    return true; // any other thrown error while calling out is treated as "couldn't reach the server"
  }

  Future<void> _handleDetect(BarcodeCapture capture) async {
    if (_busy) return;
    final barcodes = capture.barcodes;
    if (barcodes.isEmpty) return;
    final raw = barcodes.first.rawValue;
    if (raw == null) return;

    setState(() {
      _busy = true;
      _feedback = _ScanFeedback.checking;
      _message = 'Checking…';
    });

    try {
      final position = await _getLocation();
      if (position == null) {
        setState(() {
          _feedback = _ScanFeedback.error;
          _message = 'Turn on location to check attendees in.';
        });
        return;
      }

      final connectivity = await Connectivity().checkConnectivity();
      if (connectivity.contains(ConnectivityResult.none)) {
        await _queueOffline(raw, position);
        return;
      }

      await _callCheckIn(raw, position);
    } finally {
      // Brief pause so the Host sees the result before the scanner is
      // ready for the next person — avoids double-scanning the same code.
      await Future.delayed(const Duration(seconds: 2));
      if (mounted) {
        setState(() {
          _busy = false;
          _feedback = _ScanFeedback.none;
          _message = '';
        });
      }
    }
  }

  Future<void> _callCheckIn(String qrData, Position position) async {
    try {
      final callable = FirebaseFunctions.instance.httpsCallable('checkIn');
      final result = await callable.call({
        'eventId': widget.eventId,
        'qrData': qrData,
        'location': {'lat': position.latitude, 'lng': position.longitude},
      });
      final data = Map<String, dynamic>.from(result.data as Map);
      final scanResult = data['result'] as String;
      final message = data['message'] as String;

      setState(() {
        _message = message;
        switch (scanResult) {
          case 'ALLOWED':
            _feedback = _ScanFeedback.allowed;
            break;
          case 'ALREADY_CHECKED_IN':
            _feedback = _ScanFeedback.alreadyIn;
            break;
          default:
            _feedback = _ScanFeedback.denied;
        }
      });
    } catch (e) {
      if (_isNetworkError(e)) {
        await _queueOffline(qrData, position);
      } else {
        setState(() {
          _feedback = _ScanFeedback.error;
          _message = e is FirebaseFunctionsException ? (e.message ?? 'Could not check in.') : 'Could not check in.';
        });
      }
    }
  }

  Future<void> _queueOffline(String qrData, Position position) async {
    await _queue.add(PendingCheckIn(
      eventId: widget.eventId,
      eventTitle: widget.eventTitle,
      qrData: qrData,
      lat: position.latitude,
      lng: position.longitude,
      scannedAtMs: DateTime.now().millisecondsSinceEpoch,
    ));
    await _refreshPendingCount();
    setState(() {
      _feedback = _ScanFeedback.queued;
      _message = 'No connection — saved, will sync automatically.';
    });
  }

  Future<void> _syncPending() async {
    if (_syncing) return;
    final items = await _queue.list();
    if (items.isEmpty) return;

    setState(() => _syncing = true);
    var succeeded = 0;
    var failed = 0;

    for (final item in items) {
      try {
        final callable = FirebaseFunctions.instance.httpsCallable('checkIn');
        await callable.call({
          'eventId': item.eventId,
          'qrData': item.qrData,
          'location': {'lat': item.lat, 'lng': item.lng},
        });
        await _queue.remove(item.scannedAtMs);
        succeeded++;
      } catch (e) {
        if (!_isNetworkError(e)) {
          // A real decision came back (e.g. NOT_ALLOWED) — remove from
          // the queue either way, since retrying won't change a
          // definitive server answer, but count it separately so the
          // Host isn't told everything "succeeded".
          await _queue.remove(item.scannedAtMs);
          failed++;
        }
        // else: still offline — leave it queued for the next attempt.
      }
    }

    await _refreshPendingCount();
    setState(() => _syncing = false);

    if (mounted && (succeeded > 0 || failed > 0)) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Synced $succeeded check-in(s)${failed > 0 ? ', $failed were not allowed' : ''}.')),
      );
    }
  }

  Color _feedbackColor() {
    switch (_feedback) {
      case _ScanFeedback.allowed:
        return Colors.green;
      case _ScanFeedback.alreadyIn:
        return Colors.blue;
      case _ScanFeedback.denied:
        return Colors.red;
      case _ScanFeedback.queued:
        return Colors.deepPurple;
      case _ScanFeedback.error:
        return Colors.orange;
      default:
        return Colors.black54;
    }
  }

  IconData _feedbackIcon() {
    switch (_feedback) {
      case _ScanFeedback.allowed:
        return Icons.check_circle;
      case _ScanFeedback.alreadyIn:
        return Icons.info;
      case _ScanFeedback.denied:
        return Icons.cancel;
      case _ScanFeedback.queued:
        return Icons.cloud_off;
      case _ScanFeedback.error:
        return Icons.warning;
      default:
        return Icons.qr_code_scanner;
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text('Scan · ${widget.eventTitle}'),
        actions: [
          Stack(
            alignment: Alignment.center,
            children: [
              IconButton(
                icon: Icon(_syncing ? Icons.sync : Icons.sync_outlined),
                tooltip: 'Sync pending check-ins',
                onPressed: _syncing ? null : _syncPending,
              ),
              if (_pendingCount > 0)
                Positioned(
                  right: 6,
                  top: 6,
                  child: Container(
                    padding: const EdgeInsets.all(3),
                    decoration: const BoxDecoration(color: Colors.deepPurple, shape: BoxShape.circle),
                    constraints: const BoxConstraints(minWidth: 16, minHeight: 16),
                    child: Text(
                      '$_pendingCount',
                      style: const TextStyle(color: Colors.white, fontSize: 10),
                      textAlign: TextAlign.center,
                    ),
                  ),
                ),
            ],
          ),
        ],
      ),
      body: Stack(
        children: [
          MobileScanner(controller: _controller, onDetect: _handleDetect),
          if (_feedback != _ScanFeedback.none)
            Positioned(
              left: 0,
              right: 0,
              bottom: 0,
              child: Container(
                color: _feedbackColor(),
                padding: const EdgeInsets.symmetric(vertical: 24, horizontal: 16),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Icon(_feedbackIcon(), color: Colors.white, size: 28),
                    const SizedBox(width: 12),
                    Flexible(
                      child: Text(
                        _message,
                        style: const TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.w600),
                        textAlign: TextAlign.center,
                      ),
                    ),
                  ],
                ),
              ),
            ),
        ],
      ),
    );
  }
}
