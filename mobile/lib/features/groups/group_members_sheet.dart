import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';
import '../content/query_error_message.dart';

/// The one query every "who's in this group" feature needs — kept in
/// one place so GroupDetailScreen's hero, the members sheet, and
/// ChatScreen's header all agree on exactly what "member of this group"
/// means (active groupMemberships row), instead of three copies that
/// could silently drift apart.
Query<Map<String, dynamic>> activeGroupMembershipsQuery(String groupId) {
  return FirebaseFirestore.instance
      .collection('groupMemberships')
      .where('groupId', isEqualTo: groupId)
      .where('status', isEqualTo: 'active');
}

/// A small "N members" label that stays live as people join/leave.
/// `style` lets callers match their own header (white-on-color for a
/// hero, or default text color for a plain AppBar).
class GroupMemberCountLabel extends StatelessWidget {
  const GroupMemberCountLabel({super.key, required this.groupId, this.style});
  final String groupId;
  final TextStyle? style;

  @override
  Widget build(BuildContext context) {
    return StreamBuilder<QuerySnapshot<Map<String, dynamic>>>(
      stream: activeGroupMembershipsQuery(groupId).snapshots(),
      builder: (context, snap) {
        if (snap.hasError) {
          return QueryErrorMessage(error: snap.error, compact: true);
        }
        final count = snap.data?.docs.length;
        return Text(
          count == null ? 'Loading members…' : '$count member${count == 1 ? '' : 's'}',
          style: style,
        );
      },
    );
  }
}

/// Opens the member roster for a group as a draggable bottom sheet.
void showGroupMembersSheet(BuildContext context, {required String groupId}) {
  showModalBottomSheet(
    context: context,
    isScrollControlled: true,
    shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
    builder: (context) => DraggableScrollableSheet(
      initialChildSize: 0.6,
      minChildSize: 0.3,
      maxChildSize: 0.9,
      expand: false,
      builder: (context, scrollController) => GroupMembersSheet(groupId: groupId, scrollController: scrollController),
    ),
  );
}

/// A simple member roster for the group — memberships, then each user
/// doc's displayName. Two-step read, same pattern used throughout the
/// rest of the app for resolving a groupId/userId into something
/// readable.
class GroupMembersSheet extends StatelessWidget {
  const GroupMembersSheet({super.key, required this.groupId, required this.scrollController});
  final String groupId;
  final ScrollController scrollController;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        const SizedBox(height: 12),
        Container(width: 40, height: 4, decoration: BoxDecoration(color: const Color(0xFFCBD5E1), borderRadius: BorderRadius.circular(999))),
        const Padding(
          padding: EdgeInsets.fromLTRB(20, 16, 20, 8),
          child: Align(
            alignment: Alignment.centerLeft,
            child: Text('Members', style: TextStyle(fontSize: 17, fontWeight: FontWeight.w700)),
          ),
        ),
        Expanded(
          child: StreamBuilder<QuerySnapshot<Map<String, dynamic>>>(
            stream: activeGroupMembershipsQuery(groupId).snapshots(),
            builder: (context, snap) {
              if (snap.connectionState == ConnectionState.waiting) {
                return const Center(child: CircularProgressIndicator());
              }
              if (snap.hasError) {
                // Most likely cause: a missing Firestore composite index
                // for (groupId, status) on groupMemberships — the error
                // text includes a direct link to auto-create it.
                return QueryErrorMessage(error: snap.error);
              }
              final memberships = snap.data?.docs ?? [];
              if (memberships.isEmpty) {
                return const Center(child: Text('No members yet.'));
              }
              return ListView.separated(
                controller: scrollController,
                padding: const EdgeInsets.fromLTRB(20, 4, 20, 20),
                itemCount: memberships.length,
                separatorBuilder: (_, __) => const Divider(height: 1),
                itemBuilder: (context, i) {
                  final m = memberships[i].data();
                  final userId = m['userId'] as String;
                  final role = m['role'] as String?;
                  return FutureBuilder<DocumentSnapshot<Map<String, dynamic>>>(
                    future: FirebaseFirestore.instance.collection('users').doc(userId).get(),
                    builder: (context, userSnap) {
                      final loading = userSnap.connectionState == ConnectionState.waiting;
                      // Was falling back to the literal string 'Loading…'
                      // on error too — a permissions problem then looked
                      // identical to "still loading", forever, instead
                      // of surfacing what actually went wrong.
                      final name = userSnap.hasError
                          ? 'Couldn\'t load'
                          : (userSnap.data?.data()?['displayName'] as String? ?? (loading ? '' : 'Member'));
                      final initial = name.isNotEmpty ? name[0].toUpperCase() : '?';
                      return ListTile(
                        contentPadding: EdgeInsets.zero,
                        leading: CircleAvatar(
                          backgroundColor: userSnap.hasError
                              ? Theme.of(context).colorScheme.errorContainer
                              : Theme.of(context).colorScheme.primaryContainer,
                          child: loading
                              ? const SizedBox(width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2))
                              : Text(
                                  initial,
                                  style: TextStyle(
                                    color: userSnap.hasError
                                        ? Theme.of(context).colorScheme.error
                                        : Theme.of(context).colorScheme.primary,
                                    fontWeight: FontWeight.w700,
                                  ),
                                ),
                        ),
                        title: loading ? null : Text(name, style: userSnap.hasError ? TextStyle(color: Theme.of(context).colorScheme.error) : null),
                        subtitle: userSnap.hasError
                            ? Text(userSnap.error.toString(), maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 10.5))
                            : null,
                        trailing: role == 'host'
                            ? Container(
                                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                                decoration: BoxDecoration(
                                  color: const Color(0xFFFEF3C7),
                                  borderRadius: BorderRadius.circular(999),
                                ),
                                child: const Text('Host', style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: Color(0xFFB45309))),
                              )
                            : null,
                      );
                    },
                  );
                },
              );
            },
          ),
        ),
      ],
    );
  }
}
