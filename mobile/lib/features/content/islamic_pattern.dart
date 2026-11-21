import 'dart:math' as math;
import 'package:flutter/material.dart';

/// A tiled Islamic geometric star pattern for emerald UI surfaces
/// (header, drawer, bottom nav) — never used over the mosque photograph
/// itself, which stays clean and sharp as its own photographic content.
///
/// This draws a classic 8-pointed star (najma) tessellation with a
/// CustomPainter rather than an image asset, so it's crisp at any
/// resolution/density and has no bundle-size cost. `opacity` defaults
/// low (0.06) so it reads as texture, not decoration competing with the
/// content sitting on top of it.
class IslamicPatternBackground extends StatelessWidget {
  const IslamicPatternBackground({
    super.key,
    this.color = Colors.white,
    this.opacity = 0.1,
    this.tileSize = 56,
    this.child,
  });

  final Color color;
  final double opacity;
  final double tileSize;
  final Widget? child;

  @override
  Widget build(BuildContext context) {
    return CustomPaint(
      painter: _IslamicPatternPainter(color: color.withOpacity(opacity), tileSize: tileSize),
      child: child,
    );
  }
}

class _IslamicPatternPainter extends CustomPainter {
  _IslamicPatternPainter({required this.color, required this.tileSize});
  final Color color;
  final double tileSize;

  @override
  void paint(Canvas canvas, Size size) {
    final stroke = Paint()
      ..color = color
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.3;

    final cols = (size.width / tileSize).ceil() + 1;
    final rows = (size.height / tileSize).ceil() + 1;

    for (var row = -1; row < rows; row++) {
      for (var col = -1; col < cols; col++) {
        final cx = col * tileSize + (row.isOdd ? tileSize / 2 : 0);
        final cy = row * tileSize * 0.87; // 0.87 ≈ sqrt(3)/2, packs the stars into a triangular grid
        _drawStarTile(canvas, Offset(cx, cy), tileSize, stroke);
      }
    }
  }

  /// One 8-pointed star built from two overlapping squares (the
  /// standard construction for a najma tile), plus its surrounding
  /// interlocking frame — the repeating unit of most Islamic geometric
  /// tessellations.
  void _drawStarTile(Canvas canvas, Offset center, double size, Paint paint) {
    final r = size * 0.42;

    Path star = Path();
    for (var i = 0; i < 8; i++) {
      final angle = (i * 45) * math.pi / 180;
      final point = Offset(center.dx + r * _cos(angle), center.dy + r * _sin(angle));
      if (i == 0) {
        star.moveTo(point.dx, point.dy);
      } else {
        star.lineTo(point.dx, point.dy);
      }
    }
    star.close();
    canvas.drawPath(star, paint);

    // Inner rotated square (the classic "two squares" najma construction).
    final innerR = r * 0.62;
    Path innerSquare = Path();
    for (var i = 0; i < 4; i++) {
      final angle = (i * 90 + 45) * math.pi / 180;
      final point = Offset(center.dx + innerR * _cos(angle), center.dy + innerR * _sin(angle));
      if (i == 0) {
        innerSquare.moveTo(point.dx, point.dy);
      } else {
        innerSquare.lineTo(point.dx, point.dy);
      }
    }
    innerSquare.close();
    canvas.drawPath(innerSquare, paint);

    // Connecting frame lines to neighboring tiles — what makes it read
    // as a continuous interlocking lattice rather than isolated stars.
    for (var i = 0; i < 8; i++) {
      final angle = (i * 45) * math.pi / 180;
      final outer = Offset(center.dx + (size * 0.5) * _cos(angle), center.dy + (size * 0.5) * _sin(angle));
      final inner = Offset(center.dx + r * _cos(angle), center.dy + r * _sin(angle));
      canvas.drawLine(inner, outer, paint);
    }
  }

  double _cos(double radians) => math.cos(radians);
  double _sin(double radians) => math.sin(radians);

  @override
  bool shouldRepaint(covariant _IslamicPatternPainter oldDelegate) =>
      oldDelegate.color != color || oldDelegate.tileSize != tileSize;
}
