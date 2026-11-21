import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import '../../core/session.dart';
import 'host_group_members_screen.dart';

/// Host's assigned Sub Groups (blueprint §5 — "View assigned Sub
/// Group(s)" for Hosts). `hostGroupIds` comes straight from the auth
/// custom claim (core/session.dart) — the same value Firestore rules and
/// every Cloud Function check — so this list can never show a group the
/// Host isn't actually authorized to act on.
class HostHomeScreen extends ConsumerWidget {
  const HostHomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final session = ref.watch(sessionProvider);
    final groupIds = session.hostGroupIds;

    if (groupIds.isEmpty) {
      return const Center(
        child: Padding(
          padding: EdgeInsets.all(24),
          child: Text('You\'re not assigned as a Host of any group yet.'),
        ),
      );
    }

    return ListView.separated(
      padding: const EdgeInsets.all(16),
      itemCount: groupIds.length,
      separatorBuilder: (_, __) => const SizedBox(height: 8),
      itemBuilder: (context, i) {
        final groupId = groupIds[i];
        return FutureBuilder<DocumentSnapshot<Map<String, dynamic>>>(
          future: FirebaseFirestore.instance.collection('groups').doc(groupId).get(),
          builder: (context, snap) {
            final name = snap.data?.data()?['name'] as String? ?? 'Loading…';
            return Card(
              child: ListTile(
                title: Text(name),
                trailing: const Icon(Icons.chevron_right),
                onTap: () => Navigator.of(context).push(
                  MaterialPageRoute(
                    builder: (_) => HostGroupMembersScreen(groupId: groupId, groupName: name),
                  ),
                ),
              ),
            );
          },
        );
      },
    );
  }
}
