import 'package:cloud_functions/cloud_functions.dart';
import 'package:firebase_auth/firebase_auth.dart';

/// Wraps the two-step Twilio OTP flow (blueprint §5 — "Login using the
/// agreed OTP flow"). Both steps are Cloud Functions calls
/// (firebase/functions/src/modules/auth/otp.ts) — this class never talks
/// to Twilio directly and never sees a Twilio credential.
class AuthService {
  final _functions = FirebaseFunctions.instance;

  Future<void> sendOtp(String phoneE164) async {
    final callable = _functions.httpsCallable('sendOtp');
    await callable.call({'phone': phoneE164});
  }

  /// Login only — see firebase/functions/src/modules/auth/otp.ts
  /// verifyOtp for why this never creates a new account. First-time
  /// registration is a separate flow (registration_screen.dart).
  Future<void> verifyOtpAndSignIn(String phoneE164, String code) async {
    final callable = _functions.httpsCallable('verifyOtp');
    final result = await callable.call({'phone': phoneE164, 'code': code});
    final data = Map<String, dynamic>.from(result.data as Map);
    final customToken = data['customToken'] as String;
    await FirebaseAuth.instance.signInWithCustomToken(customToken);
  }
}
