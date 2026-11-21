import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';
import 'org_settings_service.dart';

/// Shown under the "Member ID and phone don't match" error — the most
/// common real cause is the member's phone number changed since the
/// admin uploaded their record, which isn't something they can fix
/// themselves. Always shows the plain contact text (guaranteed to work,
/// copy-pasteable) in addition to a tap-to-launch button, since I
/// couldn't verify mailto:/tel: intent launching on a real device
/// without a Flutter build environment — the plain text is the
/// fallback that can't break.
class ContactAdminCard extends StatelessWidget {
  const ContactAdminCard({super.key, required this.contact});

  final OrgSupportContact contact;

  Future<void> _launch(String url) async {
    final uri = Uri.parse(url);
    if (await canLaunchUrl(uri)) {
      await launchUrl(uri);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (!contact.hasAny) {
      return Padding(
        padding: const EdgeInsets.only(top: 8),
        child: Text(
          'Contact your organization\'s admin to have your phone number updated on file.',
          style: Theme.of(context).textTheme.bodySmall,
        ),
      );
    }

    return Container(
      margin: const EdgeInsets.only(top: 12),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surfaceContainerHighest.withOpacity(0.5),
        borderRadius: BorderRadius.circular(10),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'This usually means your phone number changed since your admin added you. Contact them to update it:',
            style: Theme.of(context).textTheme.bodySmall,
          ),
          const SizedBox(height: 8),
          if (contact.email != null && contact.email!.isNotEmpty)
            InkWell(
              onTap: () => _launch('mailto:${contact.email}'),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Icon(Icons.email_outlined, size: 16),
                  const SizedBox(width: 6),
                  Text(contact.email!, style: Theme.of(context).textTheme.bodyMedium),
                ],
              ),
            ),
          if (contact.phone != null && contact.phone!.isNotEmpty) ...[
            const SizedBox(height: 6),
            InkWell(
              onTap: () => _launch('tel:${contact.phone}'),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Icon(Icons.call_outlined, size: 16),
                  const SizedBox(width: 6),
                  Text(contact.phone!, style: Theme.of(context).textTheme.bodyMedium),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }
}
