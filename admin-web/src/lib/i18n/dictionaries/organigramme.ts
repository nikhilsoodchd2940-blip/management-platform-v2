import { ns } from '../types';

export default ns({
  title: 'Organization chart',
  subtitle: 'The organization structure: country → city → kurel, with each kurel’s level and headcount.',
  statCountries: 'Countries',
  statCities: 'Cities',
  statKurels: 'Active kurels',
  statNoLevel: 'Kurels without a level',
  empty: 'No organization structure yet — create countries, cities and kurels first.',
  structure: 'Structure',
  citiesCount: (n: number) => `${n} ${n === 1 ? 'city' : 'cities'}`,
  kurelsCount: (n: number) => `${n} ${n === 1 ? 'kurel' : 'kurels'}`,
  headcount: (n: number) => `${n} ${n === 1 ? 'member' : 'members'}`,
  noLevel: 'No level',
  noKurels: 'No kurels yet',
});
