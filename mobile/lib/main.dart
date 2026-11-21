import 'dart:async';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_app_check/firebase_app_check.dart';
import 'package:firebase_crashlytics/firebase_crashlytics.dart';
import 'package:flutter_stripe/flutter_stripe.dart';

// Generated per environment (dev/staging/prod) via `flutterfire configure`.
// Not committed with real values — see docs/ENVIRONMENT.md. This import
// will fail to resolve until that file is generated locally; that's
// intentional (nothing in this sandbox has run it end to end — see the
// docs/PHASEn_COMPLETION.md reports).
import 'core/app_colors.dart';
import 'core/firebase_options.dart';
import 'core/session_gate.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // Guard against [core/duplicate-app]: on Android, the Google Services
  // Gradle plugin can auto-initialize a "[DEFAULT]" Firebase app natively
  // (from google-services.json) before or during this Dart code running —
  // typically right after regenerating google-services.json/
  // firebase_options.dart via `flutterfire configure` for a new project.
  // Checking `Firebase.apps.isEmpty` first isn't reliable here (it's a
  // race: the native app can finish registering between the check and
  // the call), so instead we just attempt initializeApp() and swallow
  // the specific 'duplicate-app' error — any other failure still throws
  // normally.
  try {
    await Firebase.initializeApp(options: DefaultFirebaseOptions.currentPlatform);
  } on FirebaseException catch (e) {
    if (e.code != 'duplicate-app') rethrow;
  }

  // Crashlytics (Phase 5 — "crash reporting" from the original Phase 0
  // requirements list). Routes both Flutter framework errors and
  // uncaught async/platform errors; does nothing further to configure —
  // Crashlytics just needs to be enabled for this app in the Firebase
  // Console for reports to show up there. Synchronous — just wiring up
  // handlers, nothing to wait on.
  FlutterError.onError = FirebaseCrashlytics.instance.recordFlutterFatalError;
  PlatformDispatcher.instance.onError = (error, stack) {
    FirebaseCrashlytics.instance.recordError(error, stack, fatal: true);
    return true;
  };

  // App Check and Stripe setup used to be awaited here too, meaning
  // nothing rendered — not even the loading spinner on SessionGate,
  // since runApp() hadn't been called yet — until both finished. App
  // Check activation in particular can be a real network round trip
  // (attestation providers in release, a token exchange even for the
  // debug provider). Neither needs to block first paint: App Check's
  // first actual use is sendOtp, which only fires when the person
  // submits the phone-number form on OtpLoginScreen — by then this has
  // had seconds, not milliseconds, to finish in the background. Stripe
  // similarly isn't touched until DonationScreen, several screens and
  // an auth flow away from app launch. runApp() now starts as soon as
  // Firebase itself (which the very first frame's SessionGate does
  // depend on, via FirebaseAuth.instance.authStateChanges()) is ready.
  unawaited(_activateAppCheck());
  unawaited(_setUpStripe());

  debugPrint('[main] Firebase ready, calling runApp()');
  runApp(const ProviderScope(child: ManagementPlatformApp()));
}

// App Check (Phase 5) — the debug provider only works with a debug
// token registered for this exact app instance in the Firebase Console
// (Console prints the token to the device log on first run in debug
// mode; paste it in). Release builds use the real attestation
// providers, which require no manual per-device step but DO require
// Play Integrity (Android) / App Attest (iOS) to be enabled for this
// app in the Firebase Console first — see docs/LAUNCH_CHECKLIST.md.
// Several callables now set enforceAppCheck: true (checkIn, sendOtp,
// verifyOtp, assignRole, setAdminPermissions, createDonationIntent) —
// until this activation succeeds against a properly configured
// project, those calls will be rejected.
Future<void> _activateAppCheck() async {
  try {
    await FirebaseAppCheck.instance.activate(
      androidProvider: kDebugMode ? AndroidProvider.debug : AndroidProvider.playIntegrity,
      appleProvider: kDebugMode ? AppleProvider.debug : AppleProvider.appAttest,
    );
  } catch (e) {
    // Not awaited by main() anymore, so a failure here can't crash
    // startup — but it also can't silently vanish, since every
    // App-Check-enforced callable would otherwise fail with a
    // confusing "unauthenticated"-shaped error with no obvious cause.
    debugPrint('[main] App Check activation failed: $e');
  }
}

// Stripe publishable key is safe to ship in the client bundle (unlike
// the secret key, which only ever lives in Cloud Functions secrets —
// see docs/ENVIRONMENT.md), but is still not hard-coded here: pass it
// at build time, e.g.
//   flutter run --dart-define=STRIPE_PUBLISHABLE_KEY=pk_test_...
Future<void> _setUpStripe() async {
  const stripePublishableKey = String.fromEnvironment('STRIPE_PUBLISHABLE_KEY');
  if (stripePublishableKey.isEmpty) return;
  try {
    Stripe.publishableKey = stripePublishableKey;
    await Stripe.instance.applySettings();
  } catch (e) {
    debugPrint('[main] Stripe setup failed: $e');
  }
}


class ManagementPlatformApp extends StatelessWidget {
  const ManagementPlatformApp({super.key});

