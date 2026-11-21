import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';
import 'package:intl_phone_field/intl_phone_field.dart';
import 'package:cloud_functions/cloud_functions.dart';
import '../../core/session.dart';
import 'registration_service.dart';
import 'org_settings_service.dart';
import 'contact_admin_card.dart';
import 'phone_update_request_screen.dart';

enum _Step { matchIdentity, code, photo }

/// First-time registration — separate from OtpLoginScreen (plain
/// returning-user login). Gated on a Member ID an Admin already
/// pre-loaded (firebase/functions/src/modules/groups/members.ts): the
/// Member ID and phone must match, then OTP, then a mandatory photo (+
/// optional email) before the request goes to an Admin for approval.
/// See firebase/functions/src/modules/auth/registration.ts.
class RegistrationScreen extends ConsumerStatefulWidget {
  const RegistrationScreen({super.key});

  @override
  ConsumerState<RegistrationScreen> createState() => _RegistrationScreenState();
}

class _RegistrationScreenState extends ConsumerState<RegistrationScreen> {
  final _reg = RegistrationService();
  final _orgSettings = OrgSettingsService();
  final _memberIdController = TextEditingController();
  final _codeController = TextEditingController();
  final _emailController = TextEditingController();
  final _picker = ImagePicker();

  _Step _step = _Step.matchIdentity;
  bool _busy = false;
  String? _error;
  String _phone = '';
  File? _photo;

  // Set only when the specific "Member ID and phone don't match" error
  // comes back — the most common real-world cause is the member's
  // number changed since the admin uploaded their record, which isn't
  // something they can self-serve, hence surfacing a way to reach the
  // admin instead of leaving this as a dead-end error.
  OrgSupportContact? _mismatchContact;

  String get _memberId => _memberIdController.text.trim();

  String _friendlyError(Object e) {
    if (e is FirebaseFunctionsException) return e.message ?? 'Something went wrong. Try again.';
    return 'Something went wrong. Try again.';
  }

  bool _isMismatchError(Object e) {
    if (e is! FirebaseFunctionsException) return false;
    final msg = (e.message ?? '').toLowerCase();
    return msg.contains('do not match') || msg.contains("doesn't match") || msg.contains('does not match');
  }

