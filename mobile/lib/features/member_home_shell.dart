import 'package:flutter/material.dart';
import 'package:firebase_auth/firebase_auth.dart';
import '../core/app_colors.dart';
import 'groups/my_groups_screen.dart';
import 'events/my_events_screen.dart';
import 'qr/my_qr_screen.dart';
import 'requests/requests_hub_screen.dart';
import 'notifications/notifications_screen.dart';
import 'profile/profile_screen.dart';
import 'profile/edit_profile_screen.dart';
import 'donations/donation_screen.dart';
import 'content/banner_carousel.dart';
import 'content/app_popup.dart';
import 'content/home_top_bar.dart';
import 'content/home_dashboard.dart';
import 'content/member_drawer_header.dart';
import 'content/premium_bottom_nav.dart';
import 'content/islamic_pattern.dart';
import 'content/coming_soon_screen.dart';
import 'auth/org_settings_service.dart';
import 'auth/contact_admin_card.dart';

/// The Member app's shell — bottom nav matches the approved reference
/// exactly (Home / Calendar / Attendance / Requests / Notifications),
/// which reassigns a few things that used to be bottom-nav tabs
/// (Groups, My QR-as-such, Profile) into the drawer instead, alongside
/// nine more drawer destinations from the approved menu. Several of
/// those drawer destinations don't have a real feature behind them yet
/// (see ComingSoonScreen's own note and the conversation's scoping
/// summary) — they're wired to an honest "coming soon" screen rather
/// than removed from the menu or backed by fabricated data.
class MemberHomeShell extends StatefulWidget {
  const MemberHomeShell({super.key});

  @override
  State<MemberHomeShell> createState() => _MemberHomeShellState();
}

class _MemberHomeShellState extends State<MemberHomeShell> {
  int _index = 0;

  late final _screens = [
    _HomeTab(onNavigateTab: _goToTab),
    const MyEventsScreen(),
    const MyQrScreen(),
    const RequestsHubScreen(),
    const NotificationsScreen(),
  ];

  static const _titles = ['Home', 'Calendar', 'Attendance', 'Requests', 'Notifications'];

  static const _navItems = [
    PremiumNavItem(icon: Icons.home_outlined, activeIcon: Icons.home_rounded, label: 'Home'),
    PremiumNavItem(icon: Icons.calendar_month_outlined, activeIcon: Icons.calendar_month_rounded, label: 'Calendar'),
    PremiumNavItem(icon: Icons.qr_code_2_rounded, activeIcon: Icons.qr_code_2_rounded, label: 'Attendance'),
    PremiumNavItem(icon: Icons.assignment_outlined, activeIcon: Icons.assignment_rounded, label: 'Requests'),
    PremiumNavItem(icon: Icons.notifications_outlined, activeIcon: Icons.notifications_rounded, label: 'Notifications', showNotificationBadge: true),
  ];

  void _goToTab(int i) => setState(() => _index = i);

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) maybeShowAppPopup(context);
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.softIvory,
      // The Home tab supplies its own top bar (HomeTopBar, inside
      // _HomeTab) so it can carry the pattern + branding treatment;
      // every other tab keeps a plain AppBar with a title.
      appBar: _index == 0 ? null : AppBar(title: Text(_titles[_index])),
      drawer: const _AppDrawer(),
      body: SafeArea(top: _index != 0, child: _screens[_index]),
      bottomNavigationBar: PremiumBottomNav(items: _navItems, selectedIndex: _index, onSelect: _goToTab),
    );
  }
}

class _HomeTab extends StatelessWidget {
  const _HomeTab({required this.onNavigateTab});
  final void Function(int index) onNavigateTab;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        const HomeTopBar(),
        const BannerCarousel(),
        Expanded(child: HomeDashboard(onNavigateTab: onNavigateTab)),
      ],
    );
  }
}

class _DrawerDestination {
  const _DrawerDestination({required this.icon, required this.label, required this.builder});
  final IconData icon;
  final String label;
  final WidgetBuilder builder;
}