  @override
  Widget build(BuildContext context) {
    // A single deep-green seed drives every color in the app (buttons,
    // switches, borders, hero gradients via colorScheme.primary, etc.)
    // — the overrides below just tune a few components (inputs, buttons,
    // app bar, nav bar) so the green/gold/cream look is consistent
    // everywhere instead of Material 3's slightly tinted surfaces by
    // default. Matches the admin panel's own palette (see AppColors).
    final colorScheme = ColorScheme.fromSeed(
      seedColor: AppColors.brandGreen,
      brightness: Brightness.light,
    ).copyWith(
      surface: Colors.white,
      primary: AppColors.brandGreen,
      secondary: AppColors.brandGold,
    );

    return MaterialApp(
      title: 'Management Platform',
      theme: ThemeData(
        useMaterial3: true,
        colorScheme: colorScheme,
        scaffoldBackgroundColor: AppColors.brandCream,
        appBarTheme: const AppBarTheme(
          backgroundColor: AppColors.brandCream,
          foregroundColor: AppColors.brandGreenDark,
          elevation: 0,
          scrolledUnderElevation: 1,
          centerTitle: false,
          titleTextStyle: TextStyle(
            color: AppColors.brandGreenDark,
            fontSize: 20,
            fontWeight: FontWeight.w600,
          ),
        ),
        textTheme: const TextTheme(
          headlineSmall: TextStyle(fontWeight: FontWeight.w700, color: AppColors.brandGreenDark),
          titleLarge: TextStyle(fontWeight: FontWeight.w700, color: AppColors.brandGreenDark),
          titleMedium: TextStyle(fontWeight: FontWeight.w600, color: AppColors.brandGreenDark),
          bodyMedium: TextStyle(color: Color(0xFF475569), height: 1.4),
          bodyLarge: TextStyle(color: Color(0xFF0F172A)),
          labelMedium: TextStyle(color: Color(0xFF64748B), fontWeight: FontWeight.w600),
        ),
        inputDecorationTheme: InputDecorationTheme(
          filled: true,
          fillColor: const Color(0xFFF4F1E6),
          contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
          border: OutlineInputBorder(
            borderRadius: BorderRadius.circular(14),
            borderSide: BorderSide.none,
          ),
          enabledBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(14),
            borderSide: BorderSide.none,
          ),
          focusedBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(14),
            borderSide: const BorderSide(color: AppColors.brandGreen, width: 1.6),
          ),
          errorBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(14),
            borderSide: BorderSide(color: colorScheme.error, width: 1.4),
          ),
          labelStyle: const TextStyle(color: Color(0xFF64748B)),
        ),
        filledButtonTheme: FilledButtonThemeData(
          style: FilledButton.styleFrom(
            backgroundColor: AppColors.brandGreen,
            foregroundColor: Colors.white,
            minimumSize: const Size.fromHeight(52),
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
            textStyle: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
          ),
        ),
        outlinedButtonTheme: OutlinedButtonThemeData(
          style: OutlinedButton.styleFrom(
            foregroundColor: AppColors.brandGreen,
            side: const BorderSide(color: Color(0x66115C43)),
            minimumSize: const Size.fromHeight(52),
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
            textStyle: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
          ),
        ),
        textButtonTheme: TextButtonThemeData(
          style: TextButton.styleFrom(foregroundColor: AppColors.brandGreen),
        ),
        switchTheme: SwitchThemeData(
          thumbColor: MaterialStateProperty.resolveWith(
            (states) => states.contains(MaterialState.selected) ? AppColors.brandGold : null,
          ),
          trackColor: MaterialStateProperty.resolveWith(
            (states) => states.contains(MaterialState.selected) ? AppColors.brandGold.withOpacity(0.4) : null,
          ),
        ),
        cardTheme: CardThemeData(
          elevation: 0,
          color: Colors.white,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(18),
            side: const BorderSide(color: Color(0xFFE7E1CE)),
          ),
        ),
        dividerTheme: const DividerThemeData(color: Color(0xFFE7E1CE)),
        // Matches the admin panel's sidebar: dark green bar, a gold pill
        // behind the active tab with dark-green icon/label for contrast
        // on gold, and cream/white (not grey) for inactive tabs so it
        // reads as "dimmed on dark green" rather than a generic
        // Material grey state.
        navigationBarTheme: NavigationBarThemeData(
          backgroundColor: AppColors.brandGreenDark,
          elevation: 3,
          height: 66,
          indicatorColor: AppColors.brandGold,
          indicatorShape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
          iconTheme: MaterialStateProperty.resolveWith(
            (states) => IconThemeData(
              size: 24,
              color: states.contains(MaterialState.selected) ? AppColors.brandGreenDark : Colors.white70,
            ),
          ),
          labelTextStyle: MaterialStateProperty.resolveWith(
            (states) => TextStyle(
              fontSize: 11.5,
              fontWeight: states.contains(MaterialState.selected) ? FontWeight.w700 : FontWeight.w500,
              color: states.contains(MaterialState.selected) ? AppColors.brandGreenDark : Colors.white70,
            ),
          ),
        ),
      ),
      home: const SessionGate(),
    );
  }
}