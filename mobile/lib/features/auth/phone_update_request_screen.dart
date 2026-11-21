import 'package:flutter/material.dart';
import 'package:intl_phone_field/intl_phone_field.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'registration_service.dart';

/// For someone whose phone number changed since an Admin loaded their
/// record — they can't complete registration (Member ID + phone won't
/// match) and have no session to call an authenticated function, so this
/// is deliberately reachable with nothing but their Member ID. An Admin
/// reviews and approves it from the web Approvals page; see
/// firebase/functions/src/modules/members/phoneUpdateRequests.ts.
class PhoneUpdateRequestScreen extends StatefulWidget {
  const PhoneUpdateRequestScreen({super.key});

  @override
  State<PhoneUpdateRequestScreen> createState() => _PhoneUpdateRequestScreenState();
}

class _PhoneUpdateRequestScreenState extends State<PhoneUpdateRequestScreen> {
  final _reg = RegistrationService();
  final _memberIdController = TextEditingController();
  final _noteController = TextEditingController();

  String _phone = '';
  bool _busy = false;
  bool _submitted = false;
  String? _error;

  Future<void> _submit() async {
    final memberId = _memberIdController.text.trim();
    if (memberId.isEmpty || _phone.isEmpty) {
      setState(() => _error = 'Enter your Member ID and new phone number');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await _reg.requestPhoneUpdate(memberId, _phone, note: _noteController.text);
      if (mounted) setState(() => _submitted = true);
    } catch (e) {
      final msg = e is FirebaseFunctionsException ? e.message : null;
      setState(() => _error = msg ?? 'Something went wrong. Try again.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  void dispose() {
    _memberIdController.dispose();
    _noteController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Update phone number')),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if (_submitted) ...[
                const Icon(Icons.check_circle_outline, size: 48, color: Colors.green),
                const SizedBox(height: 16),
                Text('Request sent', style: Theme.of(context).textTheme.headlineSmall, textAlign: TextAlign.center),
                const SizedBox(height: 8),
                Text(
                  "Your admin will review this and update your number. Once they do, you can register or sign in with your new phone.",
                  style: Theme.of(context).textTheme.bodyMedium,
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 20),
                OutlinedButton(
                  onPressed: () => Navigator.of(context).pop(),
                  child: const Text('Back to sign in'),
                ),
              ] else ...[
                Text('Update your phone number', style: Theme.of(context).textTheme.headlineSmall),
                const SizedBox(height: 8),
                Text(
                  "If your phone number has changed since you registered, tell us your Member ID and new number "
                  "— your admin will review and update it so you can sign in.",
                  style: Theme.of(context).textTheme.bodyMedium,
                ),
                const SizedBox(height: 24),
                TextField(
                  controller: _memberIdController,
                  textCapitalization: TextCapitalization.characters,
                  decoration: const InputDecoration(labelText: 'Member ID', border: OutlineInputBorder()),
                ),
                const SizedBox(height: 14),
                IntlPhoneField(
                  decoration: const InputDecoration(labelText: 'New phone number', border: OutlineInputBorder()),
                  initialCountryCode: 'US',
                  onChanged: (phone) => _phone = phone.completeNumber,
                ),
                const SizedBox(height: 14),
                TextField(
                  controller: _noteController,
                  maxLines: 2,
                  decoration: const InputDecoration(
                    labelText: 'Note (optional)',
                    hintText: 'e.g. "Lost my old SIM"',
                    border: OutlineInputBorder(),
                  ),
                ),
                if (_error != null) ...[
                  const SizedBox(height: 12),
                  Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
                ],
                const SizedBox(height: 20),
                FilledButton(
                  onPressed: _busy ? null : _submit,
                  child: Text(_busy ? 'Sending…' : 'Send request'),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}