/// Wraps a "tab content only" screen (ProfileScreen, MyGroupsScreen,
/// MyEventsScreen, NotificationsScreen, RequestsHubScreen — built with
/// no Scaffold of their own, since they used to live inside the shell's
/// Scaffold as bottom-nav tabs) with a real Scaffold + AppBar so pushing
/// them directly from the drawer has an actual Material surface and
/// background color. Without this, the pushed route had nothing behind
/// it — which is exactly what showed up as a black screen. Screens that
/// already have their own Scaffold (EditProfileScreen, ComingSoonScreen,
/// DonationScreen) are NOT passed through this — double-wrapping them
/// would just produce a redundant second AppBar.
Widget _wrapped(String title, Widget child) {
  return Scaffold(
    backgroundColor: AppColors.softIvory,
    appBar: AppBar(title: Text(title)),
    body: child,
  );
}

class _AppDrawer extends StatelessWidget {
  const _AppDrawer();

  static final _destinations = <_DrawerDestination>[
    _DrawerDestination(icon: Icons.person_rounded, label: 'Mon profil', builder: (_) => _wrapped('Mon profil', const ProfileScreen())),
    _DrawerDestination(icon: Icons.groups_rounded, label: 'Kurel(s)', builder: (_) => _wrapped('Kurel(s)', const MyGroupsScreen())),
    _DrawerDestination(
      icon: Icons.event_note_rounded,
      label: 'Mon agenda',
      builder: (_) => const ComingSoonScreen(title: 'Mon agenda'),
    ),
    _DrawerDestination(
      icon: Icons.fact_check_rounded,
      label: 'Présences et absences',
      builder: (_) => _wrapped('Présences et absences', const MyEventsScreen()),
    ),
    _DrawerDestination(
      icon: Icons.school_rounded,
      label: 'Programme pédagogique',
      builder: (_) => const ComingSoonScreen(title: 'Programme pédagogique'),
    ),
    _DrawerDestination(
      icon: Icons.grade_rounded,
      label: 'Mes évaluations',
      builder: (_) => const ComingSoonScreen(title: 'Mes évaluations'),
    ),
    _DrawerDestination(
      icon: Icons.campaign_rounded,
      label: 'Événements et convocations',
      builder: (_) => _wrapped('Événements et convocations', const MyEventsScreen()),
    ),
    _DrawerDestination(
      icon: Icons.support_agent_rounded,
      label: 'Mes demandes sociales',
      builder: (_) => _wrapped('Mes demandes sociales', const RequestsHubScreen()),
    ),
    _DrawerDestination(icon: Icons.payments_rounded, label: 'Finance', builder: (_) => const DonationScreen()),
    _DrawerDestination(
      icon: Icons.notifications_rounded,
      label: 'Annonces et notifications',
      builder: (_) => _wrapped('Annonces et notifications', const NotificationsScreen()),
    ),
    _DrawerDestination(
      icon: Icons.contacts_rounded,
      label: 'Répertoire',
      builder: (_) => const ComingSoonScreen(title: 'Répertoire'),
    ),
    _DrawerDestination(
      icon: Icons.folder_rounded,
      label: 'Dossier disciplinaire',
      builder: (_) => const ComingSoonScreen(title: 'Dossier disciplinaire'),
    ),
    _DrawerDestination(icon: Icons.settings_rounded, label: 'Paramètres et sécurité', builder: (_) => const EditProfileScreen()),
    _DrawerDestination(
      icon: Icons.language_rounded,
      label: 'Langue / Language',
      builder: (_) => const ComingSoonScreen(title: 'Langue / Language', description: 'Only French is available right now.'),
    ),
  ];

