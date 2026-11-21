import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/material.dart';

/// Shows a reason prompt and calls submitAbsenceRequest (blueprint §7).
/// Returns true if the request was sent, so the caller can show feedback.
Future<bool> showRequestAbsenceDialog(BuildContext context, {required String eventId}) async {
  final controller = TextEditingController();
  final sent = await showDialog<bool>(
    context: context,
    builder: (context) {
      bool submitting = false;
      String? error;
      return StatefulBuilder(
        builder: (context, setState) => AlertDialog(
          title: const Text('Request absence'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              TextField(
                controller: controller,
                maxLines: 3,
                decoration: const InputDecoration(labelText: 'Reason', border: OutlineInputBorder()),
              ),
              if (error != null) ...[
                const SizedBox(height: 8),
                Text(error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
              ],
            ],
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
            FilledButton(
              onPressed: submitting
                  ? null
                  : () async {
                      final reason = controller.text.trim();
                      if (reason.isEmpty) {
                        setState(() => error = 'Enter a reason');
                        return;
                      }
                      setState(() {
                        submitting = true;
                        error = null;
                      });
                      try {
                        final callable = FirebaseFunctions.instance.httpsCallable('submitAbsenceRequest');
                        await callable.call({'eventId': eventId, 'reason': reason});
                        if (context.mounted) Navigator.pop(context, true);
                      } catch (e) {
                        setState(() {
                          submitting = false;
                          error = 'Could not submit. Try again.';
                        });
                      }
                    },
              child: Text(submitting ? 'Sending…' : 'Submit'),
            ),
          ],
        ),
      );
    },
  );
  return sent ?? false;
}
