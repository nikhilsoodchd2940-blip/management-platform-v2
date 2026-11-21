import { ns } from '../types';

export default ns({
  title: 'Popups',
  intro:
    "Shown as a window when a member opens the app. Only the highest-priority active popup is shown per visit — order them with the highest priority at the top (▲ moves one up).",
  allPopups: 'All popups',
  none: 'No popups yet — add one on the right.',
  active: 'Active',
  inactive: 'Inactive',
  deactivate: 'Deactivate',
  activate: 'Activate',
  delete: 'Delete',
  addTitle: 'Add a popup',
  titleLabel: 'Title',
  descriptionLabel: 'Description (optional)',
  imageLabel: 'Image (optional)',
  linkLabel: 'Link (optional)',
  submit: 'Add popup',
  saving: 'Saving…',
  titleRequired: 'Title is required',
  addFailed: 'Could not add the popup',
  updateFailed: 'Could not update the popup',
  reorderFailed: 'Could not reorder',
  deleteFailed: 'Could not delete the popup',
  confirmDelete: (title: string) => `Delete "${title}"? This cannot be undone.`,
});
