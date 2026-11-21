import { ns } from '../types';

export default ns({
  title: 'Help & guide',
  intro:
    'A quick overview of what each section of the admin panel does. The side menu is organized the same way as this page, so you can jump straight to what you need.',
  newHereLead: 'New here?',
  newHereBefore: 'Start with',
  newHereOrg: 'Organization',
  newHereOrgDetail: '(set up your Countries/Cities/Kurels), then',
  newHereMembers: 'Members',
  newHereMembersDetail: '(add your members). Everything else builds on these two foundations.',
  sections: [
    {
      title: 'Organization',
      items: [
        {
          name: 'Countries → Cities → Kurels',
          text: 'Your organization is structured as Country → City → Kurel. Start with Countries and add the countries where you operate, then go to Cities to add cities under a country, then Kurels for the groups members actually join. To add hundreds at once, use the bulk import on the Countries page instead of adding them one by one.',
        },
      ],
    },
    {
      title: 'Members',
      items: [
        {
          name: 'Member management',
          text: "This is your full directory. Add people one by one, or import a CSV/Excel file of member IDs and phone numbers. A member can't use the app until they have signed up with their member ID + phone number (which must match exactly what you entered here) and you have approved them.",
        },
        {
          name: 'Approvals',
          text: 'Anyone who signed up in the app but has not been approved yet appears here. Check their photo and details, then Approve or Reject. A rejection can include a reason, which the member sees in the app.',
        },
      ],
    },
    {
      title: 'App content',
      items: [
        {
          name: 'Banners',
          text: "Image banners shown in a carousel on the mobile app's home screen. Each can have a link that opens on tap. Enable/disable a banner without deleting it, and reorder with the ▲/▼ buttons.",
        },
        {
          name: 'Popups',
          text: 'A window shown when the app opens — more prominent than a banner, to be kept for items that really need attention (urgent announcement, deadline). Only the highest-priority active popup is shown per visit.',
        },
      ],
    },
    {
      title: 'Activity',
      items: [
        {
          name: 'Events',
          text: 'Create one-off or recurring events, for the whole organization or a specific kurel. Events start as drafts — click Publish (or "Publish series" for a recurring batch) when ready, or tick "Publish immediately" when creating.',
        },
        { name: 'Requests', text: 'Absence requests and events proposed by members, waiting for your decision.' },
        {
          name: 'Resource requests',
          text: 'Equipment, books, instruments, transport... following the Member/Lead → Admin → Zone lead → Leadership chain. Full decision history per request.',
        },
        {
          name: 'Logistics',
          text: 'Tasks created automatically after the final approval of a resource request — track them from "Pending" to "Completed" and assign them to someone.',
        },
        {
          name: 'Finance',
          text: 'Financial programs and contributions (Wave / Orange Money / Cash) with proof of payment, as well as card donations (Stripe).',
        },
        { name: 'Reports', text: 'Key figures: active members, pending approvals, kurels and donations.' },
      ],
    },
    {
      title: 'Curriculum & media library',
      items: [
        {
          name: 'Curriculum management',
          text: 'Book list, assignment by kurel, and progress reports (mastery, melody, tempo, guidelines).',
        },
        {
          name: 'Book library',
          text: 'Digital editions (PDF) uploaded and shared by kurel or by member, with download permission or read-only.',
        },
        {
          name: 'Audio Library',
          text: 'Recordings of rehearsals, announcements and performances, validated before members can see them.',
        },
        { name: 'Discussions', text: "Read-only supervision view of each kurel's existing discussions." },
      ],
    },
    {
      title: 'Academic levels & access',
      items: [
        {
          name: 'Academic levels',
          text: 'Create the levels (Level 1, Level 2…) under Academic levels. For each level, choose which other levels its kurels can also access, and optionally cap how many library books can be assigned to it.',
        },
        {
          name: 'Assigning levels',
          text: 'Every kurel, library book, academic material and equipment item has a level. Assign the kurel’s level on the Kurels page, the book’s level in the Library, the material’s level in the Pedagogical committee, and the equipment’s level in Equipment. A kurel can only access items its level allows.',
        },
        {
          name: 'Equipment',
          text: 'The equipment catalog lists every item with its level and quantity. Resource requests can only be made for items permitted by the requesting kurel’s level.',
        },
      ],
    },
    {
      title: 'Discipline',
      items: [
        {
          name: 'Disciplinary council',
          text: 'Open a case, request a hearing, record votes, then resolve (reinstatement or upheld). Full history kept per case.',
        },
      ],
    },
    {
      title: 'System',
      items: [
        {
          name: 'Permissions',
          text: 'Give other administrators access to certain sections only (for example someone who manages only Members, not Donations) rather than full access. You can also designate Zone leads here (the cities for which they review resource requests).',
        },
        {
          name: 'Integrations',
          text: 'Enter your Twilio, Stripe and Google Maps credentials — each save takes effect immediately, with no redeployment.',
        },
        {
          name: 'Settings',
          text: "Set a support email/phone — this is what members see if their number doesn't match their member ID and they need help.",
        },
      ],
    },
  ] as { title: string; items: { name: string; text: string }[] }[],
});
