import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'query_error_message.dart';
import 'event_location.dart';
import '../../core/app_colors.dart';
import '../donations/donation_screen.dart';
import '../groups/my_groups_screen.dart';

/// The Home tab's dashboard body — everything below the hero header and
/// banner carousel: a 4-tile live-stats grid, a 6-tile quick-actions
/// grid, the next couple of upcoming events, and a recent-activity feed.
/// Matches the approved design concept. Reads only collections/fields
/// the rest of the app already reads (groupMemberships, eventAttendees,
/// events, attendance, donations, notifications) — nothing here invents
/// a new backend shape.
class HomeDashboard extends StatefulWidget {
  const HomeDashboard({super.key, required this.onNavigateTab});

  /// Switches the shell's bottom-nav tab. Since the approved reference
  /// fixed the bottom nav to exactly Home/Calendar/Attendance/Requests/
  /// Notifications, Groups and Profile no longer have a tab index of
  /// their own — destinations that used to be "switch to the Groups
  /// tab" now push MyGroupsScreen directly instead (see the two
  /// Navigator.push(MyGroupsScreen()) calls below).
  /// 0=Home, 1=Calendar, 2=Attendance, 3=Requests, 4=Notifications.
  final void Function(int index) onNavigateTab;

  @override
  State<HomeDashboard> createState() => _HomeDashboardState();
}

class _HomeDashboardState extends State<HomeDashboard> {
  // Kicked off exactly once (in initState, not build) and cached here —
  // this used to be created fresh inside build(), which re-ran the
  // whole chunked events+attendance fetch from Firestore on every
  // rebuild (a theme change, a keyboard open/close, anything that
  // touched this widget's dependencies), not just once per screen visit.
  late final Future<List<_MemberEvent>> _eventsFuture = _loadMemberEvents(FirebaseAuth.instance.currentUser!.uid);

  @override
  Widget build(BuildContext context) {
    final uid = FirebaseAuth.instance.currentUser!.uid;

    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
      children: [
        _StatsGrid(uid: uid, eventsFuture: _eventsFuture, onNavigateTab: widget.onNavigateTab),
        const SizedBox(height: 24),
        const _SectionHeader(title: 'Quick Actions'),
        const SizedBox(height: 12),
        // Renders immediately — doesn't touch _eventsFuture at all, so
        // it no longer sits behind the events fetch the way it used to
        // when this whole section was nested inside one big FutureBuilder.
        _QuickActionsGrid(onNavigateTab: widget.onNavigateTab),
        const SizedBox(height: 24),
        _SectionHeader(title: 'Upcoming Events', onViewAll: () => widget.onNavigateTab(1)),
        const SizedBox(height: 8),
        FutureBuilder<List<_MemberEvent>>(
          future: _eventsFuture,
          builder: (context, snap) {
            if (snap.connectionState == ConnectionState.waiting) {
              return const _SectionLoadingPlaceholder();
            }
            if (snap.hasError) {
              return QueryErrorMessage(error: snap.error, compact: true);
            }
            return _UpcomingEventsList(events: snap.data ?? const []);
          },
        ),
        const SizedBox(height: 24),
        _SectionHeader(title: 'Recent Activity', onViewAll: () => widget.onNavigateTab(4)),
        const SizedBox(height: 8),
        const _RecentActivityList(),
      ],
    );
  }
}

class _SectionLoadingPlaceholder extends StatelessWidget {
  const _SectionLoadingPlaceholder();
  @override
  Widget build(BuildContext context) {
    return const Padding(
      padding: EdgeInsets.symmetric(vertical: 20),
      child: Center(child: SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2.4))),
    );
  }
}

/// One event the signed-in member is attending, with the join/lookup
/// work already done — mirrors the fetch pattern in
/// features/events/my_events_screen.dart so the two screens agree on
/// what "upcoming" and "checked in" mean.
class _MemberEvent {
  final String eventId;
  final String title;
  final DateTime? startAt;
  final DateTime? endAt;
  final String? location;
  final bool checkedIn;