  Future<void> _showContactAdminSheet(BuildContext context) async {
    final contact = await OrgSettingsService().fetchSupportContact();
    if (!context.mounted) return;
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (context) => Padding(
        padding: EdgeInsets.only(
          left: 20,
          right: 20,
          top: 20,
          bottom: MediaQuery.of(context).viewInsets.bottom + 20,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text('Contact your admin', style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 8),
            ContactAdminCard(contact: contact),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Drawer(
      backgroundColor: AppColors.veryDarkEmerald,
      width: 300,
      child: Container(
        decoration: const BoxDecoration(
          gradient: LinearGradient(
            colors: [AppColors.veryDarkEmerald, AppColors.deepEmerald],
            begin: Alignment.topCenter,
            end: Alignment.bottomCenter,
          ),
        ),
        child: IslamicPatternBackground(
          color: AppColors.richGold,
          opacity: 0.09,
          child: SafeArea(
            child: Column(
              children: [
                const Padding(
                  padding: EdgeInsets.fromLTRB(16, 8, 16, 4),
                  child: Align(
                    alignment: Alignment.centerLeft,
                    child: Text(
                      'ESPACE MEMBRE',
                      style: TextStyle(color: AppColors.richGold, fontSize: 12, fontWeight: FontWeight.w700, letterSpacing: 1.2),
                    ),
                  ),
                ),
                // Fixed profile header, per the approved reference —
                // only the menu list below scrolls.
                const Padding(
                  padding: EdgeInsets.fromLTRB(16, 8, 16, 16),
                  child: MemberDrawerHeader(),
                ),
                Container(height: 1, margin: const EdgeInsets.symmetric(horizontal: 16), color: AppColors.richGold.withOpacity(0.25)),
                Expanded(
                  child: ListView(
                    padding: EdgeInsets.zero,
                    children: [
                      const SizedBox(height: 8),
                      ..._destinations.map((d) => ListTile(
                            leading: Icon(d.icon, color: AppColors.richGold, size: 21),
                            title: Text(d.label, style: const TextStyle(color: AppColors.warmCream, fontSize: 14, fontWeight: FontWeight.w500)),
                            trailing: Icon(Icons.chevron_right_rounded, color: AppColors.warmCream.withOpacity(0.4), size: 18),
                            onTap: () {
                              Navigator.of(context).pop();
                              Navigator.of(context).push(MaterialPageRoute(builder: d.builder));
                            },
                          )),
                      Container(height: 1, margin: const EdgeInsets.symmetric(horizontal: 16), color: AppColors.richGold.withOpacity(0.25)),
                      ListTile(
                        leading: const Icon(Icons.help_outline_rounded, color: AppColors.richGold, size: 21),
                        title: const Text('Contact admin', style: TextStyle(color: AppColors.warmCream, fontSize: 14, fontWeight: FontWeight.w500)),
                        onTap: () {
                          Navigator.of(context).pop();
                          _showContactAdminSheet(context);
                        },
                      ),
                      ListTile(
                        leading: const Icon(Icons.logout_rounded, color: Color(0xFFE57373), size: 21),
                        title: const Text('Sign out', style: TextStyle(color: Color(0xFFE57373), fontSize: 14, fontWeight: FontWeight.w600)),
                        onTap: () {
                          Navigator.of(context).pop();
                          FirebaseAuth.instance.signOut();
                        },
                      ),
                      const SizedBox(height: 16),
                      // The approved reference's mosque photo, anchored
                      // at the bottom of the drawer — the last thing you
                      // scroll to, not a fixed background (the drawer
                      // must stay scrollable per spec, and this image is
                      // tall enough that pinning it behind the menu
                      // would mean either cropping it badly or covering
                      // the lower menu items).
                      ClipRRect(
                        borderRadius: const BorderRadius.vertical(top: Radius.circular(18)),
                        child: Image.asset(
                          'assets/images/drawer_footer_mosque.png',
                          width: double.infinity,
                          fit: BoxFit.cover,
                          // Was SizedBox.shrink() on error — a silently
                          // vanishing image and "the asset didn't load"
                          // look identical from the outside, which is
                          // exactly the ambiguity that made this hard to
                          // diagnose. If this box of text is visible,
                          // the asset genuinely isn't bundled — check
                          // pubspec.yaml's assets: list and that `flutter
                          // pub get` ran after it changed.
                          errorBuilder: (context, error, stack) => Container(
                            height: 120,
                            alignment: Alignment.center,
                            color: AppColors.veryDarkEmerald,
                            child: Text(
                              'Image failed to load:\n$error',
                              textAlign: TextAlign.center,
                              style: TextStyle(color: AppColors.warmCream.withOpacity(0.6), fontSize: 10),
                            ),
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
