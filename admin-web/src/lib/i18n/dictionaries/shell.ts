import { ns } from '../types';

export default ns({
  openMenu: 'Open menu',
  closeMenu: 'Close menu',
  skipToContent: 'Skip to content',
  mainNav: 'Main navigation',
  dismiss: 'Dismiss notification',
  noAccessTitle: 'Access not allowed',
  noAccessText:
    "Your admin account doesn't have access to this section. Ask a super-admin to add it for you under Permissions.",
  backToDashboard: 'Back to dashboard',
  notAdminTitle: 'This space is for administrators',
  notAdminText:
    "You are signed in, but this account is a member account, and the admin panel is only for administrators. Members use the mobile app. If you should have admin access, ask a super admin to give your account an admin role, then sign in again.",
  permissionDenied:
    "The server refused access to some data. Your account may not have permission to view this section.",
  loadFailed: 'Some data could not be loaded. Check your connection and reload the page.',
  unavailable: 'Connection to the server was interrupted. Retrying…',
  statusLive: 'Live · Firebase',
  institution: 'Direction Conservatoire',
  profileRole: 'Administrator',
});