  _MemberEvent({
    required this.eventId,
    required this.title,
    required this.startAt,
    required this.endAt,
    required this.location,
    required this.checkedIn,
  });
}

/// Batched, chunked lookup of the member's attendee events (same shape
/// as MyEventsScreen). Independent chunk queries and the events/
/// attendance lookups now run concurrently instead of strictly
/// sequentially — each `await`-free "kick off, then await" pair starts
/// both requests before either one is waited on.
Future<List<_MemberEvent>> _loadMemberEvents(String uid) async {
  final firestore = FirebaseFirestore.instance;
  final attendeeSnap = await firestore.collection('eventAttendees').where('userId', isEqualTo: uid).get();
  final eventIds = attendeeSnap.docs.map((d) => d.data()['eventId'] as String).toSet().toList();
  if (eventIds.isEmpty) return [];

  Future<Map<String, Map<String, dynamic>>> fetchByIds(String collection, List<String> ids) async {
    final chunks = <List<String>>[];
    for (var i = 0; i < ids.length; i += 30) {
      chunks.add(ids.sublist(i, i + 30 > ids.length ? ids.length : i + 30));
    }
    // Every chunk is independent — fire them all at once rather than
    // one at a time (this only matters once a group's attendee list
    // crosses 30 events/ids, but costs nothing when it doesn't).
    final snaps = await Future.wait(
      chunks.map((chunk) => firestore.collection(collection).where(FieldPath.documentId, whereIn: chunk).get()),
    );
    final result = <String, Map<String, dynamic>>{};
    for (final snap in snaps) {
      for (final d in snap.docs) {
        result[d.id] = d.data();
      }
    }
    return result;
  }

  // events and attendance are two unrelated lookups — start both before
  // awaiting either.
  final eventsFuture = fetchByIds('events', eventIds);
  // NOT fetchByIds('attendance', attendanceIds) — Firestore evaluates a
  // security rule for a *query* against the query's own declared filters,
  // not the actual data it happens to return. A whereIn on
  // FieldPath.documentId gives the rules engine nothing to check
  // resource.data.userId against, so firestore.rules' isSelf(...) can't
  // prove every possible match is this member's own record and rejects
  // the whole query — even though, in practice, every id here (built as
  // `${eventId}_$uid`) already is theirs. Filtering on the real `userId`
  // field instead is both self-scoped (needs no chunking — it's already
  // one query) and something the rule can actually verify.
  final attendanceFuture = firestore.collection('attendance').where('userId', isEqualTo: uid).get();
  final eventsById = await eventsFuture;
  final checkedInEventIds = (await attendanceFuture).docs.map((d) => d.data()['eventId'] as String).toSet();

  final events = <_MemberEvent>[];
  for (final eventId in eventIds) {
    final event = eventsById[eventId];
    if (event == null) continue;
    if ((event['status'] as String? ?? 'draft') == 'cancelled') continue;
    events.add(_MemberEvent(
      eventId: eventId,
      title: event['title'] as String? ?? 'Untitled event',
      startAt: (event['startAt'] as Timestamp?)?.toDate(),
      endAt: (event['endAt'] as Timestamp?)?.toDate(),
      location: formatEventLocation(event['location']),
      checkedIn: checkedInEventIds.contains(eventId),
    ));
  }
  events.sort((a, b) => (a.startAt ?? DateTime(0)).compareTo(b.startAt ?? DateTime(0)));
  return events;
}

class _SectionHeader extends StatelessWidget {
  const _SectionHeader({required this.title, this.onViewAll});
  final String title;
  final VoidCallback? onViewAll;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Text(
          title,
          style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700, color: AppColors.brandGreenDark),
        ),
        if (onViewAll != null)
          TextButton(
            onPressed: onViewAll,
            child: const Row(
              mainAxisSize: MainAxisSize.min,
              children: [Text('View All'), SizedBox(width: 2), Icon(Icons.arrow_forward, size: 16)],
            ),
          ),
      ],
    );
  }
}

