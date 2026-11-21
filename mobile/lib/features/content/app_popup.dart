import 'package:cached_network_image/cached_network_image.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

/// Fetches the single highest-priority (lowest `order`) active popup —
/// admin-managed from the web panel's Popups page (see
/// firebase/functions/src/modules/content/content.ts) — and shows it as
/// a modal dialog. Call this once from a shell's initState; it's a
/// one-shot check (not a live stream), matching "shown on app open"
/// rather than something that reappears mid-session if an admin
/// activates one while the member is already using the app.
Future<void> maybeShowAppPopup(BuildContext context) async {
  QuerySnapshot<Map<String, dynamic>> snap;
  try {
    snap = await FirebaseFirestore.instance
        .collection('popups')
        .where('active', isEqualTo: true)
        .orderBy('order')
        .limit(1)
        .get();
  } catch (_) {
    return; // best-effort — a failed fetch here shouldn't block app usage
  }
  if (snap.docs.isEmpty || !context.mounted) return;

  final data = snap.docs.first.data();
  final title = data['title'] as String? ?? '';
  final description = data['description'] as String?;
  final imageUrl = data['imageUrl'] as String?;
  final linkUrl = data['linkUrl'] as String?;

  showDialog(
    context: context,
    builder: (context) => Dialog(
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (imageUrl != null && imageUrl.isNotEmpty)
            ClipRRect(
              borderRadius: const BorderRadius.vertical(top: Radius.circular(20)),
              child: CachedNetworkImage(
                imageUrl: imageUrl,
                width: double.infinity,
                height: 160,
                fit: BoxFit.cover,
                errorWidget: (context, url, error) => const SizedBox.shrink(),
              ),
            ),
          Padding(
            padding: const EdgeInsets.all(20),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(title, style: Theme.of(context).textTheme.titleLarge, textAlign: TextAlign.center),
                if (description != null && description.isNotEmpty) ...[
                  const SizedBox(height: 8),
                  Text(description, style: Theme.of(context).textTheme.bodyMedium, textAlign: TextAlign.center),
                ],
                const SizedBox(height: 20),
                if (linkUrl != null && linkUrl.isNotEmpty)
                  FilledButton(
                    onPressed: () async {
                      final uri = Uri.tryParse(linkUrl);
                      if (uri != null && await canLaunchUrl(uri)) {
                        await launchUrl(uri, mode: LaunchMode.externalApplication);
                      }
                      if (context.mounted) Navigator.of(context).pop();
                    },
                    child: const Text('Learn more'),
                  ),
                TextButton(
                  onPressed: () => Navigator.of(context).pop(),
                  child: const Text('Dismiss'),
                ),
              ],
            ),
          ),
        ],
      ),
    ),
  );
}
