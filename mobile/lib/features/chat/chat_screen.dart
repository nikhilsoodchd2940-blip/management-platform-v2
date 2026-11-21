import 'dart:io';
import 'package:cached_network_image/cached_network_image.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_storage/firebase_storage.dart';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import '../content/query_error_message.dart';
import '../groups/group_members_sheet.dart';

/// One private room per Sub Group (blueprint §7). Messages are written
/// directly to Firestore, not through a Cloud Function — see
/// firestore.rules for why (no fraud/authorization stakes worth a
/// round-trip). The rule requires senderId == auth.uid, roomId ==
/// groupId, sentAt == request.time, and text and/or mediaUrl present.
///
/// Media (Phase 4): the image itself is uploaded straight to Storage at
/// chatMedia/{groupId}/{uid}/{fileName} — firebase/storage.rules enforces
/// the same active-member-or-host check as the message doc, using a
/// cross-service Firestore lookup so the two authorization surfaces can't
/// drift apart. Only after the upload succeeds does this screen write the
/// message doc with the resulting download URL.
///
/// Visual style matches the rest of the app's colorful, tinted-card
/// language: a gradient header (group icon + live member count, tappable
/// to open the roster), a tinted chat background instead of stark white,
/// day separators between message groups, small sender-name labels and
/// timestamps, and avatar-initial bubbles for incoming messages.
class ChatScreen extends StatefulWidget {
  final String groupId;
  final String groupName;

  const ChatScreen({super.key, required this.groupId, required this.groupName});

  @override
  State<ChatScreen> createState() => _ChatScreenState();
}

class _ChatScreenState extends State<ChatScreen> {
  final _controller = TextEditingController();
  bool _sending = false;

  // Sender-name lookup for the currently-visible message list. Loaded
  // once per group membership snapshot rather than per-message — a
  // 100-message page from a handful of members would otherwise mean
  // dozens of redundant per-bubble user-doc reads.
  Map<String, String> _memberNames = {};

  CollectionReference<Map<String, dynamic>> get _messages =>
      FirebaseFirestore.instance.collection('chatRooms').doc(widget.groupId).collection('messages');

  @override
  void initState() {
    super.initState();
    _loadMemberNames();
  }

  Future<void> _loadMemberNames() async {
    try {
      final memberships = await activeGroupMembershipsQuery(widget.groupId).get();
      final userIds = memberships.docs.map((d) => d.data()['userId'] as String).toSet().toList();
      if (userIds.isEmpty) return;

      final names = <String, String>{};
      for (var i = 0; i < userIds.length; i += 30) {
        final chunk = userIds.sublist(i, i + 30 > userIds.length ? userIds.length : i + 30);
        final snap = await FirebaseFirestore.instance
            .collection('users')
            .where(FieldPath.documentId, whereIn: chunk)
            .get();
        for (final d in snap.docs) {
          names[d.id] = d.data()['displayName'] as String? ?? 'Member';
        }
      }
      if (mounted) setState(() => _memberNames = names);
    } catch (e) {
      // Non-fatal — messages still render, just without a sender label
      // until this resolves (or forever, if it never does; the roster
      // sheet's own error state is the one that actually needs fixing).
      debugPrint('[chat] could not load member names: $e');
    }
  }

