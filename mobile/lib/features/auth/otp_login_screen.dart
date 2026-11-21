import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl_phone_field/intl_phone_field.dart';
import '../../core/session.dart';
import 'auth_service.dart';
import 'registration_screen.dart';
import 'org_settings_service.dart';
import 'contact_admin_card.dart';
import 'phone_update_request_screen.dart';

enum _Step { phone, code }

/// Phone entry uses a country-code picker (flag + dial code dropdown,
/// defaulting to the device's locale where possible) instead of asking
/// the person to type "+15551234567" themselves — intl_phone_field
/// hands back a properly formatted E.164 number via completeNumber,
/// which is what sendOtp/verifyOtp (Twilio Verify, see auth_service.dart)
/// require.
class OtpLoginScreen extends ConsumerStatefulWidget {
  const OtpLoginScreen({super.key});

  @override
  ConsumerState<OtpLoginScreen> createState() => _OtpLoginScreenState();
}

class _OtpLoginScreenState extends ConsumerState<OtpLoginScreen> {
  final _auth = AuthService();
  final _orgSettings = OrgSettingsService();
  final _codeController = TextEditingController();

  _Step _step = _Step.phone;
  bool _busy = false;
  String? _error;
  String _phone = ''; // E.164, filled in by IntlPhoneField's onChanged

  Future<void> _showHelpSheet() async {
    final contact = await _orgSettings.fetchSupportContact();
    if (!mounted) return;
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (context) => Padding(
        padding: EdgeInsets.only(
          left: 20,
          right: 20,
          top: 20,
          bottom: MediaQuery.of(context).viewInsets.bottom + 20,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text('Need help signing in?', style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 8),
            ContactAdminCard(contact: contact),
            const SizedBox(height: 16),
            OutlinedButton(
              onPressed: () {
                Navigator.of(context).pop();
                Navigator.of(context).push(
                  MaterialPageRoute(builder: (_) => const PhoneUpdateRequestScreen()),
                );
              },
              child: const Text('My phone number changed'),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _sendCode() async {
    if (_phone.isEmpty) {
      setState(() => _error = 'Enter your phone number');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await _auth.sendOtp(_phone);
      setState(() => _step = _Step.code);
    } catch (e) {
      setState(() => _error = 'Could not send code. Check the number and try again.');
    } finally {
      setState(() => _busy = false);
    }
  }

  Future<void> _verifyCode() async {
    final code = _codeController.text.trim();
    if (code.isEmpty) {
      setState(() => _error = 'Enter the code you received');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await _auth.verifyOtpAndSignIn(_phone, code);
      await ref.read(sessionProvider.notifier).refresh();
      // Navigation on success is handled by the router's redirect logic
      // reacting to sessionProvider — see core/app_router.dart.
    } catch (e) {
      // Closed registration (see firebase/functions/src/modules/auth/otp.ts
      // verifyOtp): an unrecognized number means nobody has registered it
      // yet, not that the code was wrong — point them at Register instead
      // of leaving them stuck retrying a code that will never work.
      setState(() => _error = 'That code didn\'t work, or this number isn\'t registered yet. Check it, or tap Register below.');
    } finally {
      setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Text(
                _step == _Step.phone ? 'Sign in' : 'Enter your code',
                style: Theme.of(context).textTheme.headlineSmall,
              ),
              const SizedBox(height: 8),
              Text(
                _step == _Step.phone
                    ? 'We\'ll text you a one-time code.'
                    : 'We sent a code to $_phone.',
                style: Theme.of(context).textTheme.bodyMedium,
              ),
              const SizedBox(height: 24),
              if (_step == _Step.phone)
                IntlPhoneField(
                  decoration: const InputDecoration(
                    labelText: 'Phone number',
                    border: OutlineInputBorder(),
                  ),
                  initialCountryCode: 'US',
                  onChanged: (phone) => _phone = phone.completeNumber,
                )
              else
                TextField(
                  controller: _codeController,
                  keyboardType: TextInputType.number,
                  decoration: const InputDecoration(
                    labelText: 'Verification code',
                    border: OutlineInputBorder(),
                  ),
                ),
              if (_error != null) ...[
                const SizedBox(height: 12),
                Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
              ],
              const SizedBox(height: 20),
              FilledButton(
                onPressed: _busy ? null : (_step == _Step.phone ? _sendCode : _verifyCode),
                child: Text(_busy
                    ? 'Please wait…'
                    : (_step == _Step.phone ? 'Send code' : 'Verify')),
              ),
              if (_step == _Step.code)
                TextButton(
                  onPressed: _busy
                      ? null
                      : () => setState(() {
                            _step = _Step.phone;
                            _error = null;
                          }),
                  child: const Text('Use a different number'),
                ),
              if (_step == _Step.phone) ...[
                const SizedBox(height: 8),
                TextButton(
                  onPressed: _busy
                      ? null
                      : () => Navigator.of(context).push(
                            MaterialPageRoute(builder: (_) => const RegistrationScreen()),
                          ),
                  child: const Text('New here? Register with your Member ID'),
                ),
              ],
              const SizedBox(height: 4),
              TextButton(
                onPressed: _busy ? null : _showHelpSheet,
                child: const Text('Need help signing in? Contact your admin'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}