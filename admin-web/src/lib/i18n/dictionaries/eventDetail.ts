import { ns } from '../types';

export default ns({
  geofence: (m: number) => `${m} m geofence`,
  checkedIn: 'checked in',
  noAttendees: 'No attendees yet — publish the event to populate the list from current group membership.',
  colName: 'Name',
  colPhone: 'Phone',
  colStatus: 'Status',
  present: 'Present',
  notCheckedIn: 'Not checked in',
});