// ---------------------------------------------------------------------
// Stats grid
// ---------------------------------------------------------------------

class _StatsGrid extends StatelessWidget {
  const _StatsGrid({required this.uid, required this.eventsFuture, required this.onNavigateTab});
  final String uid;
  final Future<List<_MemberEvent>> eventsFuture;
  final void Function(int index) onNavigateTab;

  @override
  Widget build(BuildContext context) {
    return GridView.count(
      crossAxisCount: 2,
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      mainAxisSpacing: 12,
      crossAxisSpacing: 12,
      childAspectRatio: 1.35,
      children: [
        StreamBuilder<QuerySnapshot<Map<String, dynamic>>>(
          stream: FirebaseFirestore.instance
              .collection('groupMemberships')
              .where('userId', isEqualTo: uid)
              .where('status', isEqualTo: 'active')
              .snapshots(),
          builder: (context, snap) => _StatCard(
            icon: Icons.groups_rounded,
            iconBg: const Color(0xFFDCEEE2),
            iconColor: AppColors.brandGreen,
            value: snap.data?.docs.length.toString() ?? '—',
            label: 'My Groups',
            error: snap.error,
            onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const MyGroupsScreen())),
          ),
        ),
        // These two depend on the shared events fetch — each gets its
        // own small FutureBuilder so a slow events fetch only leaves
        // *these* two cells showing "—" briefly, instead of blocking
        // the whole grid (or the whole page, as it used to).
        FutureBuilder<List<_MemberEvent>>(
          future: eventsFuture,
          builder: (context, snap) {
            final now = DateTime.now();
            final upcomingCount = snap.data?.where((e) => e.startAt != null && e.startAt!.isAfter(now)).length;
            return _StatCard(
              icon: Icons.event_available_rounded,
              iconBg: const Color(0xFFDCF5E3),
              iconColor: const Color(0xFF16A34A),
              value: upcomingCount?.toString() ?? '—',
              label: 'Upcoming Events',
              error: snap.hasError ? snap.error : null,
              onTap: () => onNavigateTab(1),
            );
          },
        ),
        FutureBuilder<List<_MemberEvent>>(
          future: eventsFuture,
          builder: (context, snap) {
            final now = DateTime.now();
            // "Pending check-ins": events the member is on the attendee
            // list for, hasn't checked into yet, and that are open
            // now-ish (started up to 3h ago, not yet ended more than 3h
            // ago) — i.e. check-in is realistically still possible
            // today, not a stale past event.
            final pendingCheckins = snap.data?.where((e) {
              if (e.checkedIn || e.startAt == null) return false;
              final windowStart = e.startAt!.subtract(const Duration(hours: 1));
              final windowEnd = (e.endAt ?? e.startAt!.add(const Duration(hours: 2))).add(const Duration(hours: 3));
              return now.isAfter(windowStart) && now.isBefore(windowEnd);
            }).length;
            return _StatCard(
              icon: Icons.check_circle_rounded,
              iconBg: const Color(0xFFEDE3FF),
              iconColor: const Color(0xFF7C3AED),
              value: pendingCheckins?.toString() ?? '—',
              label: 'Pending Check-ins',
              error: snap.hasError ? snap.error : null,
              onTap: () => onNavigateTab(2),
            );
          },
        ),
        StreamBuilder<QuerySnapshot<Map<String, dynamic>>>(
          stream: FirebaseFirestore.instance
              .collection('donations')
              .where('userId', isEqualTo: uid)
              .where('status', isEqualTo: 'succeeded')
              .snapshots(),
          builder: (context, snap) {
            final totalCents = (snap.data?.docs ?? [])
                .fold<int>(0, (sum, d) => sum + ((d.data()['amountCents'] as num?)?.toInt() ?? 0));
            return _StatCard(
              icon: Icons.favorite_rounded,
              iconBg: const Color(0xFFFCE1E6),
              iconColor: const Color(0xFFDC2626),
              value: '\$${(totalCents / 100).toStringAsFixed(0)}',
              label: 'Total Donations',
              error: snap.error,
              onTap: () => Navigator.of(context)
                  .push(MaterialPageRoute(builder: (_) => const DonationScreen())),
            );
          },
        ),
      ],
    );
  }
}

