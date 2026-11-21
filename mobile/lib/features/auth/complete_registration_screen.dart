import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:cloud_functions/cloud_functions.dart';
import '../../core/session.dart';
import 'registration_service.dart';

/// Shown by SessionGate when someone is already signed in (e.g. they
/// used plain phone login before ever finishing registration) but their
/// users/{uid}.registrationStatus is still 'not_registered'. Same last
/// step as RegistrationScreen (mandatory photo, optional email, submit
/// for approval) without repeating the Member ID/OTP steps, since
/// they're already authenticated.
class CompleteRegistrationScreen extends ConsumerStatefulWidget {
  const CompleteRegistrationScreen({super.key});

  @override
  ConsumerState<CompleteRegistrationScreen> createState() => _CompleteRegistrationScreenState();
}

class _CompleteRegistrationScreenState extends ConsumerState<CompleteRegistrationScreen> {
  final _reg = RegistrationService();
  final _emailController = TextEditingController();
  final _picker = ImagePicker();

  bool _busy = false;
  String? _error;
  File? _photo;

  Future<void> _pickPhoto() async {
    final picked = await _picker.pickImage(source: ImageSource.gallery, maxWidth: 1024, imageQuality: 85);
    if (picked != null) setState(() => _photo = File(picked.path));
  }

  Future<void> _takePhoto() async {
    final picked = await _picker.pickImage(source: ImageSource.camera, maxWidth: 1024, imageQuality: 85);
    if (picked != null) setState(() => _photo = File(picked.path));
  }

  Future<void> _submit() async {
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
      // Pop back to SessionGate, which will now render
      // PendingApprovalScreen(rejected: false) for the refreshed status
      // — this screen may have been reached either directly from
      // SessionGate (registrationStatus == 'not_registered', nothing to
      // pop past) or pushed from PendingApprovalScreen's "Try again"
      // button after a rejection (needs popping so the stale pushed
      // route doesn't linger on top of the updated state).
      if (mounted && Navigator.of(context).canPop()) {
        Navigator.of(context).pop();
      }
    } catch (e) {
      final msg = e is FirebaseFunctionsException ? e.message : null;
      setState(() => _error = msg ?? 'Something went wrong. Try again.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  void dispose() {
    _emailController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text('Finish registration', style: Theme.of(context).textTheme.headlineSmall),
              const SizedBox(height: 8),
              Text(
                'A profile photo is required before your registration can be reviewed.',
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
              if (_error != null) ...[
                const SizedBox(height: 12),
                Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
              ],
              const SizedBox(height: 20),
              FilledButton(
                onPressed: _busy ? null : _submit,
                child: Text(_busy ? 'Please wait…' : 'Submit for approval'),
              ),
              const SizedBox(height: 12),
              TextButton(
                onPressed: _busy ? null : () => FirebaseAuth.instance.signOut(),
                child: const Text('Sign out'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
