import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import '../absence/request_absence_dialog.dart';
import '../content/event_location.dart';

/// Main Group (organization-wide) events the signed-in member is on the
/// attendee list for. Group-specific events (subGroupIds scoped to just
/// one group) live under that group's own screen instead — see
/// features/groups/group_detail_screen.dart -> GroupEventsScreen — so
/// this tab is never a mix of two different kinds of thing. Same split
/// rule the admin panel's Events page and the Host's per-group event
/// list use: subGroupIds.length > 1 = Main Group Event. Whether they've
/// checked in, whether the system detected a scheduling conflict
/// (blueprint §7 — read-only here, never client-computed), and a
/// "Request absence" action per not-yet-checked-in event are all
/// preserved from before. New: an Upcoming/Past filter, since the list
/// already carries every event's startAt — free to filter client-side
/// without a second query.
class MyEventsScreen extends StatefulWidget {
  const MyEventsScreen({super.key});

  @override
  State<MyEventsScreen> createState() => _MyEventsScreenState();
}

class _EventCardData {
  final String eventId;
  final Map<String, dynamic> event;
  final bool checkedIn;
  final bool hasConflict;

  _EventCardData({
    required this.eventId,
    required this.event,
    required this.checkedIn,
    required this.hasConflict,
  });

  DateTime? get startAt => (event['startAt'] as Timestamp?)?.toDate();
  DateTime? get endAt => (event['endAt'] as Timestamp?)?.toDate();
  String get title => event['title'] as String? ?? 'Untitled event';
  String? get location => formatEventLocation(event['location']);
}

enum _EventFilter { upcoming, past }

class _MyEventsScreenState extends State<MyEventsScreen> {
  Set<String> _conflictedEventIds = {};
  _EventFilter _filter = _EventFilter.upcoming;

  @override
  void initState() {
    super.initState();
    _loadConflicts();
  }

  Future<void> _loadConflicts() async {
    final uid = FirebaseAuth.instance.currentUser!.uid;
    final snap = await FirebaseFirestore.instance
        .collection('conflicts')
        .where('userId', isEqualTo: uid)
        .get();
    final ids = <String>{};
    for (final doc in snap.docs) {
      ids.add(doc.data()['eventIdA'] as String);
      ids.add(doc.data()['eventIdB'] as String);
    }
    if (mounted) setState(() => _conflictedEventIds = ids);
  }

  /// Batch-fetches event + attendance docs up front, chunked into groups
  /// of 30 (Firestore's 'in'-query cap), so the list can be built
  /// directly instead of nesting a FutureBuilder per list item.
  Future<List<_EventCardData>> _loadEventCards(
    List<QueryDocumentSnapshot<Map<String, dynamic>>> attendeeDocs,
    String uid,
  ) async {
    final eventIds = attendeeDocs.map((d) => d.data()['eventId'] as String).toSet().toList();
    if (eventIds.isEmpty) return [];

    final firestore = FirebaseFirestore.instance;

    Future<Map<String, Map<String, dynamic>>> fetchByIds(String collection, List<String> ids) async {
      final result = <String, Map<String, dynamic>>{};
      for (var i = 0; i < ids.length; i += 30) {
        final chunk = ids.sublist(i, i + 30 > ids.length ? ids.length : i + 30);
        final snap = await firestore.collection(collection).where(FieldPath.documentId, whereIn: chunk).get();
        for (final d in snap.docs) {
          result[d.id] = d.data();
        }
      }
      return result;
    }

    // events and attendance are two independent lookups — start both
    // before awaiting either.
    final eventsFuture = fetchByIds('events', eventIds);
    // NOT fetchByIds('attendance', ...) by document ID — Firestore checks
    // a query's security rule against the query's own declared filters,
    // not the data it happens to return. A whereIn on FieldPath.documentId
    // gives firestore.rules' isSelf(resource.data.userId) nothing to
    // verify per-match, so it rejects the whole query even though every
    // id here is actually this member's own record. Filtering on the
    // real `userId` field is both self-scoped (no chunking needed — it's
    // already one query) and something the rule can actually check.
    final attendanceFuture = firestore.collection('attendance').where('userId', isEqualTo: uid).get();
    final eventsById = await eventsFuture;
    final checkedInEventIds = (await attendanceFuture).docs.map((d) => d.data()['eventId'] as String).toSet();

    final cards = <_EventCardData>[];
    for (final eventId in eventIds) {
      final event = eventsById[eventId];
      if (event == null) continue;
      if ((event['status'] as String? ?? 'draft') == 'cancelled') continue;

      cards.add(_EventCardData(
        eventId: eventId,
        event: event,
        checkedIn: checkedInEventIds.contains(eventId),
        hasConflict: _conflictedEventIds.contains(eventId),
      ));
    }
    cards.sort((a, b) {
      final aTime = a.startAt ?? DateTime(0);
      final bTime = b.startAt ?? DateTime(0);
      return aTime.compareTo(bTime);
    });
    return cards;
  }

