import 'package:flutter/material.dart';
import '../../core/app_colors.dart';

/// Used for drawer destinations that don't have a real feature behind
/// them yet (Mon agenda, Programme pédagogique, Mes évaluations,
/// Répertoire, Dossier disciplinaire, Langue/Language — see the
/// conversation's scoping notes for the full list and why). Shows this
/// instead of either a broken screen or fabricated placeholder data —
/// the person opening it should immediately understand this is a real
/// gap, not a bug.
class ComingSoonScreen extends StatelessWidget {
  const ComingSoonScreen({super.key, required this.title, this.description});
  final String title;
  final String? description;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(title)),
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(32),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 72,
                height: 72,
                decoration: BoxDecoration(
                  color: AppColors.brandGreen.withOpacity(0.08),
                  shape: BoxShape.circle,
                ),
                alignment: Alignment.center,
                child: const Icon(Icons.hourglass_top_rounded, color: AppColors.brandGreen, size: 32),
              ),
              const SizedBox(height: 18),
              Text(
                'Coming soon',
                style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700, color: AppColors.brandGreenDark),
              ),
              const SizedBox(height: 8),
              Text(
                description ?? '$title isn\'t available yet — it\'s on the roadmap.',
                textAlign: TextAlign.center,
                style: const TextStyle(fontSize: 13.5, color: Color(0xFF64748B), height: 1.4),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
