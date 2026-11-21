import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import '../../core/app_colors.dart';
import '../content/member_badge.dart';
import '../donations/donation_screen.dart';
import 'edit_profile_screen.dart';

/// View/edit own profile (blueprint §5 — Member "Profile view/edit").
/// This screen is now VIEW-ONLY — editing lives on its own screen
/// (EditProfileScreen) instead of inline fields the member had to
/// scroll down to reach and then scroll back up to save. Reads
/// users/{uid} live via a StreamBuilder, so anything changed either
/// here (via EditProfileScreen) or from the admin panel shows up
/// immediately without needing a refresh or re-login.
class ProfileScreen extends StatelessWidget {
  const ProfileScreen({super.key});

  DocumentReference<Map<String, dynamic>> get _userRef =>
      FirebaseFirestore.instance.collection('users').doc(FirebaseAuth.instance.currentUser!.uid);

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;

    return StreamBuilder<DocumentSnapshot<Map<String, dynamic>>>(
      stream: _userRef.snapshots(),
      builder: (context, snap) {
        if (snap.connectionState == ConnectionState.waiting) {
          return const Center(child: CircularProgressIndicator());
        }
        if (snap.hasError) {
          return Center(
            child: Padding(
              padding: const EdgeInsets.all(24),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(Icons.wifi_off_rounded, size: 40, color: scheme.error),
                  const SizedBox(height: 12),
                  const Text('Could not load your profile. Check your connection and try again.', textAlign: TextAlign.center),
                ],
              ),
            ),
          );
        }

        final data = snap.data?.data() ?? {};
        final name = (data['displayName'] as String?)?.trim() ?? '';
        final phone = data['phone'] as String?;
        final email = data['email'] as String?;
        final photoUrl = data['photoUrl'] as String?;
        final notificationsEnabled = data['notificationsEnabled'] as bool? ?? true;
        final initial = name.isNotEmpty ? name[0].toUpperCase() : '?';

        return SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Container(
                padding: const EdgeInsets.all(20),
                decoration: BoxDecoration(
                  gradient: const LinearGradient(
                    colors: [AppColors.brandGreenDark, AppColors.brandGreen],
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                  ),
                  borderRadius: BorderRadius.circular(20),
                ),
                child: Column(
                  children: [
                    MemberBadge(size: 104, initial: initial, photoUrl: photoUrl),
                    const SizedBox(height: 12),
                    Text(
                      name.isEmpty ? 'Your profile' : name,
                      style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700, color: Colors.white),
                    ),
                    if (phone != null && phone.isNotEmpty) ...[
                      const SizedBox(height: 4),
                      Text(phone, style: TextStyle(color: Colors.white.withOpacity(0.85), fontSize: 13)),
                    ],
                  ],
                ),
              ),
              const SizedBox(height: 14),
              _EditProfileButton(
                onTap: () => Navigator.of(context).push(
                  MaterialPageRoute(builder: (_) => const EditProfileScreen()),
                ),
              ),
              const SizedBox(height: 20),
              const _SectionLabel(icon: Icons.badge_rounded, color: Color(0xFF2563EB), text: 'Your details'),
              const SizedBox(height: 10),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
                decoration: BoxDecoration(color: const Color(0xFFE3EBFF), borderRadius: BorderRadius.circular(18)),
                child: Column(
                  children: [
                    _InfoRow(label: 'Full name', value: name.isEmpty ? '—' : name),
                    const Divider(height: 1),
                    _InfoRow(label: 'Phone', value: (phone == null || phone.isEmpty) ? '—' : phone),
                    const Divider(height: 1),
                    _InfoRow(label: 'Email', value: (email == null || email.isEmpty) ? 'Not set' : email),
                  ],
                ),
              ),
              const SizedBox(height: 20),
              const _SectionLabel(icon: Icons.tune_rounded, color: Color(0xFF0D9488), text: 'Preferences'),
              const SizedBox(height: 10),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
                decoration: BoxDecoration(color: const Color(0xFFD9F2EE), borderRadius: BorderRadius.circular(18)),
                child: _InfoRow(
                  label: 'SMS reminders',
                  value: notificationsEnabled ? 'On' : 'Off',
                  valueColor: const Color(0xFF0D9488),
                ),
              ),
              const SizedBox(height: 20),
              const _SectionLabel(icon: Icons.favorite_rounded, color: Color(0xFFDC2626), text: 'Support'),
              const SizedBox(height: 10),
              _TintedActionRow(
                icon: Icons.volunteer_activism_rounded,
                color: const Color(0xFF7C3AED),
                bg: const Color(0xFFEEE3FF),
                title: 'Donate',
                subtitle: 'Support the group with a contribution',
                onTap: () => Navigator.of(context).push(
                  MaterialPageRoute(builder: (_) => const DonationScreen()),
                ),
              ),
              const SizedBox(height: 20),
              _TintedActionRow(
                icon: Icons.logout_rounded,
                color: scheme.error,
                bg: scheme.error.withOpacity(0.08),
                title: 'Sign out',
                subtitle: null,
                onTap: () => FirebaseAuth.instance.signOut(),
              ),
            ],
          ),
        );
      },
    );
  }
}

class _EditProfileButton extends StatelessWidget {
  const _EditProfileButton({required this.onTap});
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: AppColors.brandGold.withOpacity(0.14),
      borderRadius: BorderRadius.circular(16),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(16),
        child: const Padding(
          padding: EdgeInsets.symmetric(horizontal: 16, vertical: 14),
          child: Row(
            children: [
              Icon(Icons.edit_rounded, color: AppColors.brandGreenDark, size: 20),
              SizedBox(width: 12),
              Expanded(
                child: Text(
                  'Edit Profile',
                  style: TextStyle(fontWeight: FontWeight.w700, fontSize: 15, color: AppColors.brandGreenDark),
                ),
              ),
              Icon(Icons.chevron_right, color: AppColors.brandGreenDark),
            ],
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

class _InfoRow extends StatelessWidget {
  const _InfoRow({required this.label, required this.value, this.valueColor});
  final String label;
  final String value;
  final Color? valueColor;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 12),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label, style: const TextStyle(fontSize: 13.5, color: Color(0xFF475569))),
          Flexible(
            child: Text(
              value,
              textAlign: TextAlign.right,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(fontSize: 13.5, fontWeight: FontWeight.w600, color: valueColor),
            ),
          ),
        ],
      ),
    );
  }
}

class _TintedActionRow extends StatelessWidget {
  const _TintedActionRow({
    required this.icon,
    required this.color,
    required this.bg,
    required this.title,
    required this.subtitle,
    required this.onTap,
  });
  final IconData icon;
  final Color color;
  final Color bg;
  final String title;
  final String? subtitle;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: bg,
      borderRadius: BorderRadius.circular(16),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(16),
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Row(
            children: [
              Icon(icon, color: color, size: 22),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(title, style: TextStyle(fontWeight: FontWeight.w700, fontSize: 14.5, color: color)),
                    if (subtitle != null) ...[
                      const SizedBox(height: 2),
                      Text(subtitle!, style: TextStyle(fontSize: 12, color: color.withOpacity(0.8))),
                    ],
                  ],
                ),
              ),
              Icon(Icons.chevron_right, color: color.withOpacity(0.7)),
            ],
          ),
        ),
      ),
    );
  }
}
