import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// The mobile app's only source of truth for "who is signed in and what
/// role do they have". Role comes from the ID token's custom claims (set
/// only by Cloud Functions — see firebase/functions/src/modules/auth) and
/// is re-read on every auth state change so a stale cached role can never
/// linger after an admin changes someone's access.
class SessionState {
  final User? user;
  final String? role; // 'admin' | 'host' | 'member' | null
  final List<String> hostGroupIds;
  final bool loading;
  final bool needsOnboarding;
  final String? registrationStatus; // 'not_registered' | 'pending_approval' | 'approved' | 'rejected' | null
  final String? rejectionReason; // set only when registrationStatus == 'rejected' — shown on PendingApprovalScreen

  const SessionState({
    required this.user,
    required this.role,
    required this.hostGroupIds,
    required this.loading,
    required this.needsOnboarding,
    required this.registrationStatus,
    required this.rejectionReason,
  });

  static const initial = SessionState(
    user: null,
    role: null,
    hostGroupIds: [],
    loading: true,
    needsOnboarding: false,
    registrationStatus: null,
    rejectionReason: null,
  );

  bool get isSignedIn => user != null;
  bool get isHost => role == 'host';
  // Signed in via plain phone login (verifyOtp) before ever finishing
  // the Member ID + photo registration flow — see
  // features/auth/registration_screen.dart. Routed to a "finish
  // registration" screen rather than treated as a normal member.
  bool get needsRegistrationCompletion => registrationStatus == 'not_registered';
  bool get isPendingApproval => registrationStatus == 'pending_approval';
  bool get isRejected => registrationStatus == 'rejected';
}

class SessionNotifier extends StateNotifier<SessionState> {
  SessionNotifier() : super(SessionState.initial) {
    FirebaseAuth.instance.authStateChanges().listen((user) => _onAuthChanged(user));
  }

  Future<void> _onAuthChanged(User? user, {bool forceTokenRefresh = false}) async {
    if (user == null) {
      state = const SessionState(
        user: null,
        role: null,
        hostGroupIds: [],
        loading: false,
        needsOnboarding: false,
        registrationStatus: null,
        rejectionReason: null,
      );
      return;
    }
    // Token result and the Firestore profile read are independent — kick
    // both off before awaiting either, so startup only pays for
    // whichever is slower, not the sum of both.
    final tokenFuture = user.getIdTokenResult(forceTokenRefresh);
    final profileFuture = _fetchProfile(user.uid);
    final tokenResult = await tokenFuture;
    final profile = await profileFuture;
    final claims = tokenResult.claims ?? {};

    // A brand-new user (verifyOtp creates users/{uid} with displayName:
    // '') has nothing to identify themselves by beyond a phone number —
    // an admin can't meaningfully assign them to a group. Checked here
    // (not just once right after sign-up) so it also catches someone who
    // closed the app mid-onboarding and comes back later; it clears
    // itself the moment a name is saved, via refresh() below.
    //
    // profile == null covers both "not fetched yet" (Firestore hasn't
    // created the doc) and "the read itself failed" (caught above) —
    // either way, don't trap someone on a screen they can't get past;
    // treat it as "nothing to onboard" and let them in. They can still
    // fill in their name from Profile later.
    final displayName = (profile?.data()?['displayName'] as String?)?.trim() ?? '';
    final needsOnboarding = profile != null && displayName.isEmpty;
    final registrationStatus = profile?.data()?['registrationStatus'] as String?;
    final rejectionReason = profile?.data()?['rejectionReason'] as String?;

    state = SessionState(
      user: user,
      role: claims['role'] as String?,
      hostGroupIds: (claims['hostGroupIds'] as List?)?.cast<String>() ?? const [],
      loading: false,
      needsOnboarding: needsOnboarding,
      registrationStatus: registrationStatus,
      rejectionReason: rejectionReason,
    );
  }

  Future<DocumentSnapshot<Map<String, dynamic>>?> _fetchProfile(String uid) async {
    try {
      return await FirebaseFirestore.instance.collection('users').doc(uid).get();
    } catch (e) {
      debugPrint('[session] onboarding check failed: $e');
      // Don't let a transient read failure trap someone on a screen they
      // can't get past — null is treated as "nothing to onboard" below.
      return null;
    }
  }

  /// Call after an operation that changes claims or profile data
  /// server-side (e.g. right after verifyOtp signs the user in for the
  /// first time, or after the onboarding screen saves a name) so the UI
  /// doesn't wait for the next natural auth-state event. This is the one
  /// path that still forces a real token refresh — normal startup
  /// (_onAuthChanged from the authStateChanges listener) does not.
  Future<void> refresh() async {
    final user = FirebaseAuth.instance.currentUser;
    if (user != null) await _onAuthChanged(user, forceTokenRefresh: true);
  }
}

final sessionProvider = StateNotifierProvider<SessionNotifier, SessionState>(
  (ref) => SessionNotifier(),
);
