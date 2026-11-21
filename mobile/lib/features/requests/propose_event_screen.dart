import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/material.dart';

/// Member proposes an event for a Sub Group they belong to (blueprint
/// §7). This calls submitEventRequest — it does NOT create a real event;
/// an Admin reviews it and, if approved, creates the actual event
/// separately (see firebase/functions/src/modules/requests/eventRequests.ts).
class ProposeEventScreen extends StatefulWidget {
  final String groupId;
  final String groupName;

  const ProposeEventScreen({super.key, required this.groupId, required this.groupName});

  @override
  State<ProposeEventScreen> createState() => _ProposeEventScreenState();
}

class _ProposeEventScreenState extends State<ProposeEventScreen> {
  final _titleController = TextEditingController();
  final _notesController = TextEditingController();
  DateTime _start = DateTime.now().add(const Duration(days: 1));
  DateTime _end = DateTime.now().add(const Duration(days: 1, hours: 1));
  bool _submitting = false;
  String? _error;

  Future<void> _pickDateTime({required bool isStart}) async {
    final initial = isStart ? _start : _end;
    final date = await showDatePicker(
      context: context,
      initialDate: initial,
      firstDate: DateTime.now(),
      lastDate: DateTime.now().add(const Duration(days: 365)),
    );
    if (date == null || !mounted) return;
    final time = await showTimePicker(context: context, initialTime: TimeOfDay.fromDateTime(initial));
    if (time == null) return;
    final combined = DateTime(date.year, date.month, date.day, time.hour, time.minute);
    setState(() {
      if (isStart) {
        _start = combined;
      } else {
        _end = combined;
      }
    });
  }

  Future<void> _submit() async {
    if (_titleController.text.trim().isEmpty) {
      setState(() => _error = 'Enter a title');
      return;
    }
    if (!_end.isAfter(_start)) {
      setState(() => _error = 'End time must be after start time');
      return;
    }
    setState(() {
      _submitting = true;
      _error = null;
    });
    try {
      final callable = FirebaseFunctions.instance.httpsCallable('submitEventRequest');
      await callable.call({
        'groupId': widget.groupId,
        'proposedTitle': _titleController.text.trim(),
        'proposedStartAtMs': _start.millisecondsSinceEpoch,
        'proposedEndAtMs': _end.millisecondsSinceEpoch,
        'notes': _notesController.text.trim(),
      });
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Sent to the organizers for review.')),
        );
        Navigator.of(context).pop();
      }
    } catch (e) {
      setState(() => _error = 'Could not submit. Try again.');
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text('Propose event · ${widget.groupName}')),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          TextField(
            controller: _titleController,
            decoration: const InputDecoration(labelText: 'Title', border: OutlineInputBorder()),
          ),
          const SizedBox(height: 16),
          ListTile(
            contentPadding: EdgeInsets.zero,
            title: const Text('Starts'),
            subtitle: Text(_start.toLocal().toString()),
            trailing: const Icon(Icons.edit_calendar_outlined),
            onTap: () => _pickDateTime(isStart: true),
          ),
          ListTile(
            contentPadding: EdgeInsets.zero,
            title: const Text('Ends'),
            subtitle: Text(_end.toLocal().toString()),
            trailing: const Icon(Icons.edit_calendar_outlined),
            onTap: () => _pickDateTime(isStart: false),
          ),
          const SizedBox(height: 16),
          TextField(
            controller: _notesController,
            maxLines: 3,
            decoration: const InputDecoration(labelText: 'Notes (optional)', border: OutlineInputBorder()),
          ),
          if (_error != null) ...[
            const SizedBox(height: 12),
            Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
          ],
          const SizedBox(height: 20),
          FilledButton(
            onPressed: _submitting ? null : _submit,
            child: Text(_submitting ? 'Sending…' : 'Send for review'),
          ),
        ],
      ),
    );
  }
}