  @override
  Widget build(BuildContext context) {
    final uid = FirebaseAuth.instance.currentUser!.uid;
    final attendeeQuery =
        FirebaseFirestore.instance.collection('eventAttendees').where('userId', isEqualTo: uid);

    return StreamBuilder<QuerySnapshot<Map<String, dynamic>>>(
      stream: attendeeQuery.snapshots(),
      builder: (context, snap) {
        if (snap.connectionState == ConnectionState.waiting) {
          return const Center(child: CircularProgressIndicator());
        }
        final attendeeDocs = snap.data?.docs ?? [];
        if (attendeeDocs.isEmpty) {
          return _buildEmpty(context, "You're not on the attendee list for any events yet.");
        }

        return FutureBuilder<List<_EventCardData>>(
          // Re-runs whenever the attendee list itself changes (new
          // invite, removed invite) — conflict checks and per-event
          // check-in state are covered by the same refetch, at the cost
          // of not being fully realtime on attendance flips mid-session;
          // acceptable for a list screen the member can pull-to-refresh
          // conceptually by navigating back into it.
          future: _loadEventCards(attendeeDocs, uid),
          builder: (context, cardsSnap) {
            if (!cardsSnap.hasData) {
              return const Center(child: CircularProgressIndicator());
            }
            final cards = cardsSnap.data!;
            // Group-specific events now live under each group's own
            // screen (GroupDetailScreen -> GroupEventsScreen) instead of
            // here — this tab is Main Group (organization-wide) events
            // only, so browsing "my events" isn't a mix of two different
            // kinds of thing.
            final mainGroupEvents = cards.where((c) => ((c.event['subGroupIds'] as List?)?.length ?? 0) > 1).toList();

            if (mainGroupEvents.isEmpty) {
              return _buildEmpty(context, "You're not on the attendee list for any events yet.");
            }

            final now = DateTime.now();
            final filtered = mainGroupEvents.where((c) {
              final isPast = c.startAt != null && c.startAt!.isBefore(now);
              return _filter == _EventFilter.past ? isPast : !isPast;
            }).toList();

            return Column(
              children: [
                Padding(
                  padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
                  child: Row(
                    children: [
                      Expanded(
                        child: _FilterChip(
                          label: 'Upcoming',
                          selected: _filter == _EventFilter.upcoming,
                          onTap: () => setState(() => _filter = _EventFilter.upcoming),
                        ),
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: _FilterChip(
                          label: 'Past',
                          selected: _filter == _EventFilter.past,
                          onTap: () => setState(() => _filter = _EventFilter.past),
                        ),
                      ),
                    ],
                  ),
                ),
                Expanded(
                  child: filtered.isEmpty
                      ? _buildEmpty(
                          context,
                          _filter == _EventFilter.upcoming ? 'No upcoming events right now.' : 'No past events yet.',
                        )
                      : ListView.separated(
                          padding: const EdgeInsets.fromLTRB(16, 8, 16, 16),
                          itemCount: filtered.length,
                          separatorBuilder: (_, __) => const SizedBox(height: 10),
                          itemBuilder: (context, i) => _EventCard(data: filtered[i]),
                        ),
                ),
              ],
            );
          },
        );
      },
    );
  }

  Widget _buildEmpty(BuildContext context, String text) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.event_busy_rounded, size: 40, color: Theme.of(context).colorScheme.outline),
            const SizedBox(height: 12),
            Text(text, textAlign: TextAlign.center, style: Theme.of(context).textTheme.bodyMedium),
          ],
        ),
      ),
    );
  }
}

