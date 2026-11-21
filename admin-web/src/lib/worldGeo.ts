/** A hand-drawn, simplified world: land outlines (lon, lat) for the dotted map, and where each country sits. */
export type Continent = 'africa' | 'europe' | 'asia' | 'northamerica' | 'southamerica' | 'oceania';
export const CONTINENTS: { key: Continent; label: string }[] = [
  { key: 'africa', label: 'Africa' }, { key: 'europe', label: 'Europe' }, { key: 'asia', label: 'Asia' },
  { key: 'northamerica', label: 'North America' }, { key: 'southamerica', label: 'South America' }, { key: 'oceania', label: 'Oceania' },
];

type P = [number, number][];
const LAND: P[] = [
  [[-168,66],[-162,70],[-141,70],[-125,70],[-110,73],[-95,72],[-85,70],[-80,63],[-93,60],[-95,52],[-82,52],[-78,58],[-65,60],[-62,55],[-56,52],[-66,45],[-70,42],[-76,37],[-81,31],[-80,25],[-82,27],[-90,30],[-97,27],[-97,21],[-90,21],[-87,21],[-88,16],[-84,11],[-79,9],[-77,8],[-83,8],[-86,12],[-92,15],[-105,20],[-110,24],[-113,31],[-117,32],[-121,35],[-124,41],[-124,48],[-130,55],[-140,60],[-152,59],[-158,57],[-165,60]],
  [[-73,78],[-60,82],[-30,83],[-20,78],[-20,70],[-30,68],[-43,60],[-50,64],[-55,70],[-68,76]],
  [[-77,8],[-72,12],[-62,10],[-52,5],[-50,0],[-45,-2],[-35,-5],[-35,-9],[-39,-15],[-41,-22],[-48,-26],[-53,-34],[-58,-38],[-62,-40],[-65,-45],[-68,-52],[-70,-55],[-74,-50],[-73,-40],[-71,-30],[-70,-18],[-76,-14],[-81,-6],[-80,-2],[-78,2]],
  [[-9,43],[-9,37],[-5,36],[-1,37],[3,42],[8,44],[12,44],[16,38],[18,40],[13,46],[19,42],[22,37],[24,38],[26,41],[29,41],[36,36],[35,33],[34,28],[39,21],[43,13],[52,16],[59,22],[56,26],[51,24],[48,30],[57,25],[62,25],[67,24],[72,21],[73,16],[77,8],[80,13],[80,16],[87,21],[92,22],[94,17],[98,16],[98,8],[101,2],[104,1],[104,9],[106,10],[109,12],[108,17],[106,20],[110,21],[117,24],[122,30],[121,37],[118,38],[122,40],[125,40],[129,36],[129,41],[135,43],[141,52],[140,57],[150,59],[156,57],[163,60],[163,66],[180,69],[170,70],[140,73],[113,74],[105,78],[95,76],[80,73],[68,69],[60,69],[50,68],[40,67],[41,65],[33,69],[25,71],[15,69],[6,62],[5,59],[10,59],[12,56],[8,56],[8,54],[5,53],[3,51],[-2,48],[-4,48],[-1,44]],
  [[-17,21],[-13,28],[-9,32],[-6,36],[10,37],[11,33],[20,31],[32,31],[34,28],[38,20],[43,12],[51,12],[48,5],[41,-2],[40,-10],[40,-16],[35,-24],[32,-29],[27,-34],[20,-35],[17,-30],[12,-17],[14,-10],[9,-1],[9,4],[5,6],[-5,5],[-8,4],[-13,8],[-17,14]],
  [[44,-25],[47,-25],[50,-15],[49,-12],[44,-17]],
  [[114,-22],[122,-18],[130,-12],[136,-12],[137,-16],[142,-11],[146,-19],[153,-26],[150,-37],[141,-38],[135,-35],[131,-31],[124,-33],[115,-34]],
  [[-5,50],[1,51],[2,53],[-2,57],[-3,59],[-6,58],[-5,54],[-3,54]],
  [[-10,52],[-6,52],[-6,55],[-9,54]],
  [[130,31],[135,34],[140,36],[142,40],[141,45],[139,40],[136,36],[131,34]],
  [[95,5],[98,4],[105,-5],[101,-3],[95,3]], [[109,2],[117,7],[119,1],[116,-4],[110,-3]], [[105,-6],[114,-8],[114,-7],[106,-6]],
  [[131,-1],[141,-3],[150,-10],[142,-9],[137,-5]], [[120,18],[124,13],[126,7],[122,8],[120,14]],
  [[172,-34],[178,-38],[174,-41],[172,-41]], [[172,-41],[174,-42],[170,-46],[167,-46]], [[80,9],[82,7],[80,6]],
  [[-24,64],[-14,64],[-15,66],[-22,66]], [[-85,22],[-77,20],[-75,20],[-80,23]], [[-74,19],[-69,19],[-69,18],[-74,18]],
];
const SEA: P[] = [
  [[10,55],[12,58],[18,60],[22,66],[25,65],[22,60],[28,60],[22,57],[14,54]],
  [[28,42],[28,45],[34,46],[40,44],[41,41],[35,42]],
  [[47,45],[53,45],[54,38],[49,37]],
];

