import { ns } from '../types';

export default ns({
  title: 'Permissions',
  onlySuperAdmin:
    "Only a super-admin can manage other admins' access. Contact your organization's super-admin if you need a change here.",
  intro:
    'Every admin already has full system access. This only narrows which sections of this dashboard they see — it is not a security boundary on its own.',
  userIdLabel: "Admin's user ID",
  userIdPlaceholder: 'Paste a user ID from the Members page',
  editingAccessFor: 'Editing access for',
  superAdmin: "Super-admin (unrestricted, can manage other admins' permissions)",
  saveFailed: 'Could not save',
  labels: {
    groups: 'Groups',
    members: 'Members',
    events: 'Events',
    requests: 'Requests',
    donations: 'Donations',
    reports: 'Reports',
    content: 'Content',
    integrations: 'Integrations',
    logistics: 'Logistics',
  },
});