class _StatCard extends StatelessWidget {
  const _StatCard({
    required this.icon,
    required this.iconBg,
    required this.iconColor,
    required this.value,
    required this.label,
    this.onTap,
    this.error,
  });
  final IconData icon;
  final Color iconBg;
  final Color iconColor;
  final String value;
  final String label;
  final VoidCallback? onTap;
  final Object? error;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Theme.of(context).colorScheme.surface,
      borderRadius: BorderRadius.circular(16),
      child: InkWell(
        onTap: error != null ? () => _showErrorDialog(context) : onTap,
        borderRadius: BorderRadius.circular(16),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(16),
            border: Border.all(
              color: error != null
                  ? Theme.of(context).colorScheme.error.withOpacity(0.5)
                  : Theme.of(context).colorScheme.outlineVariant.withOpacity(0.4),
            ),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Container(
                    padding: const EdgeInsets.all(6),
                    decoration: BoxDecoration(color: iconBg, borderRadius: BorderRadius.circular(10)),
                    child: Icon(icon, color: iconColor, size: 16),
                  ),
                  if (error != null)
                    Icon(Icons.error_outline_rounded, size: 16, color: Theme.of(context).colorScheme.error)
                  else if (onTap != null)
                    Icon(Icons.chevron_right, size: 16, color: Theme.of(context).colorScheme.outline),
                ],
              ),
              const SizedBox(height: 8),
              Text(
                error != null ? '!' : value,
                style: TextStyle(
                  fontSize: 19,
                  fontWeight: FontWeight.w800,
                  color: error != null ? Theme.of(context).colorScheme.error : null,
                ),
                maxLines: 1,
              ),
              const SizedBox(height: 2),
              Text(
                error != null ? 'Tap for details' : label,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  fontSize: 11.5,
                  color: error != null ? Theme.of(context).colorScheme.error : Theme.of(context).colorScheme.onSurfaceVariant,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  void _showErrorDialog(BuildContext context) {
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: Text('Couldn\'t load "$label"'),
        content: SingleChildScrollView(child: SelectableText(error.toString())),
        actions: [TextButton(onPressed: () => Navigator.of(context).pop(), child: const Text('Close'))],
      ),
    );
  }
}

// ---------------------------------------------------------------------
// Quick actions grid
// ---------------------------------------------------------------------

class _QuickActionsGrid extends StatelessWidget {
  const _QuickActionsGrid({required this.onNavigateTab});
  final void Function(int index) onNavigateTab;

  @override
  Widget build(BuildContext context) {
    final actions = [
      _QuickAction(
        icon: Icons.event_available_rounded,
        color: const Color(0xFF2563EB),
        bg: const Color(0xFFE3EBFF),
        title: 'Check In',
        subtitle: 'Mark your attendance for events',
        onTap: () => onNavigateTab(2), // Attendance tab — host scans it to check in
      ),
      _QuickAction(
        icon: Icons.event_repeat_rounded,
        color: const Color(0xFF16A34A),
        bg: const Color(0xFFDFF5E5),
        title: 'Request Event',
        subtitle: 'Request admin to create a new event',
        onTap: () {
          Navigator.of(context).push(MaterialPageRoute(builder: (_) => const MyGroupsScreen()));
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('Pick a group, then "Propose an event"')),
          );
        },
      ),
      _QuickAction(
        icon: Icons.volunteer_activism_rounded,
        color: const Color(0xFF7C3AED),
        bg: const Color(0xFFEEE3FF),
        title: 'Donate',
        subtitle: 'Support the group with your contribution',
        onTap: () => Navigator.of(context).push(
          MaterialPageRoute(builder: (_) => const DonationScreen()),
        ),
      ),
      _QuickAction(
        icon: Icons.description_rounded,
        color: const Color(0xFFD97706),
        bg: const Color(0xFFFDECD1),
        title: 'My Events',
        subtitle: "View events you're registered for",
        onTap: () => onNavigateTab(1),
      ),
      _QuickAction(
        icon: Icons.how_to_reg_rounded,
        color: const Color(0xFF0D9488),
        bg: const Color(0xFFD9F2EE),
        title: 'My Attendance',
        subtitle: 'Check your attendance history',
        onTap: () => onNavigateTab(2),
      ),
      _QuickAction(
        icon: Icons.notifications_none_rounded,
        color: const Color(0xFFDC2626),
        bg: const Color(0xFFFCE1E6),
        title: 'Notifications',
        subtitle: 'Stay updated with latest activity',
        onTap: () => onNavigateTab(4),
      ),
    ];

    return GridView.count(
      crossAxisCount: 2,
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      mainAxisSpacing: 12,
      crossAxisSpacing: 12,
      childAspectRatio: 1.05,
      children: actions,
    );
  }
}

