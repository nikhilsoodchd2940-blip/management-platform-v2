import 'package:flutter/material.dart';
import '../chat/chat_screen.dart';
import '../requests/propose_event_screen.dart';
import 'group_events_screen.dart';
import 'group_members_sheet.dart';

class GroupDetailScreen extends StatelessWidget {
  final String groupId;
  final String groupName;

  const GroupDetailScreen({super.key, required this.groupId, required this.groupName});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(groupName)),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          _GroupHero(groupId: groupId, groupName: groupName),
          const SizedBox(height: 20),
          const Text('What would you like to do?', style: TextStyle(fontSize: 15, fontWeight: FontWeight.w700)),
          const SizedBox(height: 10),
          _ActionTile(
            icon: Icons.chat_bubble_rounded,
            color: const Color(0xFF2563EB),
            bg: const Color(0xFFE3EBFF),
            title: 'Group chat',
            subtitle: 'Message everyone in this group',
            onTap: () => Navigator.of(context).push(
              MaterialPageRoute(builder: (_) => ChatScreen(groupId: groupId, groupName: groupName)),
            ),
          ),
          const SizedBox(height: 10),
          _ActionTile(
            icon: Icons.event_note_rounded,
            color: const Color(0xFF16A34A),
            bg: const Color(0xFFDFF5E5),
            title: 'Group events',
            subtitle: 'Events organized by this group specifically',
            onTap: () => Navigator.of(context).push(
              MaterialPageRoute(builder: (_) => GroupEventsScreen(groupId: groupId, groupName: groupName)),
            ),
          ),
          const SizedBox(height: 10),
          _ActionTile(
            icon: Icons.event_repeat_rounded,
            color: const Color(0xFF7C3AED),
            bg: const Color(0xFFEEE3FF),
            title: 'Propose an event',
            subtitle: 'Ask an admin to schedule something new',
            onTap: () => Navigator.of(context).push(
              MaterialPageRoute(builder: (_) => ProposeEventScreen(groupId: groupId, groupName: groupName)),
            ),
          ),
          const SizedBox(height: 10),
          _ActionTile(
            icon: Icons.groups_rounded,
            color: const Color(0xFFD97706),
            bg: const Color(0xFFFDECD1),
            title: 'Members',
            subtitle: 'See who else is in this group',
            onTap: () => showGroupMembersSheet(context, groupId: groupId),
          ),
        ],
      ),
    );
  }
}

/// The colored hero at the top of a group's detail screen — group name,
/// a group-icon avatar, and a live member count.
class _GroupHero extends StatelessWidget {
  const _GroupHero({required this.groupId, required this.groupName});
  final String groupId;
  final String groupName;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: [scheme.primary, scheme.primary.withOpacity(0.75)],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        borderRadius: BorderRadius.circular(20),
      ),
      child: Row(
        children: [
          Container(
            width: 52,
            height: 52,
            decoration: BoxDecoration(
              color: Colors.white.withOpacity(0.2),
              borderRadius: BorderRadius.circular(14),
            ),
            child: const Icon(Icons.groups_rounded, color: Colors.white, size: 28),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  groupName,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.w700),
                ),
                const SizedBox(height: 4),
                GroupMemberCountLabel(groupId: groupId, style: TextStyle(color: Colors.white.withOpacity(0.85), fontSize: 13)),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _ActionTile extends StatelessWidget {
  const _ActionTile({
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
          child: Row(
            children: [
              Container(
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(
                  color: Colors.white.withOpacity(0.6),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Icon(icon, color: color, size: 22),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(title, style: TextStyle(fontWeight: FontWeight.w700, fontSize: 15, color: color)),
                    const SizedBox(height: 2),
                    Text(subtitle, style: TextStyle(fontSize: 12, color: color.withOpacity(0.8))),
                  ],
                ),
              ),
              Icon(Icons.chevron_right, color: color.withOpacity(0.7)),
            ],
          ),
        ),
      ),
    );
  }
}
