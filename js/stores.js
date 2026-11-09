// Delhaize stores with a "Delhaize Collect" pick-up point (source: stores.delhaize.be store pages, schema.org data, 9 Nov 2026).
export const STORES = [
  {"id": "flagey", "name": "Delhaize Flagey", "street": "Rue de Hennin, 18", "postcode": "1050", "city": "Ixelles", "lat": 50.828748, "lng": 4.368142},
  {"id": "boondael", "name": "Delhaize Boondael", "street": "Avenue du Bois de la Cambre, 120", "postcode": "1050", "city": "Ixelles", "lat": 50.807902, "lng": 4.393202},
  {"id": "st-antoine", "name": "Delhaize St Antoine", "street": "Rue Nothomb, 54", "postcode": "1040", "city": "Etterbeek", "lat": 50.829274, "lng": 4.388108},
  {"id": "chazal", "name": "Delhaize Chazal", "street": "Avenue Léon Mahillon, 22", "postcode": "1030", "city": "Schaerbeek", "lat": 50.850719, "lng": 4.391152},
  {"id": "defre", "name": "Delhaize Defré", "street": "Avenue De Fré, 94", "postcode": "1180", "city": "Uccle", "lat": 50.804599, "lng": 4.357107},
  {"id": "veeweyde", "name": "Delhaize Veeweyde", "street": "Chaussée de Mons, 718", "postcode": "1070", "city": "Anderlecht", "lat": 50.828856, "lng": 4.305524},
  {"id": "roodebeek", "name": "Delhaize Roodebeek", "street": "Chaussée de Roodebeek, 199", "postcode": "1200", "city": "Woluwe-Saint-Lambert", "lat": 50.848266, "lng": 4.428878},
  {"id": "mutsaard", "name": "Delhaize Mutsaard", "street": "Avenue de la Brise, 15", "postcode": "1020", "city": "Laeken", "lat": 50.897691, "lng": 4.357683},
  {"id": "ledeberg", "name": "Delhaize Ledeberg", "street": "Driesstraat, 96", "postcode": "9050", "city": "Ledeberg", "lat": 51.038512, "lng": 3.745643},
  {"id": "watersport", "name": "Delhaize Watersport", "street": "Jubileumlaan, 15", "postcode": "9000", "city": "Gent", "lat": 51.047175, "lng": 3.707123},
  {"id": "wondelgem", "name": "Delhaize Wondelgem", "street": "Botestraat, 14", "postcode": "9032", "city": "Wondelgem", "lat": 51.088915, "lng": 3.704114},
  {"id": "fragnee", "name": "Delhaize Fragnée", "street": "Rue de Fragnée, 41", "postcode": "4000", "city": "Liège", "lat": 50.625354, "lng": 5.572897},
  {"id": "burenville", "name": "Delhaize Burenville", "street": "Rue Saint-Nicolas, 410", "postcode": "4000", "city": "Liège", "lat": 50.639335, "lng": 5.539327},
  {"id": "hippodroom", "name": "Delhaize Hippodroom", "street": "Museumstraat, 38", "postcode": "2000", "city": "Antwerpen", "lat": 51.209407, "lng": 4.39256},
  {"id": "plantin", "name": "Delhaize Plantin", "street": "Plantin en Moretuslei, 106", "postcode": "2018", "city": "Antwerpen", "lat": 51.210136, "lng": 4.426766},
  {"id": "heverlee", "name": "Delhaize Heverlee", "street": "Tervuursevest, 19", "postcode": "3001", "city": "Heverlee", "lat": 50.868573, "lng": 4.696455},
  {"id": "kessel-lo", "name": "Delhaize Kessel-Lo", "street": "Diestsesteenweg, 545", "postcode": "3010", "city": "Leuven", "lat": 50.886259, "lng": 4.741419},
  {"id": "jambes", "name": "Delhaize Jambes", "street": "Avenue Prince de Liège, 41", "postcode": "5100", "city": "Jambes", "lat": 50.462128, "lng": 4.878745},
  {"id": "bouge", "name": "Delhaize Bouge", "street": "Chaussée de Louvain, 336", "postcode": "5004", "city": "Bouge", "lat": 50.478064, "lng": 4.879348},
  {"id": "brugge-st-michiels", "name": "Delhaize Brugge St Michiels", "street": "Koningin Astridlaan, 97/20", "postcode": "8000", "city": "Brugge", "lat": 51.188394, "lng": 3.199846},
  {"id": "mons", "name": "Delhaize Mons", "street": "Chaussée du Roeulx, 292", "postcode": "7000", "city": "Mons", "lat": 50.45655, "lng": 3.983266},
  {"id": "mechelen", "name": "Delhaize Mechelen", "street": "Oscar Van Kesbeeckstraat, 21", "postcode": "2800", "city": "Mechelen", "lat": 51.037052, "lng": 4.473164},
  {"id": "hasselt", "name": "Delhaize Hasselt", "street": "Luikersteenweg, 109", "postcode": "3500", "city": "Hasselt", "lat": 50.92323, "lng": 5.339743},
  {"id": "marcinelle", "name": "Delhaize Marcinelle", "street": "Chaussée de Philippeville, 236", "postcode": "6001", "city": "Charleroi", "lat": 50.386504, "lng": 4.462308},
  {"id": "wavre", "name": "Delhaize Wavre", "street": "Chaussée de Louvain, 126", "postcode": "1300", "city": "Wavre", "lat": 50.717042, "lng": 4.618898},
];
export const storeById = (id) => STORES.find((s) => s.id === id) || null;
export const storeByName = (name) => STORES.find((s) => s.name === name) || null;
const rad = (d) => (d * Math.PI) / 180;
export function distanceKm(a, b) {
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}
/** Stores sorted by distance from a position {lat, lng}. */
export const nearestStores = (pos) => STORES.map((s) => ({ ...s, km: distanceKm(pos, s) })).sort((a, b) => a.km - b.km);
/** Simple search over name, city, postcode and street. */
export function searchStores(q) {
  const t = String(q || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
  if (!t) return STORES;
  const norm = (x) => x.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const alias = { brussels: "10", bruxelles: "10", brussel: "10", gent: "90", ghent: "90", gand: "90", antwerp: "20", anvers: "20", liege: "40", luik: "40", leuven: "30", louvain: "30", namur: "50", namen: "50", bruges: "80", brugge: "80", bergen: "70", charleroi: "60" };
  const pc = alias[t];
  return STORES.filter((s) => norm(`${s.name} ${s.city} ${s.street}`).includes(t) || s.postcode.startsWith(pc || t));
}
