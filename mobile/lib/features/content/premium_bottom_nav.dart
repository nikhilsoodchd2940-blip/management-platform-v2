import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import '../../core/app_colors.dart';
import 'islamic_pattern.dart';

class PremiumNavItem {
  const PremiumNavItem({required this.icon, required this.activeIcon, required this.label, this.showNotificationBadge = false});
  final IconData icon;
  final IconData activeIcon;
  final String label;
  final bool showNotificationBadge;
}

/// The five-item bottom nav (Home / Calendar / Attendance / Requests /
/// Notifications, per the approved reference) with the Islamic
/// geometric pattern covering the full bar — deliberately a custom
/// widget rather than Flutter's Material `NavigationBar`, which has no
/// way to layer a CustomPainter behind its own background.
///
/// The Notifications item's badge is a real live count from the
/// `notifications` collection (see the StreamBuilder below) — note it's
/// a total count, not specifically "unread", since that field doesn't
/// exist in the schema yet (see notifications_screen.dart).
class PremiumBottomNav extends StatelessWidget {
  const PremiumBottomNav({super.key, required this.items, required this.selectedIndex, required this.onSelect});
  final List<PremiumNavItem> items;
  final int selectedIndex;
  final void Function(int index) onSelect;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: const BoxDecoration(
        gradient: LinearGradient(
          colors: [AppColors.veryDarkEmerald, AppColors.deepEmerald],
          begin: Alignment.centerLeft,
          end: Alignment.centerRight,
        ),
      ),
      child: IslamicPatternBackground(
        color: AppColors.richGold,
        opacity: 0.12,
        child: SafeArea(
          top: false,
          child: SizedBox(
            height: 64,
            child: Row(
              children: List.generate(items.length, (i) {
                final selected = i == selectedIndex;
                final item = items[i];
                final iconColor = selected ? AppColors.veryDarkEmerald : AppColors.warmCream.withOpacity(0.75);
                return Expanded(
                  child: InkWell(
                    onTap: () => onSelect(i),
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 4),
                          decoration: BoxDecoration(
                            color: selected ? AppColors.richGold : Colors.transparent,
                            borderRadius: BorderRadius.circular(14),
                          ),
                          child: item.showNotificationBadge
                              ? _BadgedIcon(icon: selected ? item.activeIcon : item.icon, color: iconColor)
                              : Icon(selected ? item.activeIcon : item.icon, color: iconColor, size: 22),
                        ),
                        const SizedBox(height: 3),
                        Text(
                          item.label,
                          style: TextStyle(
                            fontSize: 10.5,
                            fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
                            color: selected ? AppColors.richGold : AppColors.warmCream.withOpacity(0.7),
                          ),
                        ),
                      ],
                    ),
                  ),
                );
              }),
            ),
          ),
        ),
      ),
    );
  }
}

class _BadgedIcon extends StatelessWidget {
  const _BadgedIcon({required this.icon, required this.color});
  final IconData icon;
  final Color color;

  @override
  Widget build(BuildContext context) {
    final uid = FirebaseAuth.instance.currentUser!.uid;
    final query = FirebaseFirestore.instance.collection('notifications').where('userId', isEqualTo: uid);

    return StreamBuilder<QuerySnapshot<Map<String, dynamic>>>(
      stream: query.snapshots(),
      builder: (context, snap) {
        final count = snap.data?.docs.length ?? 0;
        return Stack(
          clipBehavior: Clip.none,
          children: [
            Icon(icon, color: color, size: 22),
            if (count > 0)
              Positioned(
                right: -6,
                top: -4,
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 0.5),
                  constraints: const BoxConstraints(minWidth: 14),
                  decoration: BoxDecoration(
                    color: const Color(0xFFDC2626),
                    borderRadius: BorderRadius.circular(999),
                    border: Border.all(color: AppColors.veryDarkEmerald, width: 1.2),
                  ),
                  child: Text(
                    count > 9 ? '9+' : '$count',
                    textAlign: TextAlign.center,
                    style: const TextStyle(color: Colors.white, fontSize: 8.5, fontWeight: FontWeight.w700),
                  ),
                ),
              ),
          ],
        );
      },
    );
  }
}
