import 'package:cached_network_image/cached_network_image.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/app_colors.dart';
import '../../core/session.dart';

/// The dark-green hero block at the top of the Home tab — menu button,
/// "Direction du Conservatoire" branding, the member's live display
/// name, their Primary Group, and an avatar initial in a gold ring.
/// Replaces the earlier "Good morning, {name} / Group Member" version —
/// this app is a specific organization's member portal, not a generic
/// greeting screen, so the header now says which organization and which
/// group, matching the admin panel's own branding.
class HomeHeader extends StatelessWidget {
  const HomeHeader({super.key});

  @override
  Widget build(BuildContext context) {
    final uid = FirebaseAuth.instance.currentUser!.uid;

    return Container(
      decoration: const BoxDecoration(
        gradient: LinearGradient(
          colors: [AppColors.brandGreenDark, AppColors.brandGreen],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        borderRadius: BorderRadius.vertical(bottom: Radius.circular(24)),
      ),
      padding: EdgeInsets.fromLTRB(20, MediaQuery.of(context).padding.top + 10, 20, 22),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Builder(
                builder: (context) => IconButton(
                  icon: const Icon(Icons.menu, color: Colors.white),
                  onPressed: () => Scaffold.of(context).openDrawer(),
                  padding: EdgeInsets.zero,
                  constraints: const BoxConstraints(minWidth: 32, minHeight: 32),
                ),
              ),
              const Expanded(
                child: Text(
                  'DIRECTION DU CONSERVATOIRE',
                  textAlign: TextAlign.center,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    color: AppColors.brandGold,
                    fontSize: 13,
                    fontWeight: FontWeight.w700,
                    letterSpacing: 0.6,
                  ),
                ),
              ),
              const SizedBox(width: 32), // balances the menu button so the title stays visually centered
            ],
          ),
          const SizedBox(height: 16),
          StreamBuilder<DocumentSnapshot<Map<String, dynamic>>>(
            stream: FirebaseFirestore.instance.collection('users').doc(uid).snapshots(),
            builder: (context, userSnap) {
              final userData = userSnap.data?.data();
              final name = (userData?['displayName'] as String?)?.trim();
              final displayName = (name == null || name.isEmpty) ? 'there' : name;
              final initial = displayName.isNotEmpty ? displayName[0].toUpperCase() : '?';
              final primaryGroupId = userData?['primaryGroupId'] as String?;
              final photoUrl = userData?['photoUrl'] as String?;

              return Row(
                children: [
                  Container(
                    width: 44,
                    height: 44,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      border: Border.all(color: AppColors.brandGold, width: 1.6),
                      color: Colors.white.withOpacity(0.12),
                    ),
                    alignment: Alignment.center,
                    // Was text-initial only, always — photoUrl (set from
                    // the admin panel, or later a member's own upload)
                    // was never actually read anywhere in the app. Now
                    // shown when present, falling back to the initial
                    // exactly as before when it's not.
                    child: (photoUrl != null && photoUrl.isNotEmpty)
                        ? ClipOval(
                            child: CachedNetworkImage(
                              imageUrl: photoUrl,
                              width: 44,
                              height: 44,
                              fit: BoxFit.cover,
                              errorWidget: (context, url, error) => Text(
                                initial,
                                style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w700, fontSize: 16),
                              ),
                            ),
                          )
                        : Text(
                            initial,
                            style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w700, fontSize: 16),
                          ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          displayName,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.w700),
                        ),
                        const SizedBox(height: 3),
                        _PrimaryGroupLabel(uid: uid, primaryGroupId: primaryGroupId),
                      ],
                    ),
                  ),
                ],
              );
            },
          ),
        ],
      ),
    );
  }
}

/// Resolves "Member of {group}" from the member's Primary Group.
/// Primary Group is a single designated group out of the (possibly many)
/// groups a member belongs to — set by an admin in the admin panel
/// (users/{uid}.primaryGroupId) — not simply "whichever group happens to
/// be first". Falls back gracefully for members who don't have one set
/// yet (existing data, or the admin-panel Primary Group picker not
/// having been used for them yet): first to their oldest active group
/// membership, then to a plain role label, rather than showing nothing.
class _PrimaryGroupLabel extends StatelessWidget {
  const _PrimaryGroupLabel({required this.uid, required this.primaryGroupId});
  final String uid;
  final String? primaryGroupId;

  @override
  Widget build(BuildContext context) {
    if (primaryGroupId != null && primaryGroupId!.isNotEmpty) {
      return _GroupNameRow(groupId: primaryGroupId!);
    }
    // No Primary Group set for this member yet — fall back to their
    // first active group membership so the header still shows
    // *something* useful rather than nothing.
    return StreamBuilder<QuerySnapshot<Map<String, dynamic>>>(
      stream: FirebaseFirestore.instance
          .collection('groupMemberships')
          .where('userId', isEqualTo: uid)
          .where('status', isEqualTo: 'active')
          .limit(1)
          .snapshots(),
      builder: (context, snap) {
        final docs = snap.data?.docs;
        if (docs != null && docs.isNotEmpty) {
          return _GroupNameRow(groupId: docs.first.data()['groupId'] as String);
        }
        // Not a member of any group yet (or still loading) — the old
        // role badge is still a reasonable thing to show here.
        return const _RoleFallbackLabel();
      },
    );
  }
}

class _GroupNameRow extends StatelessWidget {
  const _GroupNameRow({required this.groupId});
  final String groupId;

  @override
  Widget build(BuildContext context) {
    return StreamBuilder<DocumentSnapshot<Map<String, dynamic>>>(
      stream: FirebaseFirestore.instance.collection('groups').doc(groupId).snapshots(),
      builder: (context, snap) {
        final groupName = snap.data?.data()?['name'] as String?;
        if (groupName == null || groupName.isEmpty) {
          return const SizedBox.shrink();
        }
        return _badgeRow('Member of $groupName');
      },
    );
  }
}

class _RoleFallbackLabel extends ConsumerWidget {
  const _RoleFallbackLabel();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final role = ref.watch(sessionProvider).role;
    return _badgeRow(role == 'host' ? 'Host' : 'Group Member');
  }
}

Widget _badgeRow(String label) {
  return Row(
    mainAxisSize: MainAxisSize.min,
    children: [
      const Icon(Icons.groups_rounded, color: AppColors.brandGold, size: 14),
      const SizedBox(width: 5),
      Flexible(
        child: Text(
          label,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: const TextStyle(color: AppColors.brandGoldLight, fontSize: 12.5, fontWeight: FontWeight.w600),
        ),
      ),
    ],
  );
}