const inside = (x: number, y: number, poly: P) => {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]; const [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
};

export const MAP_W = 360;
export const MAP_H = 136;
/** Longitude/latitude to map units (equirectangular, 80°N to 56°S). */
export const project = (lat: number, lng: number): [number, number] => [lng + 180, 80 - lat];

let DOTS = '';
/** One SVG path made of tiny round dots, one every 3 degrees over land. */
export function dotPath(): string {
  if (DOTS) return DOTS;
  const parts: string[] = [];
  for (let lat = 78; lat >= -56; lat -= 2.6) {
    for (let lng = -178; lng <= 178; lng += 2.6) {
      if (LAND.some((p) => inside(lng, lat, p)) && !SEA.some((p) => inside(lng, lat, p))) {
        const [x, y] = project(lat, lng);
        parts.push(`M${x.toFixed(1)} ${y.toFixed(1)}h.01`);
      }
    }
  }
  DOTS = parts.join('');
  return DOTS;
}

const norm = (n: string) => n.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/gi, ' ').replace(/\s+/g, ' ').trim().toLowerCase();

/** name variants (English, French, Spanish, Italian), latitude, longitude, continent */
const TABLE: [string, number, number, Continent][] = [
  ['senegal', 14.5, -14.5, 'africa'], ['mauritania|mauritanie|mauritania', 20.3, -10.9, 'africa'], ['mali', 17.6, -3.9, 'africa'], ['gambia|gambie', 13.4, -15.3, 'africa'], ['guinea|guinee', 10.9, -10.9, 'africa'],
  ['guinea bissau|guinee bissau', 12, -15, 'africa'], ['cote d ivoire|ivory coast|costa de marfil|costa d avorio', 7.6, -5.5, 'africa'], ['burkina faso', 12.2, -1.6, 'africa'], ['ghana', 7.9, -1.0, 'africa'], ['togo', 8.6, 0.8, 'africa'],
  ['benin', 9.3, 2.3, 'africa'], ['niger', 17.6, 8.1, 'africa'], ['nigeria', 9.1, 8.7, 'africa'], ['cameroon|cameroun|camerun', 5.7, 12.7, 'africa'], ['chad|tchad|ciad', 15.5, 18.7, 'africa'],
  ['morocco|maroc|marruecos|marocco', 31.8, -7.1, 'africa'], ['algeria|algerie|argelia|algeria', 28.0, 1.7, 'africa'], ['tunisia|tunisie|tunez|tunisia', 33.9, 9.5, 'africa'], ['libya|libye|libia', 26.3, 17.2, 'africa'], ['egypt|egypte|egipto|egitto', 26.8, 30.8, 'africa'],
  ['sudan|soudan|sudan', 15.6, 30.2, 'africa'], ['ethiopia|ethiopie|etiopia', 9.1, 40.5, 'africa'], ['kenya', 0.0, 37.9, 'africa'], ['tanzania|tanzanie', -6.4, 34.9, 'africa'], ['uganda|ouganda', 1.4, 32.3, 'africa'],
  ['rwanda', -1.9, 29.9, 'africa'], ['dr congo|drc|rdc|congo kinshasa|republique democratique du congo', -4.0, 21.8, 'africa'], ['congo|congo brazzaville', -0.2, 15.8, 'africa'], ['gabon', -0.8, 11.6, 'africa'], ['angola', -11.2, 17.9, 'africa'],
  ['zambia|zambie', -13.1, 27.8, 'africa'], ['zimbabwe', -19.0, 29.2, 'africa'], ['mozambique', -18.7, 35.5, 'africa'], ['madagascar', -18.8, 46.9, 'africa'], ['south africa|afrique du sud|sudafrica|sud africa', -30.6, 22.9, 'africa'],
  ['namibia|namibie', -22.6, 17.1, 'africa'], ['botswana', -22.3, 24.7, 'africa'], ['somalia|somalie', 5.2, 46.2, 'africa'], ['sierra leone', 8.5, -11.8, 'africa'], ['liberia', 6.4, -9.4, 'africa'], ['cape verde|cap vert|cabo verde|capo verde', 16.0, -24.0, 'africa'], ['comoros|comores', -11.9, 43.9, 'africa'],
  ['france|francia', 46.6, 2.3, 'europe'], ['italy|italie|italia', 42.8, 12.6, 'europe'], ['spain|espagne|espana|spagna', 40.2, -3.7, 'europe'], ['portugal|portogallo', 39.6, -8.0, 'europe'], ['germany|allemagne|alemania|germania', 51.2, 10.4, 'europe'],
  ['belgium|belgique|belgica|belgio', 50.6, 4.7, 'europe'], ['netherlands|pays bas|paises bajos|paesi bassi|holland', 52.2, 5.5, 'europe'], ['luxembourg|luxemburgo|lussemburgo', 49.8, 6.1, 'europe'], ['switzerland|suisse|suiza|svizzera', 46.8, 8.2, 'europe'],
  ['united kingdom|uk|royaume uni|reino unido|regno unito|england|angleterre', 54.0, -2.5, 'europe'], ['ireland|irlande|irlanda', 53.2, -8.0, 'europe'], ['austria|autriche', 47.6, 14.1, 'europe'], ['sweden|suede|suecia|svezia', 62.0, 15.0, 'europe'],
  ['norway|norvege|noruega|norvegia', 61.0, 9.0, 'europe'], ['denmark|danemark|dinamarca|danimarca', 56.0, 10.0, 'europe'], ['finland|finlande|finlandia', 64.0, 26.0, 'europe'], ['poland|pologne|polonia', 52.1, 19.4, 'europe'],
  ['greece|grece|grecia', 39.0, 22.0, 'europe'], ['romania|roumanie|rumania', 45.9, 25.0, 'europe'], ['russia|russie|rusia', 58.0, 50.0, 'europe'], ['turkey|turquie|turquia|turchia', 39.0, 35.2, 'asia'], ['ukraine|ucrania|ucraina', 49.0, 31.4, 'europe'],
  ['usa|us|united states|etats unis|estados unidos|stati uniti|america', 39.5, -98.5, 'northamerica'], ['canada', 56.0, -100.0, 'northamerica'], ['mexico|mexique|messico', 23.6, -102.5, 'northamerica'], ['cuba', 21.6, -79.0, 'northamerica'],
  ['haiti', 19.0, -72.3, 'northamerica'], ['dominican republic|republique dominicaine|republica dominicana', 18.9, -70.2, 'northamerica'], ['guatemala', 15.5, -90.3, 'northamerica'], ['panama', 8.5, -80.0, 'northamerica'], ['jamaica|jamaique|giamaica', 18.1, -77.3, 'northamerica'],
  ['brazil|bresil|brasil|brasile', -10.0, -52.0, 'southamerica'], ['argentina|argentine|argentina', -34.0, -64.0, 'southamerica'], ['colombia|colombie', 4.6, -74.3, 'southamerica'], ['peru|perou', -9.2, -75.0, 'southamerica'], ['chile|chili|cile', -33.0, -71.0, 'southamerica'],
  ['venezuela', 7.0, -66.0, 'southamerica'], ['bolivia|bolivie', -16.7, -64.7, 'southamerica'], ['ecuador|equateur', -1.8, -78.2, 'southamerica'], ['uruguay', -32.8, -56.0, 'southamerica'], ['paraguay', -23.4, -58.4, 'southamerica'],
  ['india|inde', 22.0, 79.0, 'asia'], ['pakistan', 30.4, 69.3, 'asia'], ['bangladesh', 23.7, 90.4, 'asia'], ['china|chine|cina', 35.0, 103.0, 'asia'], ['japan|japon|japon|giappone', 36.0, 138.0, 'asia'], ['south korea|coree du sud|corea del sur|corea del sud', 36.5, 127.9, 'asia'],
  ['indonesia|indonesie', -2.5, 118.0, 'asia'], ['malaysia|malaisie|malasia', 4.2, 102.0, 'asia'], ['thailand|thailande|tailandia', 15.0, 101.0, 'asia'], ['vietnam|viet nam', 14.0, 108.0, 'asia'], ['philippines|filipinas|filippine', 12.8, 122.0, 'asia'],
  ['saudi arabia|arabie saoudite|arabia saudita|arabia saudita', 24.0, 45.0, 'asia'], ['united arab emirates|uae|emirats arabes unis|emiratos arabes unidos|emirati arabi uniti', 24.0, 54.0, 'asia'], ['qatar', 25.3, 51.2, 'asia'], ['kuwait|koweit', 29.3, 47.5, 'asia'],
  ['lebanon|liban|libano', 33.9, 35.9, 'asia'], ['syria|syrie|siria', 35.0, 38.5, 'asia'], ['iraq|irak', 33.0, 44.0, 'asia'], ['iran', 32.4, 53.7, 'asia'], ['israel|israel', 31.5, 34.9, 'asia'], ['jordan|jordanie|jordania|giordania', 31.2, 36.5, 'asia'],
  ['sri lanka', 7.9, 80.7, 'asia'], ['nepal', 28.4, 84.1, 'asia'], ['afghanistan|afganistan', 33.9, 67.7, 'asia'], ['kazakhstan|kazajistan|kazakistan', 48.0, 67.0, 'asia'],
  ['australia|australie', -25.0, 134.0, 'oceania'], ['new zealand|nouvelle zelande|nueva zelanda|nuova zelanda', -41.0, 174.0, 'oceania'], ['papua new guinea|papouasie nouvelle guinee', -6.3, 143.9, 'oceania'], ['fiji|fidji', -17.7, 178.0, 'oceania'],
];
const INDEX = new Map<string, { lat: number; lng: number; continent: Continent }>();
TABLE.forEach(([names, lat, lng, continent]) => names.split('|').forEach((n) => INDEX.set(norm(n), { lat, lng, continent })));

/** Where a country sits on the map, by its name in any of the four languages. Undefined when the name is not recognised. */
export const geoOf = (name: string) => INDEX.get(norm(name));
