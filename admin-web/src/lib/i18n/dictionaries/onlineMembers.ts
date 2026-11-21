import { ns } from '../types';

export default ns({
  title: 'Members online',
  subtitle: 'Members who were active in the app during the last 5 minutes.',
  statOnline: 'Online now',
  empty: 'Nobody is online right now.',
  emptyHint: 'This list is built from each member’s “last seen” time, which the mobile app records while it is open.',
  colName: 'Member',
  colPhone: 'Phone',
  colLastSeen: 'Last seen',
  justNow: 'just now',
  minutesAgo: (n: number) => `${n} min ago`,
  noName: '(no name)',
});
