import 'package:flutter/material.dart';

/// The Direction du Conservatoire brand palette — client-approved,
/// exact hex values (see the reference mockup this matches). Most of
/// the app reads brand color via `Theme.of(context).colorScheme` (set
/// from `brandGreen` as the seed in main.dart) rather than these
/// constants directly, so a hero gradient or a button doesn't need to
/// import this file at all. This file exists for the handful of spots
/// that need a *specific* brand color the derived ColorScheme has no
/// slot for — most notably gold, which Material 3's ColorScheme has no
/// dedicated role for.
class AppColors {
  AppColors._();

  static const deepEmerald = Color(0xFF063F2A);
  static const darkEmerald = Color(0xFF032B1D);
  static const veryDarkEmerald = Color(0xFF021C13);
  static const richGold = Color(0xFFD4AF37);
  static const lightGold = Color(0xFFF2D27A);
  static const warmCream = Color(0xFFFFF8E7);
  static const softIvory = Color(0xFFFCFAF3);

  // Kept as aliases to the names used throughout the rest of the app
  // (written before the exact client palette was supplied) so existing
  // references don't all need renaming — same colors, just the
  // approved hex values now instead of earlier approximations.
  static const brandGreenDark = veryDarkEmerald;
  static const brandGreen = deepEmerald;
  static const brandGold = richGold;
  static const brandGoldLight = lightGold;
  static const brandCream = warmCream;
}
