import 'package:cached_network_image/cached_network_image.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import '../../core/app_colors.dart';
import 'islamic_pattern.dart';
import 'notifications_bell.dart';
import 'primary_group_line.dart';

/// The Home tab's top bar — menu button, "Direction du Conservatoire"
/// branding, a notification bell, and a compact member photo + name +
/// zone row. Deliberately a plain circular photo here, NOT the full
/// HIZBUT-TARQIYYAH medallion badge (see MemberBadge) — at this small
/// size the medallion's ring text isn't legible and reads as a cropped
/// frame, so the home top bar shows just the photo, with the full
/// badge reserved for the drawer header and profile screen where
/// there's room for it. Row2 shares row1's left inset (12) so the
/// photo lines up under the menu button, and both rows are vertically
/// centered.
class HomeTopBar extends StatelessWidget {
  const HomeTopBar({super.key});

  @override
  Widget build(BuildContext context) {
    final uid = FirebaseAuth.instance.currentUser!.uid;

    return ClipRRect(
      borderRadius: const BorderRadius.vertical(bottom: Radius.circular(20)),
      child: Container(
        decoration: const BoxDecoration(
          gradient: LinearGradient(
            colors: [AppColors.veryDarkEmerald, AppColors.deepEmerald],
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
          ),
        ),
        child: IslamicPatternBackground(
          color: AppColors.richGold,
          opacity: 0.12,
          child: Padding(
            padding: EdgeInsets.fromLTRB(12, MediaQuery.of(context).padding.top + 8, 16, 14),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Builder(
                      builder: (context) => IconButton(
                        icon: const Icon(Icons.menu_rounded, color: AppColors.warmCream),
                        onPressed: () => Scaffold.of(context).openDrawer(),
                      ),
                    ),
                    Expanded(
                      child: Row(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          const Icon(Icons.account_balance_rounded, color: AppColors.richGold, size: 18),
                          const SizedBox(width: 8),
                          Flexible(
                            child: Text(
                              'DIRECTION DU CONSERVATOIRE',
                              textAlign: TextAlign.center,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                color: AppColors.richGold,
                                fontSize: 12.5,
                                fontWeight: FontWeight.w700,
                                letterSpacing: 0.6,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                    const NotificationsBell(),
                  ],
                ),
                const SizedBox(height: 6),
                Padding(
                  padding: const EdgeInsets.only(left: 12),
                  child: StreamBuilder<DocumentSnapshot<Map<String, dynamic>>>(
                    stream: FirebaseFirestore.instance.collection('users').doc(uid).snapshots(),
                    builder: (context, snap) {
                      final data = snap.data?.data();
                      final name = (data?['displayName'] as String?)?.trim();
                      final displayName = (name == null || name.isEmpty) ? 'Member' : name;
                      final initial = displayName.isNotEmpty ? displayName[0].toUpperCase() : '?';
                      final photoUrl = data?['photoUrl'] as String?;
                      final primaryGroupId = data?['primaryGroupId'] as String?;

                      return Row(
                        crossAxisAlignment: CrossAxisAlignment.center,
                        children: [
                          Container(
                            width: 44,
                            height: 44,
                            decoration: BoxDecoration(
                              shape: BoxShape.circle,
                              border: Border.all(color: AppColors.richGold, width: 1.8),
                              color: Colors.white.withOpacity(0.12),
                            ),
                            alignment: Alignment.center,
                            child: (photoUrl != null && photoUrl.isNotEmpty)
                                ? ClipOval(
                                    child: CachedNetworkImage(
                                      imageUrl: photoUrl,
                                      width: 40,
                                      height: 40,
                                      fit: BoxFit.cover,
                                      errorWidget: (context, url, error) => Text(
                                        initial,
                                        style: const TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.w700),
                                      ),
                                    ),
                                  )
                                : Text(
                                    initial,
                                    style: const TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.w700),
                                  ),
                          ),
                          const SizedBox(width: 10),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Text(
                                  displayName,
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: const TextStyle(color: AppColors.warmCream, fontSize: 15, fontWeight: FontWeight.w700),
                                ),
                                if (primaryGroupId != null && primaryGroupId.isNotEmpty) ...[
                                  const SizedBox(height: 2),
                                  PrimaryGroupLine(
                                    groupId: primaryGroupId,
                                    iconSize: 12,
                                    fontSize: 11.5,
                                    textColor: AppColors.lightGold,
                                  ),
                                ],
                              ],
                            ),
                          ),
                        ],
                      );
                    },
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
