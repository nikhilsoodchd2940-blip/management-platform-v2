import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/app_colors.dart';
import '../../core/session.dart';
import 'member_badge.dart';
import 'primary_group_line.dart';

/// The profile block fixed at the top of the drawer (see
/// MemberHomeShell's Drawer) — circular photo in a gold ring, name,
/// role, and the member's Primary Group as their "location" line
/// (e.g. "Membre" / "Dakar, Sénégal" in the reference — this app's
/// closest real equivalent to a location is the group they belong to,
/// so that's what's shown; there's no separate city/zone field on the
/// member profile to pull from instead).
///
/// Handles a missing/null/failed photo gracefully — falls back to the
/// member's initial, same as everywhere else in the app that shows an
/// avatar.
class MemberDrawerHeader extends ConsumerWidget {
  const MemberDrawerHeader({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final uid = FirebaseAuth.instance.currentUser!.uid;
    final role = ref.watch(sessionProvider).role;

    return StreamBuilder<DocumentSnapshot<Map<String, dynamic>>>(
      stream: FirebaseFirestore.instance.collection('users').doc(uid).snapshots(),
      builder: (context, userSnap) {
        final data = userSnap.data?.data();
        final name = (data?['displayName'] as String?)?.trim();
        final displayName = (name == null || name.isEmpty) ? 'Member' : name;
        final initial = displayName.isNotEmpty ? displayName[0].toUpperCase() : '?';
        final photoUrl = data?['photoUrl'] as String?;
        final primaryGroupId = data?['primaryGroupId'] as String?;

        return Column(
          children: [
            // The full branded medallion badge — same widget used
            // wherever the member's profile picture appears (see
            // MemberBadge), so the drawer never shows something
            // different from the home top bar or profile screen.
            MemberBadge(size: 132, initial: initial, photoUrl: photoUrl, ringWidth: 2.5),
            const SizedBox(height: 4),
            Text(
              displayName,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              textAlign: TextAlign.center,
              style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 6),
            Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(Icons.groups_rounded, color: AppColors.richGold, size: 14),
                const SizedBox(width: 5),
                Text(
                  role == 'host' ? 'Host' : 'Membre',
                  style: const TextStyle(color: AppColors.lightGold, fontSize: 13, fontWeight: FontWeight.w600),
                ),
              ],
            ),
            if (primaryGroupId != null && primaryGroupId.isNotEmpty) ...[
              const SizedBox(height: 4),
              PrimaryGroupLine(groupId: primaryGroupId),
            ],
          ],
        );
      },
    );
  }
}
