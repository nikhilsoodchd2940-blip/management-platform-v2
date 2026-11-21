import 'package:cloud_firestore/cloud_firestore.dart';

class OrgSupportContact {
  final String? email;
  final String? phone;

  const OrgSupportContact({this.email, this.phone});

  bool get hasAny => (email != null && email!.isNotEmpty) || (phone != null && phone!.isNotEmpty);
}

/// Reads orgSettings/default — deliberately public in firestore.rules
/// (no auth required) so this works on the registration screen BEFORE
/// anyone has a Firebase Auth session, which is exactly when the
/// "Member ID and phone don't match" error can leave someone stuck.
class OrgSettingsService {
  Future<OrgSupportContact> fetchSupportContact() async {
    try {
      final snap = await FirebaseFirestore.instance.collection('orgSettings').doc('default').get();
      final data = snap.data();
      if (data == null) return const OrgSupportContact();
      return OrgSupportContact(
        email: (data['supportEmail'] as String?)?.trim(),
        phone: (data['supportPhone'] as String?)?.trim(),
      );
    } catch (_) {
      // Best-effort — if this fails for any reason, the caller just
      // shows the error without a contact option instead of crashing
      // the registration flow over it.
      return const OrgSupportContact();
    }
  }
}
