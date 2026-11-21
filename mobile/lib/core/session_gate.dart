import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'session.dart';
import '../features/auth/otp_login_screen.dart';
import '../features/auth/onboarding_screen.dart';
import '../features/auth/complete_registration_screen.dart';
import '../features/auth/pending_approval_screen.dart';
import '../features/member_home_shell.dart';
import '../features/host_home_shell.dart';

/// Single branch point for the whole app: loading spinner while the
/// initial auth-state check runs, OTP login when signed out, then —
/// for a signed-in user — registration-completion / pending-approval /
/// rejected screens (closed registration, see
/// firebase/functions/src/modules/auth/registration.ts) each gated
/// ahead of the one-time name-onboarding screen, and then exactly one
/// of the two role shells. Admin is web-only (blueprint §5 /
/// docs/ARCHITECTURE.md §1), so an admin-only account signing into the
/// mobile app deliberately has nowhere to go — that's a configuration
/// mistake to catch, not a case to design around.
class SessionGate extends ConsumerWidget {
  const SessionGate({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final session = ref.watch(sessionProvider);

    if (session.loading) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }
    if (!session.isSignedIn) {
      return const OtpLoginScreen();
    }
    if (session.needsRegistrationCompletion) {
      return const CompleteRegistrationScreen();
    }
    if (session.isPendingApproval) {
      return const PendingApprovalScreen(rejected: false);
    }
    if (session.isRejected) {
      return PendingApprovalScreen(rejected: true, rejectionReason: session.rejectionReason);
    }
    if (session.needsOnboarding) {
      return const OnboardingScreen();
    }
    if (session.isHost) {
      return const HostHomeShell();
    }
    if (session.role == 'member') {
      return const MemberHomeShell();
    }
    // role == 'admin' or unset — not a valid mobile destination.
    return const Scaffold(
      body: Center(
        child: Padding(
          padding: EdgeInsets.all(24),
          child: Text(
            'This account isn\'t set up for the mobile app. Admins use the '
            'web dashboard — contact your organization if you think this is a mistake.',
            textAlign: TextAlign.center,
          ),
        ),
      ),
    );
  }
}
