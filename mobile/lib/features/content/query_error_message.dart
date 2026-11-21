import 'package:flutter/material.dart';

/// Dropped into any StreamBuilder/FutureBuilder's `snap.hasError` branch.
/// Firestore's "missing composite index" error includes a direct link
/// to auto-create it in the console — swallowing that error (the
/// previous pattern of `snap.data?.docs ?? []`, which quietly renders
/// as "no data" on any failure) hid that link along with the problem.
/// This is deliberately compact, not a full-screen error state, since
/// it's meant to sit inside small widgets (a stat card, a hero) as
/// easily as a full list screen.
class QueryErrorMessage extends StatelessWidget {
  const QueryErrorMessage({super.key, required this.error, this.compact = false});
  final Object? error;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final text = error?.toString() ?? 'Something went wrong loading this.';

    if (compact) {
      return Row(
        children: [
          Icon(Icons.error_outline_rounded, color: scheme.error, size: 16),
          const SizedBox(width: 6),
          Expanded(
            child: Text(text, style: TextStyle(color: scheme.error, fontSize: 11.5), maxLines: 3, overflow: TextOverflow.ellipsis),
          ),
        ],
      );
    }

    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.error_outline_rounded, color: scheme.error, size: 36),
            const SizedBox(height: 10),
            SelectableText(text, textAlign: TextAlign.center, style: TextStyle(color: scheme.error, fontSize: 12.5)),
          ],
        ),
      ),
    );
  }
}