class _QuickAction extends StatelessWidget {
  const _QuickAction({
    required this.icon,
    required this.color,
    required this.bg,
    required this.title,
    required this.subtitle,
    required this.onTap,
  });
  final IconData icon;
  final Color color;
  final Color bg;
  final String title;
  final String subtitle;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: bg,
      borderRadius: BorderRadius.circular(16),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(16),
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Container(
                    padding: const EdgeInsets.all(7),
                    decoration: BoxDecoration(
                      color: Colors.white.withOpacity(0.6),
                      borderRadius: BorderRadius.circular(11),
                    ),
                    child: Icon(icon, color: color, size: 20),
                  ),
                  Icon(Icons.chevron_right, size: 16, color: color.withOpacity(0.7)),
                ],
              ),
              const SizedBox(height: 10),
              Text(title, style: TextStyle(fontWeight: FontWeight.w700, fontSize: 14.5, color: color)),
              const SizedBox(height: 3),
              Text(
                subtitle,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(fontSize: 11.5, color: color.withOpacity(0.8), height: 1.25),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------
// Upcoming events
// ---------------------------------------------------------------------

class _UpcomingEventsList extends StatelessWidget {
  const _UpcomingEventsList({required this.events});
  final List<_MemberEvent> events;

  @override
  Widget build(BuildContext context) {
    final now = DateTime.now();
    final upcoming = events.where((e) => e.startAt != null && e.startAt!.isAfter(now)).take(2).toList();

    if (upcoming.isEmpty) {
      return const _EmptyRow(text: 'No upcoming events yet.');
    }

    return Column(
      children: upcoming.map((e) => Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: _UpcomingEventCard(event: e),
          )).toList(),
    );
  }
}

const _monthAbbr = [
  'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC',
];

class _UpcomingEventCard extends StatelessWidget {
  const _UpcomingEventCard({required this.event});
  final _MemberEvent event;

