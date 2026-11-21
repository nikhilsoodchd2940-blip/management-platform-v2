import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import '../content/query_error_message.dart';
import 'group_detail_screen.dart';

// A small rotating palette so group cards read as distinct at a glance
// instead of a flat, identical-looking list — same visual idea as the
// colored group-icon tiles in the approved design concept.
const _groupColors = [
  Color(0xFF2563EB),
  Color(0xFF0D9488),
  Color(0xFFD946EF),
  Color(0xFFF59E0B),
  Color(0xFFDC2626),
  Color(0xFF7C3AED),
];

/// Lists the Sub Groups the signed-in member currently belongs to
/// (blueprint §5 — "View assigned Sub Group(s)"). Two-step read:
/// groupMemberships (own docs, always self-readable per Firestore rules)
/// then the referenced group docs (readable because of that same
/// membership — see isActiveMember() in firestore.rules).
class MyGroupsScreen extends StatelessWidget {
  const MyGroupsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final uid = FirebaseAuth.instance.currentUser!.uid;
    final membershipsQuery = FirebaseFirestore.instance
        .collection('groupMemberships')
        .where('userId', isEqualTo: uid)
        .where('status', isEqualTo: 'active');

    return StreamBuilder<QuerySnapshot<Map<String, dynamic>>>(
      stream: membershipsQuery.snapshots(),
      builder: (context, membershipSnap) {
        if (membershipSnap.connectionState == ConnectionState.waiting) {
          return const Center(child: CircularProgressIndicator());
        }
        if (membershipSnap.hasError) {
          // Surfaced instead of silently falling through to "no groups"
          // — a missing Firestore composite index or a rules/permission
          // problem otherwise looks identical to genuinely having none.
          return QueryErrorMessage(error: membershipSnap.error);
        }
        final memberships = membershipSnap.data?.docs ?? [];
        if (memberships.isEmpty) {
          return const Center(
            child: Padding(
              padding: EdgeInsets.all(24),
              child: Text('You\'re not assigned to any groups yet. Ask an admin to add you.'),
            ),
          );
        }

        return ListView.separated(
          padding: const EdgeInsets.fromLTRB(16, 4, 16, 16),
          itemCount: memberships.length + 1,
          separatorBuilder: (_, __) => const SizedBox(height: 10),
          itemBuilder: (context, i) {
            if (i == 0) {
              final hostCount = memberships.where((m) => m.data()['role'] == 'host').length;
              return Container(
                margin: const EdgeInsets.only(bottom: 4),
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  gradient: LinearGradient(
                    colors: [Theme.of(context).colorScheme.primary, Theme.of(context).colorScheme.primary.withOpacity(0.75)],
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                  ),
                  borderRadius: BorderRadius.circular(18),
                ),
                child: Row(
                  children: [
                    const Icon(Icons.groups_rounded, color: Colors.white, size: 28),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            '${memberships.length} group${memberships.length == 1 ? '' : 's'}',
                            style: const TextStyle(color: Colors.white, fontSize: 17, fontWeight: FontWeight.w700),
                          ),
                          if (hostCount > 0)
                            Text(
                              'Hosting $hostCount of them',
                              style: TextStyle(color: Colors.white.withOpacity(0.85), fontSize: 12.5),
                            ),
                        ],
                      ),
                    ),
                  ],
                ),
              );
            }
            final membership = memberships[i - 1].data();
            final groupId = membership['groupId'] as String;
            final role = membership['role'] as String;
            final color = _groupColors[(i - 1) % _groupColors.length];

            return FutureBuilder<DocumentSnapshot<Map<String, dynamic>>>(
              future: FirebaseFirestore.instance.collection('groups').doc(groupId).get(),
              builder: (context, groupSnap) {
                final name = groupSnap.data?.data()?['name'] as String? ?? 'Loading…';
                return Material(
                  color: Theme.of(context).colorScheme.surface,
                  borderRadius: BorderRadius.circular(16),
                  child: InkWell(
                    borderRadius: BorderRadius.circular(16),
                    onTap: () => Navigator.of(context).push(
                      MaterialPageRoute(
                        builder: (_) => GroupDetailScreen(groupId: groupId, groupName: name),
                      ),
                    ),
                    child: Container(
                      padding: const EdgeInsets.all(14),
                      decoration: BoxDecoration(
                        borderRadius: BorderRadius.circular(16),
                        border: Border.all(color: Theme.of(context).colorScheme.outlineVariant.withOpacity(0.4)),
                      ),
                      child: Row(
                        children: [
                          Container(
                            width: 44,
                            height: 44,
                            decoration: BoxDecoration(
                              color: color.withOpacity(0.12),
                              borderRadius: BorderRadius.circular(12),
                            ),
                            child: Icon(Icons.groups_rounded, color: color, size: 22),
                          ),
                          const SizedBox(width: 14),
                          Expanded(
                            child: Text(
                              name,
                              style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600),
                            ),
                          ),
                          if (role == 'host')
                            Container(
                              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                              decoration: BoxDecoration(
                                color: const Color(0xFFFEF3C7),
                                borderRadius: BorderRadius.circular(999),
                              ),
                              child: const Text(
                                'Host',
                                style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: Color(0xFFB45309)),
                              ),
                            )
                          else
                            Icon(Icons.chevron_right, color: Theme.of(context).colorScheme.outline),
                        ],
                      ),
                    ),
                  ),
                );
              },
            );
          },
        );
      },
    );
  }
}
