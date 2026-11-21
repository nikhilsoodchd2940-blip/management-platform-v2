import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:firebase_auth/firebase_auth.dart';
import '../../core/session.dart';
import 'complete_registration_screen.dart';

/// Shown while registrationStatus is 'pending_approval' (waiting on an
/// Admin — see admin-web Members "Pending approvals") or 'rejected'.
/// Nothing else in the app is reachable in either state — see
/// core/session_gate.dart.
class PendingApprovalScreen extends ConsumerWidget {
  const PendingApprovalScreen({super.key, required this.rejected, this.rejectionReason});

  final bool rejected;
  final String? rejectionReason;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: Padding(
            padding: const EdgeInsets.all(28),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(
                  rejected ? Icons.cancel_outlined : Icons.hourglass_top_rounded,
                  size: 48,
                  color: rejected ? Theme.of(context).colorScheme.error : Theme.of(context).colorScheme.primary,
                ),
                const SizedBox(height: 16),
                Text(
                  rejected ? 'Registration not approved' : 'Waiting for approval',
                  textAlign: TextAlign.center,
                  style: Theme.of(context).textTheme.headlineSmall,
                ),
                const SizedBox(height: 8),
                Text(
                  rejected
                      ? 'Your registration was not approved. Contact your organization\'s admin if you think this is a mistake.'
                      : 'Your registration is with your organization\'s admin for review. You\'ll be able to use the app once it\'s approved.',
                  textAlign: TextAlign.center,
                  style: Theme.of(context).textTheme.bodyMedium,
                ),
                if (rejected && rejectionReason != null && rejectionReason!.trim().isNotEmpty) ...[
                  const SizedBox(height: 12),
                  Container(
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: Theme.of(context).colorScheme.errorContainer.withOpacity(0.4),
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: Text(
                      'Reason: $rejectionReason',
                      textAlign: TextAlign.center,
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                  ),
                ],
                const SizedBox(height: 24),
                if (rejected)
                  FilledButton(
                    onPressed: () => Navigator.of(context).push(
                      MaterialPageRoute(builder: (_) => const CompleteRegistrationScreen()),
                    ),
                    child: const Text('Try again with a new photo'),
                  )
                else
                  OutlinedButton(
                    onPressed: () => ref.read(sessionProvider.notifier).refresh(),
                    child: const Text('Check again'),
                  ),
                const SizedBox(height: 12),
                TextButton(
                  onPressed: () => FirebaseAuth.instance.signOut(),
                  child: const Text('Sign out'),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
