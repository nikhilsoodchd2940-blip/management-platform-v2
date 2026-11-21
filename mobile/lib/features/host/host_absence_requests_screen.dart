import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/material.dart';

/// Pending absence requests for events belonging to this Sub Group
/// (blueprint §7). Two-step: find this group's events, then find pending
/// absenceRequests for each — acceptable N+1 at Phase 3's event volumes;
/// a collection-group query would need every request to carry groupId
/// redundantly, which isn't worth it yet (see docs/DATA_MODEL.md
/// philosophy of not generalizing ahead of an actual need).
class HostAbsenceRequestsScreen extends StatelessWidget {
  final String groupId;
  final String groupName;

  const HostAbsenceRequestsScreen({super.key, required this.groupId, required this.groupName});

  @override
  Widget build(BuildContext context) {
    final eventsQuery =
        FirebaseFirestore.instance.collection('events').where('subGroupIds', arrayContains: groupId);

    return Scaffold(
      appBar: AppBar(title: Text('Absence requests · $groupName')),
      body: FutureBuilder<QuerySnapshot<Map<String, dynamic>>>(
        future: eventsQuery.get(),
        builder: (context, eventsSnap) {
          if (eventsSnap.connectionState == ConnectionState.waiting) {
            return const Center(child: CircularProgressIndicator());
          }
          final eventIds = eventsSnap.data?.docs.map((d) => d.id).toList() ?? [];
          if (eventIds.isEmpty) {
            return const Center(child: Text('No events for this group yet.'));
          }

          return FutureBuilder<List<QuerySnapshot<Map<String, dynamic>>>>(
            future: Future.wait(eventIds.map(
              (eventId) => FirebaseFirestore.instance
                  .collection('absenceRequests')
                  .where('eventId', isEqualTo: eventId)
                  .where('status', isEqualTo: 'pending')
                  .get(),
            )),
            builder: (context, snaps) {
              if (!snaps.hasData) {
                return const Center(child: CircularProgressIndicator());
              }
              final requests = snaps.data!.expand((s) => s.docs).toList();
              if (requests.isEmpty) {
                return const Center(child: Text('No pending absence requests.'));
              }
              return ListView.separated(
                padding: const EdgeInsets.all(16),
                itemCount: requests.length,
                separatorBuilder: (_, __) => const SizedBox(height: 8),
                itemBuilder: (context, i) {
                  final data = requests[i].data();
                  final eventId = data['eventId'] as String;
                  final userId = data['userId'] as String;
                  final reason = data['reason'] as String? ?? '';

                  return FutureBuilder<DocumentSnapshot<Map<String, dynamic>>>(
                    future: FirebaseFirestore.instance.collection('users').doc(userId).get(),
                    builder: (context, userSnap) {
                      final name = userSnap.data?.data()?['displayName'] as String? ?? '…';
                      return Card(
                        child: Padding(
                          padding: const EdgeInsets.all(12),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(name, style: Theme.of(context).textTheme.titleSmall),
                              const SizedBox(height: 4),
                              Text(reason),
                              const SizedBox(height: 8),
                              Row(
                                mainAxisAlignment: MainAxisAlignment.end,
                                children: [
                                  TextButton(
                                    onPressed: () => _decide(context, eventId, userId, 'rejected'),
                                    child: const Text('Reject'),
                                  ),
                                  const SizedBox(width: 8),
                                  FilledButton(
                                    onPressed: () => _decide(context, eventId, userId, 'approved'),
                                    child: const Text('Approve'),
                                  ),
                                ],
                              ),
                            ],
                          ),
                        ),
                      );
                    },
                  );
                },
              );
            },
          );
        },
      ),
    );
  }

  Future<void> _decide(BuildContext context, String eventId, String userId, String decision) async {
    final callable = FirebaseFunctions.instance.httpsCallable('reviewAbsenceRequest');
    await callable.call({'eventId': eventId, 'userId': userId, 'decision': decision});
  }
}
