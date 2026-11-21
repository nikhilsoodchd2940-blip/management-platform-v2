import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';
import '../../core/app_colors.dart';

/// Looks up a group by id and renders it as a small "location" line —
/// a pin icon plus the group's name. Renders nothing while loading or
/// if the group has no name, so it never leaves a stray icon floating
/// with empty text.
///
/// Used as the member's Primary Group line wherever that's shown:
/// the drawer header (see MemberDrawerHeader) and the home top bar
/// (see HomeTopBar), each passing their own sizing/color to match the
/// surrounding UI.
class PrimaryGroupLine extends StatelessWidget {
  const PrimaryGroupLine({
    super.key,
    required this.groupId,
    this.iconSize = 13,
    this.fontSize = 12.5,
    this.iconColor = AppColors.richGold,
    this.textColor,
  });

  final String groupId;
  final double iconSize;
  final double fontSize;
  final Color iconColor;
  final Color? textColor;

  @override
  Widget build(BuildContext context) {
    return StreamBuilder<DocumentSnapshot<Map<String, dynamic>>>(
      stream: FirebaseFirestore.instance.collection('groups').doc(groupId).snapshots(),
      builder: (context, snap) {
        final groupName = snap.data?.data()?['name'] as String?;
        if (groupName == null || groupName.isEmpty) return const SizedBox.shrink();
        return Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.place_rounded, color: iconColor, size: iconSize),
            const SizedBox(width: 4),
            Flexible(
              child: Text(
                groupName,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(color: textColor ?? Colors.white.withOpacity(0.75), fontSize: fontSize, fontWeight: FontWeight.w600),
              ),
            ),
          ],
        );
      },
    );
  }
}
