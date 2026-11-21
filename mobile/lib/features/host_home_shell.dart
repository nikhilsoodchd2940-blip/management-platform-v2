import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'host/host_home_screen.dart';

class HostHomeShell extends StatelessWidget {
  const HostHomeShell({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Your Groups'),
        actions: [
          IconButton(
            icon: const Icon(Icons.logout),
            onPressed: () => FirebaseAuth.instance.signOut(),
          ),
        ],
      ),
      body: const HostHomeScreen(),
    );
  }
}
