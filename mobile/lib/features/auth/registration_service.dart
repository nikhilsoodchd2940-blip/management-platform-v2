import 'dart:io';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_storage/firebase_storage.dart';

/// Wraps the closed-registration Cloud Functions
/// (firebase/functions/src/modules/auth/registration.ts). Mirrors
/// AuthService's "never touch Twilio directly" shape — this class only
/// ever calls Functions/Storage, never a provider SDK.
class RegistrationService {
  final _functions = FirebaseFunctions.instance;

  /// Step 1: memberId + phone must match a pre-loaded Admin record.
  /// Throws (FirebaseFunctionsException) with a caller-safe message on
  /// any mismatch — surface err.message directly in the UI.
  Future<void> beginRegistration(String memberId, String phoneE164) async {
    final callable = _functions.httpsCallable('beginRegistration');
    await callable.call({'memberId': memberId, 'phone': phoneE164});
  }

  /// Step 2: verifies the OTP and signs in to the EXISTING
  /// Admin-provisioned Auth identity (no new account is ever created
  /// here). Returns once FirebaseAuth.instance.currentUser is set.
  Future<void> completeRegistrationOtp(String memberId, String phoneE164, String code) async {
    final callable = _functions.httpsCallable('completeRegistrationOtp');
    final result = await callable.call({'memberId': memberId, 'phone': phoneE164, 'code': code});
    final data = Map<String, dynamic>.from(result.data as Map);
    final customToken = data['customToken'] as String;
    await FirebaseAuth.instance.signInWithCustomToken(customToken);
  }

  /// Uploads the mandatory profile photo to
  /// `profilePhotos/{uid}/photo.jpg` (see firebase/storage.rules —
  /// only the signed-in owner can write their own path). Must be called
  /// AFTER completeRegistrationOtp/verifyOtp, since Storage rules check
  /// request.auth.uid.
  Future<String> uploadProfilePhoto(File file) async {
    final uid = FirebaseAuth.instance.currentUser!.uid;
    final ref = FirebaseStorage.instance.ref('profilePhotos/$uid/photo.jpg');
    await ref.putFile(file, SettableMetadata(contentType: 'image/jpeg'));
    return ref.getDownloadURL();
  }

  /// Step 3: records the photo (+ optional email) and moves the member
  /// to 'pending_approval'. Requires an authenticated session.
  Future<void> submitRegistration({required String photoUrl, String? email}) async {
    final callable = _functions.httpsCallable('submitRegistration');
    await callable.call({
      'photoUrl': photoUrl,
      if (email != null && email.trim().isNotEmpty) 'email': email.trim(),
    });
  }

  /// Self-service "my phone number changed" request — no session
  /// required (that's the whole problem: it can't match, so they can't
  /// get one). An Admin reviews it from the Approvals page; see
  /// firebase/functions/src/modules/members/phoneUpdateRequests.ts.
  Future<void> requestPhoneUpdate(String memberId, String requestedPhoneE164, {String? note}) async {
    final callable = _functions.httpsCallable('requestPhoneUpdate');
    await callable.call({
      'memberId': memberId,
      'requestedPhone': requestedPhoneE164,
      if (note != null && note.trim().isNotEmpty) 'note': note.trim(),
    });
  }
}