  Future<void> _submitMatch() async {
    if (_memberId.isEmpty || _phone.isEmpty) {
      setState(() => _error = 'Enter your Member ID and phone number');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
      _mismatchContact = null;
    });
    try {
      await _reg.beginRegistration(_memberId, _phone);
      setState(() => _step = _Step.code);
    } catch (e) {
      setState(() => _error = _friendlyError(e));
      if (_isMismatchError(e)) {
        final contact = await _orgSettings.fetchSupportContact();
        if (mounted) setState(() => _mismatchContact = contact);
      }
    } finally {
      setState(() => _busy = false);
    }
  }

  Future<void> _submitCode() async {
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
      await _reg.completeRegistrationOtp(_memberId, _phone, code);
      setState(() => _step = _Step.photo);
    } catch (e) {
      setState(() => _error = _friendlyError(e));
    } finally {
      setState(() => _busy = false);
    }
  }

  Future<void> _pickPhoto() async {
    final picked = await _picker.pickImage(source: ImageSource.gallery, maxWidth: 1024, imageQuality: 85);
    if (picked != null) setState(() => _photo = File(picked.path));
  }

  Future<void> _takePhoto() async {
    final picked = await _picker.pickImage(source: ImageSource.camera, maxWidth: 1024, imageQuality: 85);
    if (picked != null) setState(() => _photo = File(picked.path));
  }

  Future<void> _finishRegistration() async {
    if (_photo == null) {
      setState(() => _error = 'A profile photo is required');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final photoUrl = await _reg.uploadProfilePhoto(_photo!);
      await _reg.submitRegistration(photoUrl: photoUrl, email: _emailController.text);
      await ref.read(sessionProvider.notifier).refresh();
      // SessionGate now sees registrationStatus == 'pending_approval'
      // and routes to PendingApprovalScreen — no manual nav needed.
    } catch (e) {
      setState(() => _error = _friendlyError(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  void dispose() {
    _memberIdController.dispose();
    _codeController.dispose();
    _emailController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Register')),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if (_step == _Step.matchIdentity) ..._buildMatchStep(),
              if (_step == _Step.code) ..._buildCodeStep(),
              if (_step == _Step.photo) ..._buildPhotoStep(),
              if (_error != null) ...[
                const SizedBox(height: 12),
                Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
                if (_mismatchContact != null) ...[
                  ContactAdminCard(contact: _mismatchContact!),
                  const SizedBox(height: 8),
                  OutlinedButton(
                    onPressed: () => Navigator.of(context).push(
                      MaterialPageRoute(builder: (_) => const PhoneUpdateRequestScreen()),
                    ),
                    child: const Text('My phone number changed'),
                  ),
                ],
              ],
              const SizedBox(height: 20),
              FilledButton(
                onPressed: _busy ? null : _primaryAction,
                child: Text(_busy ? 'Please wait…' : _primaryLabel),
              ),
            ],
          ),
        ),
      ),
    );
  }

  VoidCallback get _primaryAction {
    switch (_step) {
      case _Step.matchIdentity:
        return _submitMatch;
      case _Step.code:
        return _submitCode;
      case _Step.photo:
        return _finishRegistration;
    }
  }

  String get _primaryLabel {
    switch (_step) {
      case _Step.matchIdentity:
        return 'Continue';
      case _Step.code:
        return 'Verify';
      case _Step.photo:
        return 'Submit for approval';
    }
  }

  List<Widget> _buildMatchStep() {
    return [
      Text('Enter your Member ID', style: Theme.of(context).textTheme.headlineSmall),
      const SizedBox(height: 8),
      Text(
        'Your organization\'s admin should have given you a Member ID. Enter it along with the phone number on file.',
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
        decoration: const InputDecoration(labelText: 'Phone number', border: OutlineInputBorder()),
        initialCountryCode: 'US',
        onChanged: (phone) => _phone = phone.completeNumber,
      ),
    ];
  }

  List<Widget> _buildCodeStep() {
    return [
      Text('Enter your code', style: Theme.of(context).textTheme.headlineSmall),
      const SizedBox(height: 8),
      Text('We sent a code to $_phone.', style: Theme.of(context).textTheme.bodyMedium),
      const SizedBox(height: 24),
      TextField(
        controller: _codeController,
        keyboardType: TextInputType.number,
        decoration: const InputDecoration(labelText: 'Verification code', border: OutlineInputBorder()),
      ),
      const SizedBox(height: 8),
      TextButton(
        onPressed: _busy
            ? null
            : () => setState(() {
                  _step = _Step.matchIdentity;
                  _error = null;
                }),
        child: const Text('Use a different Member ID or number'),
      ),
    ];
  }

  List<Widget> _buildPhotoStep() {
    return [
      Text('Almost done', style: Theme.of(context).textTheme.headlineSmall),
      const SizedBox(height: 8),
      Text(
        'A profile photo is required. Email is optional — you can add it later from Profile too.',
        style: Theme.of(context).textTheme.bodyMedium,
      ),
      const SizedBox(height: 24),
      Center(
        child: GestureDetector(
          onTap: _busy ? null : _pickPhoto,
          child: CircleAvatar(
            radius: 48,
            backgroundColor: Theme.of(context).colorScheme.primary.withOpacity(0.1),
            backgroundImage: _photo != null ? FileImage(_photo!) : null,
            child: _photo == null
                ? Icon(Icons.add_a_photo_outlined, size: 32, color: Theme.of(context).colorScheme.primary)
                : null,
          ),
        ),
      ),
      const SizedBox(height: 8),
      Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          TextButton.icon(
            onPressed: _busy ? null : _pickPhoto,
            icon: const Icon(Icons.photo_library_outlined),
            label: const Text('Choose photo'),
          ),
          TextButton.icon(
            onPressed: _busy ? null : _takePhoto,
            icon: const Icon(Icons.camera_alt_outlined),
            label: const Text('Take photo'),
          ),
        ],
      ),
      const SizedBox(height: 16),
      TextField(
        controller: _emailController,
        keyboardType: TextInputType.emailAddress,
        decoration: const InputDecoration(labelText: 'Email (optional)', border: OutlineInputBorder()),
      ),
    ];
  }
}
