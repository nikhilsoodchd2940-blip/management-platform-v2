import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';
import 'qr_scan_screen.dart';

/// Published events for one Sub Group the Host is assigned to. Query is
/// deliberately just `subGroupIds array-contains groupId`, ordered by
/// startAt — status is filtered client-side rather than adding a second
/// equality clause, so this doesn't need a new composite index beyond the
/// one already declared for the calendar view (firestore.indexes.json).
///
/// Split into "Main Group Events" (subGroupIds spans more than this one
/// group — organization-wide, this group just happens to be included)
/// and "This Group's Events" (subGroupIds is just this one group) —
/// same distinction the admin panel's Events page and the member-facing
/// MyEventsScreen use, so a Host managing one group's calendar can tell
/// at a glance which events are theirs to organize versus which are
/// the whole org's.
class HostEventListScreen extends StatelessWidget {
  final String groupId;
  final String groupName;

  const HostEventListScreen({super.key, required this.groupId, required this.groupName});

  @override
  Widget build(BuildContext context) {
    final q = FirebaseFirestore.instance
        .collection('events')
        .where('subGroupIds', arrayContains: groupId)
        .orderBy('startAt', descending: true)
        .limit(50);

    return Scaffold(
      appBar: AppBar(title: Text('$groupName · Events')),
      body: StreamBuilder<QuerySnapshot<Map<String, dynamic>>>(
        stream: q.snapshots(),
        builder: (context, snap) {
          if (snap.connectionState == ConnectionState.waiting) {
            return const Center(child: CircularProgressIndicator());
          }
          final events = (snap.data?.docs ?? [])
              .where((d) => d.data()['status'] == 'published')
              .toList();
          if (events.isEmpty) {
            return const Center(child: Text('No published events for this group yet.'));
          }

          final mainGroupEvents = events.where((d) => ((d.data()['subGroupIds'] as List?)?.length ?? 0) > 1).toList();
          final ownEvents = events.where((d) => ((d.data()['subGroupIds'] as List?)?.length ?? 0) <= 1).toList();

          return ListView(
            padding: const EdgeInsets.all(16),
            children: [
              if (mainGroupEvents.isNotEmpty) ...[
                _SectionHeader(title: 'Main Group Events'),
                const SizedBox(height: 8),
                for (final d in mainGroupEvents) ...[
                  _EventTile(doc: d),
                  const SizedBox(height: 8),
                ],
                const SizedBox(height: 16),
              ],
              if (ownEvents.isNotEmpty) ...[
                _SectionHeader(title: "This Group's Events"),
                const SizedBox(height: 8),
                for (final d in ownEvents) ...[
                  _EventTile(doc: d),
                  const SizedBox(height: 8),
                ],
              ],
            ],
          );
        },
      ),
    );
  }
}

class _SectionHeader extends StatelessWidget {
  const _SectionHeader({required this.title});
  final String title;

  @override
  Widget build(BuildContext context) {
    return Text(
      title,
      style: Theme.of(context).textTheme.titleSmall?.copyWith(
            fontWeight: FontWeight.w700,
            color: Theme.of(context).colorScheme.onSurfaceVariant,
          ),
    );
  }
}

class _EventTile extends StatelessWidget {
  const _EventTile({required this.doc});
  final QueryDocumentSnapshot<Map<String, dynamic>> doc;

  @override
  Widget build(BuildContext context) {
    final data = doc.data();
    final title = data['title'] as String? ?? '';
    final startAt = (data['startAt'] as Timestamp?)?.toDate();
    return Card(
      child: ListTile(
        title: Text(title),
        subtitle: startAt != null ? Text(startAt.toLocal().toString()) : null,
        trailing: FilledButton.icon(
          icon: const Icon(Icons.qr_code_scanner, size: 18),
          label: const Text('Scan'),
          onPressed: () => Navigator.of(context).push(
            MaterialPageRoute(
              builder: (_) => QrScanScreen(eventId: doc.id, eventTitle: title),
            ),
          ),
        ),
      ),
    );
  }
}
