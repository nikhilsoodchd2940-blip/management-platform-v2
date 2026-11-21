import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/material.dart';
import 'package:qr_flutter/qr_flutter.dart';

/// Displays the member's one stable personal QR (blueprint §5 —
/// "Display one unique personal QR tied to the account"). Fetched once
/// from the getPersonalQr callable (firebase/functions/src/modules/qr/personalQr.ts)
/// and cached for the session — it's stateless/non-expiring by design, so
/// there's no need to refetch on every screen visit. New: a colored hero
/// header matching the rest of the app, and a numbered "how it works"
/// section — purely explanatory UI, no new data or dependencies.
class MyQrScreen extends StatefulWidget {
  const MyQrScreen({super.key});

  @override
  State<MyQrScreen> createState() => _MyQrScreenState();
}

class _MyQrScreenState extends State<MyQrScreen> {
  String? _qrData;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _error = null);
    try {
      final callable = FirebaseFunctions.instance.httpsCallable('getPersonalQr');
      final result = await callable.call();
      setState(() => _qrData = (result.data as Map)['qrData'] as String);
    } catch (e) {
      setState(() => _error = 'Could not load your QR code. Pull down to retry.');
    }
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;

    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
        children: [
          Container(
            padding: const EdgeInsets.all(18),
            decoration: BoxDecoration(
              gradient: LinearGradient(
                colors: [scheme.primary, scheme.primary.withOpacity(0.75)],
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
              ),
              borderRadius: BorderRadius.circular(20),
            ),
            child: Row(
              children: [
                Container(
                  width: 48,
                  height: 48,
                  decoration: BoxDecoration(color: Colors.white.withOpacity(0.2), borderRadius: BorderRadius.circular(14)),
                  child: const Icon(Icons.qr_code_2_rounded, color: Colors.white, size: 26),
                ),
                const SizedBox(width: 14),
                const Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('Your personal QR', style: TextStyle(color: Colors.white, fontSize: 17, fontWeight: FontWeight.w700)),
                      SizedBox(height: 2),
                      Text('One code, tied to your account', style: TextStyle(color: Colors.white70, fontSize: 12.5)),
                    ],
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 24),
          if (_error != null)
            Center(
              child: Column(
                children: [
                  Icon(Icons.wifi_off_rounded, size: 36, color: scheme.error),
                  const SizedBox(height: 10),
                  Text(_error!, textAlign: TextAlign.center, style: TextStyle(color: scheme.error)),
                ],
              ),
            )
          else if (_qrData == null)
            const Center(child: CircularProgressIndicator())
          else
            Center(
              child: Container(
                padding: const EdgeInsets.all(20),
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(20),
                  border: Border.all(color: scheme.outlineVariant.withOpacity(0.4)),
                  boxShadow: [BoxShadow(color: scheme.primary.withOpacity(0.12), blurRadius: 24, offset: const Offset(0, 10))],
                ),
                child: QrImageView(data: _qrData!, size: 220, gapless: true),
              ),
            ),
          const SizedBox(height: 28),
          const Text('How check-in works', style: TextStyle(fontSize: 15, fontWeight: FontWeight.w700)),
          const SizedBox(height: 12),
          const _QrStep(
            number: 1,
            color: Color(0xFF2563EB),
            bg: Color(0xFFE3EBFF),
            title: 'Open this screen at the event',
            subtitle: 'Your code never changes, so there\'s nothing to refresh or regenerate.',
          ),
          const SizedBox(height: 10),
          const _QrStep(
            number: 2,
            color: Color(0xFF16A34A),
            bg: Color(0xFFDFF5E5),
            title: 'Show it to the host',
            subtitle: 'They\'ll scan it with their own device to record your attendance.',
          ),
          const SizedBox(height: 10),
          const _QrStep(
            number: 3,
            color: Color(0xFF7C3AED),
            bg: Color(0xFFEEE3FF),
            title: 'You\'re checked in',
            subtitle: 'It shows up right away on your Events tab and the Home dashboard.',
          ),
        ],
      ),
    );
  }
}

class _QrStep extends StatelessWidget {
  const _QrStep({
    required this.number,
    required this.color,
    required this.bg,
    required this.title,
    required this.subtitle,
  });
  final int number;
  final Color color;
  final Color bg;
  final String title;
  final String subtitle;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(16)),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 28,
            height: 28,
            alignment: Alignment.center,
            decoration: BoxDecoration(color: Colors.white.withOpacity(0.6), borderRadius: BorderRadius.circular(9)),
            child: Text('$number', style: TextStyle(color: color, fontWeight: FontWeight.w800, fontSize: 13)),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: TextStyle(fontWeight: FontWeight.w700, fontSize: 13.5, color: color)),
                const SizedBox(height: 2),
                Text(subtitle, style: TextStyle(fontSize: 12, color: color.withOpacity(0.8), height: 1.3)),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
