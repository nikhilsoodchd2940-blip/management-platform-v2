import { ns } from '../types';

export default ns({
  title: 'Pending approvals',
  phoneRequestsTitle: 'Phone number change requests',
  phoneRequestsHelp:
    "Sent from the app when a person's member ID and phone number no longer match — approving updates their number directly, so they can sign up or sign in with it right away.",
  colMemberId: 'Member ID',
  colRequestedPhone: 'Requested phone',
  colNote: 'Note',
  approve: 'Approve',
  reject: 'Reject',
  intro:
    'Members who signed up in the app and are waiting for a decision. Check their kurels below before approving or rejecting.',
  nothingPending: 'Nothing waiting for review right now.',
  noName: '(no name)',
  clickToEnlarge: 'Click to enlarge',
  memberIdLabel: 'Member ID:',
  phoneLabel: 'Phone:',
  emailLabel: 'Email:',
  registeredKurels: 'REGISTERED KURELS',
  multiKurels: '(linked to several kurels)',
  noKurel: 'No kurel linked.',
  roleHost: 'Host',
  roleMember: 'Member',
  photoAlt: 'Profile photo, full size',
  rejectPrompt:
    "Reason for rejecting this registration (visible to the member in the app). Leave empty to give none.",
  updateRequestFailed: 'Could not update this request',
  updateRegistrationFailed: 'Could not update this registration',
});
