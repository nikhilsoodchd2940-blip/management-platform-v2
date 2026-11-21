import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import '../../core/app_colors.dart';

/// The branded HIZBUT-TARQIYYAH member badge: the member's photo,
/// masked to a circle, with the approved gold-ring medallion frame
/// (curved title, stars, curved subtitle) layered on top.
///
/// This is the member's profile identity everywhere in the app — the
/// drawer header, the home top bar, the profile screen, and anywhere
/// else a "profile picture" is shown. There should never be a screen
/// that falls back to a plain cropped-circle avatar; if the photo is
/// missing, the badge still renders with the member's initial in the
/// center, so the frame is always present.
///
/// [size] is the outer diameter of the whole badge (frame included).
/// The inner photo circle is sized at the frame's hole proportion
/// (the ratio measured directly from the source medallion artwork —
/// hole radius ÷ outer radius) so it sits flush under the ring with
/// no gap or overlap at any size.
class MemberBadge extends StatelessWidget {
  const MemberBadge({
    super.key,
    required this.size,
    required this.initial,
    this.photoUrl,
    this.ringWidth,
  });

  final double size;
  final String initial;
  final String? photoUrl;

  /// Fallback ring thickness used only if the medallion frame asset
  /// fails to load (e.g. not bundled). Defaults to a proportion of
  /// [size] so the fallback still looks reasonable at any scale.
  final double? ringWidth;

  /// Hole diameter ÷ frame diameter, measured from the source
  /// medallion artwork (hole radius 243px ÷ outer radius 435px).
  static const double _holeRatio = 243 / 435;

  @override
  Widget build(BuildContext context) {
    final photoSize = size * _holeRatio;

    return SizedBox(
      width: size,
      height: size,
      child: Stack(
        alignment: Alignment.center,
        children: [
          ClipOval(
            child: Container(
              width: photoSize,
              height: photoSize,
              color: AppColors.deepEmerald,
              alignment: Alignment.center,
              child: (photoUrl != null && photoUrl!.isNotEmpty)
                  ? CachedNetworkImage(
                      imageUrl: photoUrl!,
                      width: photoSize,
                      height: photoSize,
                      fit: BoxFit.cover,
                      errorWidget: (context, url, error) => _InitialText(initial: initial, size: photoSize),
                    )
                  : _InitialText(initial: initial, size: photoSize),
            ),
          ),
          IgnorePointer(
            child: Image.asset(
              'assets/images/member_medallion_frame.png',
              width: size,
              height: size,
              fit: BoxFit.contain,
              errorBuilder: (context, error, stack) => Container(
                width: photoSize,
                height: photoSize,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  border: Border.all(color: AppColors.richGold, width: ringWidth ?? size * 0.019),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _InitialText extends StatelessWidget {
  const _InitialText({required this.initial, required this.size});
  final String initial;
  final double size;

  @override
  Widget build(BuildContext context) {
    return Text(
      initial,
      style: TextStyle(fontSize: size * 0.35, fontWeight: FontWeight.w700, color: Colors.white),
    );
  }
}
