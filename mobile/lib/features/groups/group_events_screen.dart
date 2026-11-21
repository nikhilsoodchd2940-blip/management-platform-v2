import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import '../absence/request_absence_dialog.dart';
import '../content/query_error_message.dart';

/// Published events belonging to just THIS group — deliberately excludes
/// anything shown on the main "Events" tab (MyEventsScreen), which is
/// Main Group (organization-wide) events only. Same split rule used
/// everywhere else in the app (admin panel's Events page, the Host's
/// per-group event list): subGroupIds.length > 1 = Main Group Event,
/// subGroupIds.length <= 1 = this group's own event.
class GroupEventsScreen extends StatefulWidget {
  final String groupId;
  final String groupName;

  const GroupEventsScreen({super.key, required this.groupId, required this.groupName});

  @override
  State<GroupEventsScreen> createState() => _GroupEventsScreenState();
}

class _GroupEventsScreenState extends State<GroupEventsScreen> {
  Future<Set<String>>? _checkedInFuture;

  // Was: chunked whereIn(FieldPath.documentId, ['{eventId}_{uid}', ...]).
  // Firestore checks a query's security rule against the query's own
  // declared filters, not the data it happens to return — a
  // documentId-based whereIn gives firestore.rules' isSelf(resource.data.userId)
  // nothing to verify per potential match, so it rejects the whole query
  // (permission-denied) even though every id here is actually this
  // member's own record. Filtering on the real `userId` field instead is
  // both self-scoped (one query, no chunking needed) and something the
  // rule can actually check — same fix applied to the equivalent lookups
  // in home_dashboard.dart and my_events_screen.dart.
  Future<Set<String>> _loadCheckedInEventIds() async {
    final uid = FirebaseAuth.instance.currentUser!.uid;
    final snap = await FirebaseFirestore.instance.collection('attendance').where('userId', isEqualTo: uid).get();
    return snap.docs.map((d) => d.data()['eventId'] as String).toSet();
  }

  @override
  Widget build(BuildContext context) {
    final q = FirebaseFirestore.instance
        .collection('events')
        .where('subGroupIds', arrayContains: widget.groupId)
        .orderBy('startAt', descending: true)
        .limit(50);

    return Scaffold(
      appBar: AppBar(title: Text('${widget.groupName} Events')),
      body: StreamBuilder<QuerySnapshot<Map<String, dynamic>>>(
        stream: q.snapshots(),
        builder: (context, snap) {
          if (snap.connectionState == ConnectionState.waiting) {
            return const Center(child: CircularProgressIndicator());
          }
          if (snap.hasError) {
            return QueryErrorMessage(error: snap.error);
          }
          final events = (snap.data?.docs ?? [])
              .where((d) =>
                  d.data()['status'] == 'published' && ((d.data()['subGroupIds'] as List?)?.length ?? 0) <= 1)
              .toList();

          if (events.isEmpty) {
            return const Center(
              child: Padding(
                padding: EdgeInsets.all(24),
                child: Text("No events for this group yet."),
              ),
            );
          }

          _checkedInFuture ??= _loadCheckedInEventIds();

          return FutureBuilder<Set<String>>(
            future: _checkedInFuture,
            builder: (context, checkedInSnap) {
              if (checkedInSnap.hasError) {
                return QueryErrorMessage(error: checkedInSnap.error);
              }
              final checkedIn = checkedInSnap.data ?? const {};
              return ListView.separated(
                padding: const EdgeInsets.all(16),
                itemCount: events.length,
                separatorBuilder: (_, __) => const SizedBox(height: 8),
                itemBuilder: (context, i) {
                  final doc = events[i];
                  final data = doc.data();
                  final title = data['title'] as String? ?? '';
                  final startAt = (data['startAt'] as Timestamp?)?.toDate();
                  final isCheckedIn = checkedIn.contains(doc.id);

                  return Card(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        ListTile(
                          title: Text(title),
                          subtitle: startAt != null ? Text(startAt.toLocal().toString()) : null,
                          trailing: isCheckedIn
                              ? const Chip(
                                  label: Text('Checked in'),
                                  visualDensity: VisualDensity.compact,
                                  backgroundColor: Color(0xFFDCEFDC),
                                )
                              : null,
                        ),
                        if (!isCheckedIn)
                          Padding(
                            padding: const EdgeInsets.fromLTRB(8, 0, 8, 8),
                            child: Align(
                              alignment: Alignment.centerRight,
                              child: TextButton(
                                onPressed: () => showRequestAbsenceDialog(context, eventId: doc.id),
                                child: const Text('Request absence'),
                              ),
                            ),
                          ),
                      ],
                    ),
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
