import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import '../../core/app_colors.dart';
import '../groups/my_groups_screen.dart';

/// The "Requests" bottom-nav destination. There's no unified `requests`
/// collection in the backend — absence requests (absenceRequests) and
/// event proposals (eventRequests) are two separate, already-existing
/// flows (see features/absence/request_absence_dialog.dart and
/// features/requests/propose_event_screen.dart) — so this screen is a
/// hub over both real collections rather than a new backend module:
/// quick actions to start either flow, plus a merged, live history of
/// the member's own requests and their real status.
class RequestsHubScreen extends StatelessWidget {
  const RequestsHubScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
      children: [
        Row(
          children: [
            Expanded(
              child: _ActionTile(
                icon: Icons.event_busy_rounded,
                color: const Color(0xFFDC2626),
                bg: const Color(0xFFFCE1E6),
                title: 'Request absence',
                subtitle: 'For an event you\'re invited to',
                onTap: () {
                  Navigator.of(context).push(
                    MaterialPageRoute(builder: (_) => const MyGroupsScreen()),
                  );
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(content: Text('Open the event from your Calendar tab, then "Request absence"')),
                  );
                },
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: _ActionTile(
                icon: Icons.event_repeat_rounded,
                color: AppColors.brandGreen,
                bg: const Color(0xFFDFF5E5),
                title: 'Propose event',
                subtitle: 'Ask an admin to schedule one',
                onTap: () => Navigator.of(context).push(
                  MaterialPageRoute(builder: (_) => const MyGroupsScreen()),
                ),
              ),
            ),
          ],
        ),
        const SizedBox(height: 24),
        const Text('My Requests', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: AppColors.brandGreenDark)),
        const SizedBox(height: 10),
        const _RequestHistoryList(),
      ],
    );
  }
}

class _ActionTile extends StatelessWidget {
  const _ActionTile({required this.icon, required this.color, required this.bg, required this.title, required this.subtitle, required this.onTap});
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
            children: [
              Icon(icon, color: color, size: 24),
              const SizedBox(height: 8),
              Text(title, style: TextStyle(fontWeight: FontWeight.w700, fontSize: 13.5, color: color)),
              const SizedBox(height: 2),
              Text(subtitle, style: TextStyle(fontSize: 11, color: color.withOpacity(0.8))),
            ],
          ),
        ),
      ),
    );
  }
}

class _RequestEntry {
  final String kind; // 'absence' | 'event'
  final String title;
  final String status;
  final DateTime? at;
  _RequestEntry({required this.kind, required this.title, required this.status, required this.at});
}

class _RequestHistoryList extends StatelessWidget {
  const _RequestHistoryList();

  @override
  Widget build(BuildContext context) {
    final uid = FirebaseAuth.instance.currentUser!.uid;
    final absenceQuery = FirebaseFirestore.instance.collection('absenceRequests').where('userId', isEqualTo: uid);
    final eventQuery = FirebaseFirestore.instance.collection('eventRequests').where('requestedBy', isEqualTo: uid);

    return StreamBuilder<QuerySnapshot<Map<String, dynamic>>>(
      stream: absenceQuery.snapshots(),
      builder: (context, absenceSnap) {
        return StreamBuilder<QuerySnapshot<Map<String, dynamic>>>(
          stream: eventQuery.snapshots(),
          builder: (context, eventSnap) {
            if (absenceSnap.connectionState == ConnectionState.waiting || eventSnap.connectionState == ConnectionState.waiting) {
              return const Padding(
                padding: EdgeInsets.symmetric(vertical: 20),
                child: Center(child: CircularProgressIndicator()),
              );
            }

            final entries = <_RequestEntry>[
              ...?absenceSnap.data?.docs.map((d) {
                final data = d.data();
                return _RequestEntry(
                  kind: 'absence',
                  title: 'Absence request',
                  status: data['status'] as String? ?? 'pending',
                  at: (data['requestedAt'] as Timestamp?)?.toDate(),
                );
              }),
              ...?eventSnap.data?.docs.map((d) {
                final data = d.data();
                return _RequestEntry(
                  kind: 'event',
                  title: data['proposedTitle'] as String? ?? 'Event proposal',
                  status: data['status'] as String? ?? 'pending',
                  at: (data['createdAt'] as Timestamp?)?.toDate(),
                );
              }),
            ]..sort((a, b) => (b.at ?? DateTime(0)).compareTo(a.at ?? DateTime(0)));

            if (entries.isEmpty) {
              return Container(
                width: double.infinity,
                padding: const EdgeInsets.all(20),
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(14),
                  border: Border.all(color: const Color(0xFFE7E1CE)),
                ),
                child: const Center(child: Text('No requests yet.', style: TextStyle(color: Color(0xFF64748B)))),
              );
            }

            return Column(
              children: entries.map((e) => Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: _RequestRow(entry: e),
              )).toList(),
            );
          },
        );
      },
    );
  }
}

class _RequestRow extends StatelessWidget {
  const _RequestRow({required this.entry});
  final _RequestEntry entry;

  @override
  Widget build(BuildContext context) {
    final statusColor = switch (entry.status) {
      'approved' => const Color(0xFF16A34A),
      'rejected' => const Color(0xFFDC2626),
      _ => const Color(0xFFD97706),
    };
    final statusBg = switch (entry.status) {
      'approved' => const Color(0xFFDFF5E5),
      'rejected' => const Color(0xFFFCE1E6),
      _ => const Color(0xFFFDECD1),
    };

    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: const Color(0xFFE7E1CE)),
      ),
      child: Row(
        children: [
          Icon(
            entry.kind == 'absence' ? Icons.event_busy_rounded : Icons.event_repeat_rounded,
            color: AppColors.brandGreen,
            size: 20,
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(entry.title, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13.5)),
                if (entry.at != null)
                  Text(
                    '${entry.at!.day}/${entry.at!.month}/${entry.at!.year}',
                    style: const TextStyle(fontSize: 11, color: Color(0xFF64748B)),
                  ),
              ],
            ),
          ),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
            decoration: BoxDecoration(color: statusBg, borderRadius: BorderRadius.circular(999)),
            child: Text(entry.status, style: TextStyle(fontSize: 10.5, fontWeight: FontWeight.w700, color: statusColor)),
          ),
        ],
      ),
    );
  }
}
