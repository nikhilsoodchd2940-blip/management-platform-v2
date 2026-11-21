import { ns } from '../types';

export default ns({
  title: 'Announcements & notifications',
  intro:
    "Sent straight to members' Notifications screen and bell badge on the mobile app — real-time, not a push notification (no separate push infrastructure exists yet).",
  historyTitle: 'Send history',
  historyEmpty: 'Nothing sent yet — use the form to send your first announcement.',
  colTitle: 'Title',
  colTarget: 'Target',
  colRecipients: 'Recipients',
  colSent: 'Sent',
  allMembers: 'All members',
  groupWord: 'Group',
  sendTitle: 'Send an announcement',
  titleLabel: 'Title',
  titlePlaceholder: 'Announcement title',
  messageLabel: 'Message',
  sendTo: 'Send to',
  oneGroup: 'One group',
  groupLabel: 'Group',
  selectGroup: 'Select a group…',
  send: 'Send announcement',
  sending: 'Sending…',
  chooseGroup: 'Choose a group to target, or switch to "All members".',
  sentTo: (n: number) => `Sent to ${n} member${n === 1 ? '' : 's'}.`,
  sendFailed: 'Could not send this announcement',
});