  String _timeRange() {
    String fmt(DateTime d) {
      final hour = d.hour % 12 == 0 ? 12 : d.hour % 12;
      final minute = d.minute.toString().padLeft(2, '0');
      final period = d.hour >= 12 ? 'PM' : 'AM';
      return '$hour:$minute $period';
    }

    final start = event.startAt;
    final end = event.endAt;
    if (start == null) return '';
    return end == null ? fmt(start) : '${fmt(start)} - ${fmt(end)}';
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final start = event.startAt!;

    return Material(
      color: scheme.surface,
      borderRadius: BorderRadius.circular(14),
      child: InkWell(
        borderRadius: BorderRadius.circular(14),
        onTap: () {},
        child: Container(
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: scheme.outlineVariant.withOpacity(0.4)),
          ),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                width: 52,
                padding: const EdgeInsets.symmetric(vertical: 8),
                decoration: BoxDecoration(color: scheme.primaryContainer, borderRadius: BorderRadius.circular(10)),
                child: Column(
                  children: [
                    Text(
                      _monthAbbr[start.month - 1],
                      style: TextStyle(fontSize: 10, fontWeight: FontWeight.w700, color: scheme.primary),
                    ),
                    Text(
                      start.day.toString(),
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
                    Text(event.title, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14.5)),
                    const SizedBox(height: 4),
                    Row(
                      children: [
                        Icon(Icons.access_time_rounded, size: 13, color: scheme.onSurfaceVariant),
                        const SizedBox(width: 4),
                        Text(_timeRange(), style: TextStyle(fontSize: 12, color: scheme.onSurfaceVariant)),
                      ],
                    ),
                    if (event.location != null && event.location!.isNotEmpty) ...[
                      const SizedBox(height: 2),
                      Row(
                        children: [
                          Icon(Icons.place_outlined, size: 13, color: scheme.onSurfaceVariant),
                          const SizedBox(width: 4),
                          Expanded(
                            child: Text(
                              event.location!,
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
                  color: event.checkedIn ? const Color(0xFFDCF5E3) : const Color(0xFFE3EBFF),
                  borderRadius: BorderRadius.circular(999),
                ),
                child: Text(
                  event.checkedIn ? 'Checked In' : "You're Invited",
                  style: TextStyle(
                    fontSize: 10.5,
                    fontWeight: FontWeight.w700,
                    color: event.checkedIn ? const Color(0xFF16A34A) : const Color(0xFF2563EB),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------
// Recent activity
// ---------------------------------------------------------------------

class _RecentActivityList extends StatelessWidget {
  const _RecentActivityList();

  @override
  Widget build(BuildContext context) {
    final uid = FirebaseAuth.instance.currentUser!.uid;
    final query = FirebaseFirestore.instance
        .collection('notifications')
        .where('userId', isEqualTo: uid)
        .orderBy('createdAt', descending: true)
        .limit(3);

    return StreamBuilder<QuerySnapshot<Map<String, dynamic>>>(
      stream: query.snapshots(),
      builder: (context, snap) {
        final docs = snap.data?.docs ?? [];
        if (docs.isEmpty) {
          return const _EmptyRow(text: 'No recent activity yet.');
        }
        return Material(
          color: Theme.of(context).colorScheme.surface,
          borderRadius: BorderRadius.circular(14),
          child: Column(
            children: List.generate(docs.length, (i) {
              final data = docs[i].data();
              final createdAt = (data['createdAt'] as Timestamp?)?.toDate();
              return Column(
                children: [
                  ListTile(
                    leading: CircleAvatar(
                      backgroundColor: Theme.of(context).colorScheme.primaryContainer,
                      child: Icon(Icons.notifications_rounded, size: 18, color: Theme.of(context).colorScheme.primary),
                    ),
                    title: Text(data['title'] as String? ?? '', style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13.5)),
                    subtitle: Text(
                      createdAt != null ? _relativeTime(createdAt) : (data['body'] as String? ?? ''),
                      style: const TextStyle(fontSize: 11.5),
                    ),
                    dense: true,
                  ),
                  if (i != docs.length - 1) const Divider(height: 1),
                ],
              );
            }),
          ),
        );
      },
    );
  }

  String _relativeTime(DateTime dt) {
    final diff = DateTime.now().difference(dt);
    if (diff.inMinutes < 1) return 'Just now';
    if (diff.inHours < 1) return '${diff.inMinutes} min ago';
    if (diff.inDays < 1) return '${diff.inHours} hr ago';
    if (diff.inDays < 7) return '${diff.inDays} day${diff.inDays == 1 ? '' : 's'} ago';
    return '${dt.month}/${dt.day}/${dt.year}';
  }
}

class _EmptyRow extends StatelessWidget {
  const _EmptyRow({required this.text});
  final String text;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surface,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: Theme.of(context).colorScheme.outlineVariant.withOpacity(0.4)),
      ),
      child: Center(
        child: Text(text, style: TextStyle(color: Theme.of(context).colorScheme.onSurfaceVariant, fontSize: 13)),
      ),
    );
  }
}
