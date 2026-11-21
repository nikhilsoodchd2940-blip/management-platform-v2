import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';

/// Basic notification inbox shell (blueprint §5). Nothing writes to
/// `notifications` yet — reminders/announcements are built in Phase 4 —
/// so this screen's job in Phase 1 is just to read-and-render whatever's
/// there and show a clear empty state; see firestore.rules for the
/// matching (currently write-locked) collection rule.
class NotificationsScreen extends StatelessWidget {
  const NotificationsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final uid = FirebaseAuth.instance.currentUser!.uid;
    final q = FirebaseFirestore.instance
        .collection('notifications')
        .where('userId', isEqualTo: uid)
        .orderBy('createdAt', descending: true)
        .limit(50);

    return StreamBuilder<QuerySnapshot<Map<String, dynamic>>>(
      stream: q.snapshots(),
      builder: (context, snap) {
        if (snap.connectionState == ConnectionState.waiting) {
          return const Center(child: CircularProgressIndicator());
        }
        final docs = snap.data?.docs ?? [];
        if (docs.isEmpty) {
          return const Center(
            child: Padding(
              padding: EdgeInsets.all(24),
              child: Text('No notifications yet.'),
            ),
          );
        }
        return ListView.builder(
          itemCount: docs.length,
          itemBuilder: (context, i) {
            final data = docs[i].data();
            return ListTile(
              title: Text(data['title'] as String? ?? ''),
              subtitle: Text(data['body'] as String? ?? ''),
            );
          },
        );
      },
    );
  }
}
