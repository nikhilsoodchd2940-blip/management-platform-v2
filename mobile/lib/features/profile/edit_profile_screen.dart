import 'dart:io';
import 'package:cached_network_image/cached_network_image.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_storage/firebase_storage.dart';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import '../../core/app_colors.dart';

/// A dedicated Edit Profile screen, replacing the old inline-editable
/// fields on ProfileScreen — that version made the member scroll down to
/// find the fields, then scroll back up to reach Save. Here Save is a
/// bottom bar fixed via Scaffold.bottomNavigationBar, so it's visible
/// regardless of scroll position, and content is grouped into clearly
/// labeled sections instead of one long flat list of fields.
///
/// Photo changes save immediately (own upload state, own error handling)
/// rather than waiting on the bottom Save button — same split the admin
/// panel's own photo uploader already uses, and for the same reason:
/// an upload is its own async operation with its own failure mode,
/// distinct from "did the text fields change". Permitted directly by
/// firestore.rules (users/{uid}.photoUrl isn't in the locked-fields
/// list) and storage.rules (profilePhotos/{uid}/* allows the member's
/// own uid to write) — no Cloud Function needed for either.
class EditProfileScreen extends StatefulWidget {
  const EditProfileScreen({super.key});

  @override
  State<EditProfileScreen> createState() => _EditProfileScreenState();
}

class _EditProfileScreenState extends State<EditProfileScreen> {
  final _nameController = TextEditingController();
  final _emailController = TextEditingController();
  bool _loading = true;
  bool _saving = false;
  bool _notificationsEnabled = true;
  String? _error;
  String? _loadError;
  String? _phone;
  String? _photoUrl;
  bool _photoUploading = false;
  String? _photoError;