class _FilterChip extends StatelessWidget {
  const _FilterChip({required this.label, required this.selected, required this.onTap});
  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Material(
      color: selected ? scheme.primary : scheme.primary.withOpacity(0.08),
      borderRadius: BorderRadius.circular(999),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(999),
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 10),
          child: Center(
            child: Text(
              label,
              style: TextStyle(
                fontWeight: FontWeight.w700,
                fontSize: 13,
                color: selected ? Colors.white : scheme.primary,
              ),
            ),
          ),
        ),
      ),
    );
  }
}

const _monthAbbr = [
  'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC',
];

String _formatTimeRange(DateTime? start, DateTime? end) {
  if (start == null) return '';
  String fmt(DateTime d) {
    final hour = d.hour % 12 == 0 ? 12 : d.hour % 12;
    final minute = d.minute.toString().padLeft(2, '0');
    final period = d.hour >= 12 ? 'PM' : 'AM';
    return '$hour:$minute $period';
  }

  return end == null ? fmt(start) : '${fmt(start)} - ${fmt(end)}';
}

class _EventCard extends StatelessWidget {
  const _EventCard({required this.data});
  final _EventCardData data;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final startAt = data.startAt;

    return Material(
      color: scheme.surface,
      borderRadius: BorderRadius.circular(16),
      child: Container(
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: scheme.outlineVariant.withOpacity(0.4)),
        ),
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Container(
                  width: 52,
                  padding: const EdgeInsets.symmetric(vertical: 8),
                  decoration: BoxDecoration(color: scheme.primaryContainer, borderRadius: BorderRadius.circular(10)),
                  child: startAt == null
                      ? const Icon(Icons.event_rounded)
                      : Column(
                          children: [
                            Text(
                              _monthAbbr[startAt.month - 1],
                              style: TextStyle(fontSize: 10, fontWeight: FontWeight.w700, color: scheme.primary),
                            ),
                            Text(
                              startAt.day.toString(),
                              style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800, color: scheme.primary),
                            ),
                          ],
                        ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(data.title, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15)),
                      const SizedBox(height: 4),
                      Row(
                        children: [
                          Icon(Icons.access_time_rounded, size: 13, color: scheme.onSurfaceVariant),
                          const SizedBox(width: 4),
                          Text(_formatTimeRange(data.startAt, data.endAt), style: TextStyle(fontSize: 12, color: scheme.onSurfaceVariant)),
                        ],
                      ),
                      if (data.location != null && data.location!.isNotEmpty) ...[
                        const SizedBox(height: 2),
                        Row(
                          children: [
                            Icon(Icons.place_outlined, size: 13, color: scheme.onSurfaceVariant),
                            const SizedBox(width: 4),
                            Expanded(
                              child: Text(
                                data.location!,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: TextStyle(fontSize: 12, color: scheme.onSurfaceVariant),
                              ),
                            ),
                          ],
                        ),
                      ],
                    ],
                  ),
                ),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                  decoration: BoxDecoration(
                    color: data.checkedIn ? const Color(0xFFDCF5E3) : const Color(0xFFE3EBFF),
                    borderRadius: BorderRadius.circular(999),
                  ),
                  child: Text(
                    data.checkedIn ? 'Checked In' : "You're Invited",
                    style: TextStyle(
                      fontSize: 10.5,
                      fontWeight: FontWeight.w700,
                      color: data.checkedIn ? const Color(0xFF16A34A) : const Color(0xFF2563EB),
                    ),
                  ),
                ),
              ],
            ),
            if (data.hasConflict) ...[
              const SizedBox(height: 10),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                decoration: BoxDecoration(
                  color: const Color(0xFFFCE1E6),
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Row(
                  children: [
                    const Icon(Icons.warning_amber_rounded, size: 16, color: Color(0xFFDC2626)),
                    const SizedBox(width: 6),
                    Expanded(
                      child: Text(
                        'Overlaps with another event you\'re invited to.',
                        style: const TextStyle(color: Color(0xFFDC2626), fontSize: 12, fontWeight: FontWeight.w600),
                      ),
                    ),
                  ],
                ),
              ),
            ],
            if (!data.checkedIn) ...[
              const SizedBox(height: 6),
              Align(
                alignment: Alignment.centerRight,
                child: TextButton(
                  onPressed: () => showRequestAbsenceDialog(context, eventId: data.eventId),
                  child: const Text('Request absence'),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