  Future<void> _sendText() async {
    final text = _controller.text.trim();
    if (text.isEmpty || _sending) return;
    setState(() => _sending = true);
    try {
      await _messages.add({
        'roomId': widget.groupId,
        'senderId': FirebaseAuth.instance.currentUser!.uid,
        'text': text,
        'sentAt': FieldValue.serverTimestamp(),
      });
      _controller.clear();
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  Future<void> _sendImage() async {
    final picker = ImagePicker();
    final picked = await picker.pickImage(source: ImageSource.gallery, imageQuality: 80);
    if (picked == null) return;

    setState(() => _sending = true);
    try {
      final uid = FirebaseAuth.instance.currentUser!.uid;
      final fileName = '${DateTime.now().millisecondsSinceEpoch}_${picked.name}';
      final storageRef = FirebaseStorage.instance.ref('chatMedia/${widget.groupId}/$uid/$fileName');

      await storageRef.putFile(File(picked.path));
      final downloadUrl = await storageRef.getDownloadURL();

      await _messages.add({
        'roomId': widget.groupId,
        'senderId': uid,
        'mediaUrl': downloadUrl,
        'mediaType': 'image',
        'mediaPath': storageRef.fullPath,
        'sentAt': FieldValue.serverTimestamp(),
      });
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Could not send image. Try again.')),
        );
      }
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final myUid = FirebaseAuth.instance.currentUser!.uid;
    final query = _messages.orderBy('sentAt', descending: true).limit(100);
    final scheme = Theme.of(context).colorScheme;

    return Scaffold(
      backgroundColor: const Color(0xFFF3F6FC),
      appBar: PreferredSize(
        preferredSize: const Size.fromHeight(64),
        child: Container(
          decoration: BoxDecoration(
            gradient: LinearGradient(
              colors: [scheme.primary, scheme.primary.withOpacity(0.8)],
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
            ),
          ),
          child: SafeArea(
            bottom: false,
            child: SizedBox(
              height: 64,
              child: Row(
                children: [
                  IconButton(
                    icon: const Icon(Icons.arrow_back_rounded, color: Colors.white),
                    onPressed: () => Navigator.of(context).pop(),
                  ),
                  Expanded(
                    child: InkWell(
                      onTap: () => showGroupMembersSheet(context, groupId: widget.groupId),
                      child: Row(
                        children: [
                          Container(
                            width: 36,
                            height: 36,
                            decoration: BoxDecoration(color: Colors.white.withOpacity(0.2), borderRadius: BorderRadius.circular(11)),
                            child: const Icon(Icons.groups_rounded, color: Colors.white, size: 20),
                          ),
                          const SizedBox(width: 10),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Text(
                                  widget.groupName,
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: const TextStyle(fontSize: 15.5, fontWeight: FontWeight.w700, color: Colors.white),
                                ),
                                GroupMemberCountLabel(
                                  groupId: widget.groupId,
                                  style: TextStyle(fontSize: 12, color: Colors.white.withOpacity(0.8)),
                                ),
                              ],
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                  IconButton(
                    icon: const Icon(Icons.groups_rounded, color: Colors.white),
                    tooltip: 'View members',
                    onPressed: () => showGroupMembersSheet(context, groupId: widget.groupId),
                  ),
                  const SizedBox(width: 4),
                ],
              ),
            ),
          ),
        ),
      ),
      body: Column(
        children: [
          Expanded(
            child: StreamBuilder<QuerySnapshot<Map<String, dynamic>>>(
              stream: query.snapshots(),
              builder: (context, snap) {
                if (snap.connectionState == ConnectionState.waiting) {
                  return const Center(child: CircularProgressIndicator());
                }
                if (snap.hasError) {
                  return QueryErrorMessage(error: snap.error);
                }
                final docs = snap.data?.docs ?? [];
                if (docs.isEmpty) {
                  return Center(
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(Icons.forum_outlined, size: 40, color: scheme.outline),
                        const SizedBox(height: 10),
                        const Text('No messages yet — say hello.'),
                      ],
                    ),
                  );
                }
                return ListView.builder(
                  reverse: true,
                  padding: const EdgeInsets.fromLTRB(12, 12, 12, 4),
                  itemCount: docs.length,
                  itemBuilder: (context, i) {
                    final data = docs[i].data();
                    final senderId = data['senderId'] as String?;
                    final isMe = senderId == myUid;
                    final mediaUrl = data['mediaType'] == 'image' ? data['mediaUrl'] as String? : null;
                    final text = data['text'] as String?;
                    final senderName = isMe ? null : (_memberNames[senderId] ?? 'Member');
                    final sentAt = (data['sentAt'] as Timestamp?)?.toDate();

                    // ListView is reversed (newest at the bottom, index 0
                    // is the newest), so "the message after this one in
                    // time" is at i - 1, and a day separator belongs
                    // *above* the first message of a new day.
                    final nextData = i > 0 ? docs[i - 1].data() : null;
                    final nextSentAt = (nextData?['sentAt'] as Timestamp?)?.toDate();
                    final showDaySeparator = sentAt != null && (nextSentAt == null || !_isSameDay(sentAt, nextSentAt));

                    return Column(
                      children: [
                        _MessageBubble(
                          isMe: isMe,
                          senderName: senderName,
                          text: text,
                          mediaUrl: mediaUrl,
                          sentAt: sentAt,
                        ),
                        if (showDaySeparator) _DaySeparator(date: sentAt!),
                      ],
                    );
                  },
                );
              },
            ),
          ),
          SafeArea(
            child: Padding(
              padding: const EdgeInsets.fromLTRB(10, 6, 10, 10),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  IconButton(
                    icon: Icon(Icons.image_rounded, color: scheme.primary),
                    onPressed: _sending ? null : _sendImage,
                    tooltip: 'Send a photo',
                  ),
                  Expanded(
                    child: Container(
                      constraints: const BoxConstraints(maxHeight: 120),
                      decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(24)),
                      child: TextField(
                        controller: _controller,
                        minLines: 1,
                        maxLines: 4,
                        decoration: const InputDecoration(
                          hintText: 'Message…',
                          border: InputBorder.none,
                          contentPadding: EdgeInsets.symmetric(horizontal: 18, vertical: 12),
                        ),
                        onSubmitted: (_) => _sendText(),
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Container(
                    decoration: BoxDecoration(shape: BoxShape.circle, color: scheme.primary),
                    child: IconButton(
                      icon: _sending
                          ? const SizedBox(
                              width: 18,
                              height: 18,
                              child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                            )
                          : const Icon(Icons.send_rounded, color: Colors.white),
                      onPressed: _sending ? null : _sendText,
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  bool _isSameDay(DateTime a, DateTime b) => a.year == b.year && a.month == b.month && a.day == b.day;
}

class _DaySeparator extends StatelessWidget {
  const _DaySeparator({required this.date});
  final DateTime date;

  String _label() {
    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day);
    final day = DateTime(date.year, date.month, date.day);
    final diff = today.difference(day).inDays;
    if (diff == 0) return 'Today';
    if (diff == 1) return 'Yesterday';
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return '${months[date.month - 1]} ${date.day}${date.year != now.year ? ', ${date.year}' : ''}';
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 12),
      child: Center(
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 5),
          decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(999)),
          child: Text(_label(), style: TextStyle(fontSize: 11.5, fontWeight: FontWeight.w600, color: Theme.of(context).colorScheme.onSurfaceVariant)),
        ),
      ),
    );
  }
}

class _MessageBubble extends StatelessWidget {
  const _MessageBubble({
    required this.isMe,
    required this.senderName,
    required this.text,
    required this.mediaUrl,
    required this.sentAt,
  });
  final bool isMe;
  final String? senderName;
  final String? text;
  final String? mediaUrl;
  final DateTime? sentAt;

  String _formatTime(DateTime d) {
    final hour = d.hour % 12 == 0 ? 12 : d.hour % 12;
    final minute = d.minute.toString().padLeft(2, '0');
    final period = d.hour >= 12 ? 'PM' : 'AM';
    return '$hour:$minute $period';
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final initial = (senderName != null && senderName!.isNotEmpty) ? senderName![0].toUpperCase() : '?';
    // Local copy so Dart can narrow String? -> String inside the
    // != null checks below — it can't do that narrowing on `mediaUrl`
    // directly since it's a public class field, not a local variable
    // (this is what the build error was pointing at).
    final mediaUrl = this.mediaUrl;

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Row(
        mainAxisAlignment: isMe ? MainAxisAlignment.end : MainAxisAlignment.start,
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          if (!isMe) ...[
            CircleAvatar(
              radius: 14,
              backgroundColor: scheme.primaryContainer,
              child: Text(initial, style: TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700, color: scheme.primary)),
            ),
            const SizedBox(width: 6),
          ],
          Flexible(
            child: Column(
              crossAxisAlignment: isMe ? CrossAxisAlignment.end : CrossAxisAlignment.start,
              children: [
                if (!isMe && senderName != null)
                  Padding(
                    padding: const EdgeInsets.only(left: 4, bottom: 2),
                    child: Text(senderName!, style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: scheme.primary)),
                  ),
                Container(
                  padding: EdgeInsets.all(mediaUrl != null ? 4 : 0),
                  constraints: BoxConstraints(maxWidth: MediaQuery.of(context).size.width * 0.7),
                  decoration: BoxDecoration(
                    color: isMe ? scheme.primary : Colors.white,
                    borderRadius: BorderRadius.only(
                      topLeft: const Radius.circular(16),
                      topRight: const Radius.circular(16),
                      bottomLeft: Radius.circular(isMe ? 16 : 4),
                      bottomRight: Radius.circular(isMe ? 4 : 16),
                    ),
                    boxShadow: [BoxShadow(color: Colors.black.withOpacity(0.04), blurRadius: 4, offset: const Offset(0, 1))],
                  ),
                  child: mediaUrl != null
                      ? ClipRRect(
                          borderRadius: BorderRadius.circular(12),
                          child: CachedNetworkImage(imageUrl: mediaUrl, fit: BoxFit.cover),
                        )
                      : Padding(
                          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                          child: Text(text ?? '', style: TextStyle(color: isMe ? Colors.white : Colors.black87)),
                        ),
                ),
                if (sentAt != null)
                  Padding(
                    padding: const EdgeInsets.only(top: 3, left: 4, right: 4),
                    child: Text(_formatTime(sentAt!), style: TextStyle(fontSize: 10, color: scheme.onSurfaceVariant)),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
