import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';
import 'host_event_list_screen.dart';
import 'host_absence_requests_screen.dart';
import '../chat/chat_screen.dart';

/// Member list for one Sub Group the Host is assigned to (blueprint §5).
/// "Scan QR" opens the published-events list for this group (Phase 2) —
/// the Host picks which event they're checking people into before the
/// camera opens, since `checkIn` requires an eventId (docs/QR_DATAFLOW.md).
/// App bar actions add Chat and Absence Requests (Phase 3).
class HostGroupMembersScreen extends StatelessWidget {
  final String groupId;
  final String groupName;

  const HostGroupMembersScreen({super.key, required this.groupId, required this.groupName});

  @override
  Widget build(BuildContext context) {
    final q = FirebaseFirestore.instance
        .collection('groupMemberships')
        .where('groupId', isEqualTo: groupId)
        .where('status', isEqualTo: 'active');

    return Scaffold(
      appBar: AppBar(
        title: Text(groupName),
        actions: [
          IconButton(
            icon: const Icon(Icons.chat_bubble_outline),
            tooltip: 'Group chat',
            onPressed: () => Navigator.of(context).push(
              MaterialPageRoute(builder: (_) => ChatScreen(groupId: groupId, groupName: groupName)),
            ),
          ),
          IconButton(
            icon: const Icon(Icons.event_busy_outlined),
            tooltip: 'Absence requests',
            onPressed: () => Navigator.of(context).push(
              MaterialPageRoute(
                builder: (_) => HostAbsenceRequestsScreen(groupId: groupId, groupName: groupName),
              ),
            ),
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        icon: const Icon(Icons.qr_code_scanner),
        label: const Text('Scan QR'),
        onPressed: () => Navigator.of(context).push(
          MaterialPageRoute(
            builder: (_) => HostEventListScreen(groupId: groupId, groupName: groupName),
          ),
        ),
      ),
      body: StreamBuilder<QuerySnapshot<Map<String, dynamic>>>(
        stream: q.snapshots(),
        builder: (context, snap) {
          if (snap.connectionState == ConnectionState.waiting) {
            return const Center(child: CircularProgressIndicator());
          }
          final memberships = snap.data?.docs ?? [];
          if (memberships.isEmpty) {
            return const Center(child: Text('No members in this group yet.'));
          }
          return ListView.builder(
            itemCount: memberships.length,
            itemBuilder: (context, i) {
              final userId = memberships[i].data()['userId'] as String;
              return FutureBuilder<DocumentSnapshot<Map<String, dynamic>>>(
                future: FirebaseFirestore.instance.collection('users').doc(userId).get(),
                builder: (context, userSnap) {
                  final data = userSnap.data?.data();
                  return ListTile(
                    leading: const CircleAvatar(child: Icon(Icons.person)),
                    title: Text(data?['displayName'] as String? ?? 'Loading…'),
                    subtitle: Text(data?['phone'] as String? ?? ''),
                  );
                },
              );
            },
          );
        },
      ),
    );
  }
}
