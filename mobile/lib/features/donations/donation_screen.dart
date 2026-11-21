import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/material.dart';
import 'package:flutter_stripe/flutter_stripe.dart';

/// Card entry happens entirely inside Stripe's own Payment Sheet — this
/// screen never sees or handles raw card data (blueprint §7,
/// docs/INTEGRATIONS.md). createDonationIntent creates the PaymentIntent
/// and a `donations` doc with status='pending'; ONLY the stripeWebhook
/// Cloud Function ever moves it to 'succeeded'/'failed'. A successful
/// presentPaymentSheet() here is a UX signal ("thanks!") only — it does
/// not itself confirm the donation.
class DonationScreen extends StatefulWidget {
  final String? groupId;
  final String? eventId;

  const DonationScreen({super.key, this.groupId, this.eventId});

  @override
  State<DonationScreen> createState() => _DonationScreenState();
}

class _DonationScreenState extends State<DonationScreen> {
  static const _presetAmounts = [1000, 2500, 5000, 10000]; // cents
  int _selectedCents = 2500;
  bool _processing = false;
  String? _error;
  String? _successMessage;

  Future<void> _donate() async {
    setState(() {
      _processing = true;
      _error = null;
      _successMessage = null;
    });
    try {
      final callable = FirebaseFunctions.instance.httpsCallable('createDonationIntent');
      final result = await callable.call({
        'amountCents': _selectedCents,
        'currency': 'usd',
        if (widget.groupId != null) 'groupId': widget.groupId,
        if (widget.eventId != null) 'eventId': widget.eventId,
      });
      final data = Map<String, dynamic>.from(result.data as Map);
      final clientSecret = data['clientSecret'] as String;

      await Stripe.instance.initPaymentSheet(
        paymentSheetParameters: SetupPaymentSheetParameters(
          paymentIntentClientSecret: clientSecret,
          merchantDisplayName: 'Management Platform',
        ),
      );
      await Stripe.instance.presentPaymentSheet();

      setState(() {
        _successMessage = 'Thank you! Your donation is being processed.';
      });
    } on StripeException catch (e) {
      setState(() => _error = e.error.localizedMessage ?? 'Payment was not completed.');
    } catch (e) {
      setState(() => _error = 'Could not start the donation. Try again.');
    } finally {
      if (mounted) setState(() => _processing = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Donate')),
      body: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Text('Choose an amount'),
            const SizedBox(height: 12),
            Wrap(
              spacing: 10,
              children: _presetAmounts.map((cents) {
                final selected = cents == _selectedCents;
                return ChoiceChip(
                  label: Text('\$${(cents / 100).toStringAsFixed(0)}'),
                  selected: selected,
                  onSelected: (_) => setState(() => _selectedCents = cents),
                );
              }).toList(),
            ),
            if (_error != null) ...[
              const SizedBox(height: 16),
              Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
            ],
            if (_successMessage != null) ...[
              const SizedBox(height: 16),
              Text(_successMessage!, style: const TextStyle(color: Colors.green)),
            ],
            const SizedBox(height: 24),
            FilledButton(
              onPressed: _processing ? null : _donate,
              child: Text(_processing ? 'Please wait…' : 'Donate \$${(_selectedCents / 100).toStringAsFixed(0)}'),
            ),
          ],
        ),
      ),
    );
  }
}