  DocumentReference<Map<String, dynamic>> get _userRef =>
      FirebaseFirestore.instance.collection('users').doc(FirebaseAuth.instance.currentUser!.uid);

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _nameController.dispose();
    _emailController.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _loadError = null;
    });
    try {
      final snap = await _userRef.get();
      final data = snap.data();
      if (data != null) {
        _nameController.text = data['displayName'] as String? ?? '';
        _emailController.text = data['email'] as String? ?? '';
        _phone = data['phone'] as String?;
        _photoUrl = data['photoUrl'] as String?;
        _notificationsEnabled = data['notificationsEnabled'] as bool? ?? true;
      }
    } catch (e) {
      debugPrint('[edit-profile] load failed: $e');
      _loadError = 'Could not load your profile. Check your connection and try again.';
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _changePhoto() async {
    final picker = ImagePicker();
    final picked = await picker.pickImage(source: ImageSource.gallery, imageQuality: 85, maxWidth: 1024);
    if (picked == null) return;

    setState(() {
      _photoUploading = true;
      _photoError = null;
    });
    try {
      final uid = FirebaseAuth.instance.currentUser!.uid;
      final storageRef = FirebaseStorage.instance.ref('profilePhotos/$uid/photo.jpg');
      await storageRef.putFile(File(picked.path), SettableMetadata(contentType: 'image/jpeg'));
      final downloadUrl = await storageRef.getDownloadURL();

      // Direct Firestore write, not a Cloud Function — photoUrl is a
      // normal self-editable field (see firestore.rules' `users` match:
      // it's not in the locked-fields list), same as displayName/email
      // below. This is deliberately a SEPARATE write from _save(), so a
      // slow/failed photo upload can't block or get tangled with saving
      // the text fields, and vice versa.
      await _userRef.update({'photoUrl': downloadUrl, 'updatedAt': FieldValue.serverTimestamp()});
      if (mounted) setState(() => _photoUrl = downloadUrl);
    } catch (e) {
      if (mounted) setState(() => _photoError = 'Could not update photo. Try again.');
    } finally {
      if (mounted) setState(() => _photoUploading = false);
    }
  }

  Future<void> _save() async {
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      await _userRef.update({
        'displayName': _nameController.text.trim(),
        'displayNameLower': _nameController.text.trim().toLowerCase(),
        'email': _emailController.text.trim(),
        'notificationsEnabled': _notificationsEnabled,
        'updatedAt': FieldValue.serverTimestamp(),
      });
      if (mounted) Navigator.of(context).pop();
    } catch (e) {
      setState(() => _error = 'Could not save. Try again.');
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return const Scaffold(
        appBar: null,
        body: Center(child: CircularProgressIndicator()),
      );
    }
    if (_loadError != null) {
      return Scaffold(
        appBar: AppBar(title: const Text('Edit Profile')),
        body: Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(Icons.wifi_off_rounded, size: 40, color: Theme.of(context).colorScheme.error),
                const SizedBox(height: 12),
                Text(_loadError!, textAlign: TextAlign.center),
                const SizedBox(height: 16),
                FilledButton(onPressed: _load, child: const Text('Try again')),
              ],
            ),
          ),
        ),
      );
    }

    final name = _nameController.text.trim();
    final initial = name.isNotEmpty ? name[0].toUpperCase() : '?';

    return Scaffold(
      appBar: AppBar(title: const Text('Edit Profile')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
        children: [
          const _SectionLabel(icon: Icons.photo_camera_rounded, color: AppColors.brandGreen, text: 'Profile photo'),
          const SizedBox(height: 10),
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(color: const Color(0xFFEAF3EE), borderRadius: BorderRadius.circular(18)),
            child: Row(
              children: [
                Container(
                  width: 64,
                  height: 64,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    border: Border.all(color: AppColors.brandGold, width: 2),
                    color: AppColors.brandGreen.withOpacity(0.12),
                  ),
                  alignment: Alignment.center,
                  child: _photoUploading
                      ? const SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2.4))
                      : (_photoUrl != null && _photoUrl!.isNotEmpty)
                          ? ClipOval(
                              child: CachedNetworkImage(
                                imageUrl: _photoUrl!,
                                width: 64,
                                height: 64,
                                fit: BoxFit.cover,
                                errorWidget: (context, url, error) => Text(
                                  initial,
                                  style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w700, color: AppColors.brandGreenDark),
                                ),
                              ),
                            )
                          : Text(
                              initial,
                              style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w700, color: AppColors.brandGreenDark),
                            ),
                ),
                const SizedBox(width: 16),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      OutlinedButton(
                        onPressed: _photoUploading ? null : _changePhoto,
                        child: Text(_photoUploading ? 'Uploading…' : 'Change photo'),
                      ),
                      if (_photoError != null) ...[
                        const SizedBox(height: 6),
                        Text(_photoError!, style: TextStyle(color: Theme.of(context).colorScheme.error, fontSize: 12)),
                      ],
                    ],
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 22),
          const _SectionLabel(icon: Icons.badge_rounded, color: Color(0xFF2563EB), text: 'Personal information'),
          const SizedBox(height: 10),
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(color: const Color(0xFFE3EBFF), borderRadius: BorderRadius.circular(18)),
            child: Column(
              children: [
                TextField(
                  controller: _nameController,
                  textCapitalization: TextCapitalization.words,
                  decoration: const InputDecoration(
                    labelText: 'Full name',
                    prefixIcon: Icon(Icons.person_outline_rounded),
                    filled: true,
                    fillColor: Colors.white,
                  ),
                  onChanged: (_) => setState(() {}), // keeps the photo section's initial in sync while typing
                ),
                const SizedBox(height: 14),
                TextField(
                  controller: _emailController,
                  keyboardType: TextInputType.emailAddress,
                  decoration: const InputDecoration(
                    labelText: 'Email (optional)',
                    prefixIcon: Icon(Icons.mail_outline_rounded),
                    filled: true,
                    fillColor: Colors.white,
                  ),
                ),
                if (_phone != null && _phone!.isNotEmpty) ...[
                  const SizedBox(height: 14),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                    decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(12)),
                    child: Row(
                      children: [
                        const Icon(Icons.phone_outlined, color: Color(0xFF64748B), size: 20),
                        const SizedBox(width: 10),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(_phone!, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600)),
                              const Text('Contact your admin to change your phone number', style: TextStyle(fontSize: 11, color: Color(0xFF64748B))),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ],
            ),
          ),
          const SizedBox(height: 22),
          const _SectionLabel(icon: Icons.tune_rounded, color: Color(0xFF0D9488), text: 'Preferences'),
          const SizedBox(height: 10),
          Container(
            decoration: BoxDecoration(color: const Color(0xFFD9F2EE), borderRadius: BorderRadius.circular(18)),
            child: SwitchListTile(
              contentPadding: const EdgeInsets.symmetric(horizontal: 18, vertical: 4),
              title: const Text('SMS reminders', style: TextStyle(fontWeight: FontWeight.w700, color: Color(0xFF0D9488))),
              subtitle: Text('Text me before events I\'m invited to', style: TextStyle(color: const Color(0xFF0D9488).withOpacity(0.8))),
              activeColor: const Color(0xFF0D9488),
              value: _notificationsEnabled,
              onChanged: (v) => setState(() => _notificationsEnabled = v),
            ),
          ),
          if (_error != null) ...[
            const SizedBox(height: 16),
            Text(_error!, textAlign: TextAlign.center, style: TextStyle(color: Theme.of(context).colorScheme.error)),
          ],
          // Extra bottom padding so the last section never sits flush
          // against the sticky Save bar below.
          const SizedBox(height: 12),
        ],
      ),
      // Fixed to the bottom of the screen regardless of scroll position —
      // this is what actually satisfies "Save must always be reachable
      // without scrolling back up", not just a button placed lower down.
      bottomNavigationBar: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 10, 16, 10),
          child: FilledButton(
            onPressed: _saving ? null : _save,
            child: _saving
                ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2.4, color: Colors.white))
                : const Text('Save changes'),
          ),
        ),
      ),
    );
  }
}

class _SectionLabel extends StatelessWidget {
  const _SectionLabel({required this.icon, required this.color, required this.text});
  final IconData icon;
  final Color color;
  final String text;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Icon(icon, size: 16, color: color),
        const SizedBox(width: 6),
        Text(text, style: TextStyle(fontSize: 13.5, fontWeight: FontWeight.w700, color: color)),
      ],
    );
  }
}
