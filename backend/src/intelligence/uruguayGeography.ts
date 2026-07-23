export type UruguayPlace = {
  name: string;
  aliases?: string[];
  department: string;
  latitude: number;
  longitude: number;
  searchRadiusKm?: number;
};

const PLACES: UruguayPlace[] = [
  { name: "Ciudad de la Costa", department: "Canelones", latitude: -34.8167, longitude: -55.9500, searchRadiusKm: 18 },
  { name: "Barra de Carrasco", department: "Canelones", latitude: -34.8792, longitude: -56.0315 },
  { name: "San Jose de Carrasco", aliases: ["San José de Carrasco"], department: "Canelones", latitude: -34.8445, longitude: -55.9990 },
  { name: "Shangrila", aliases: ["Shangri La", "Shangrilá"], department: "Canelones", latitude: -34.8505, longitude: -55.9860 },
  { name: "Lagomar", department: "Canelones", latitude: -34.8320, longitude: -55.9630 },
  { name: "Solymar", department: "Canelones", latitude: -34.8070, longitude: -55.9220 },
  { name: "Lomas de Solymar", department: "Canelones", latitude: -34.7955, longitude: -55.9030 },
  { name: "Medanos de Solymar", aliases: ["Médanos de Solymar"], department: "Canelones", latitude: -34.7910, longitude: -55.8880 },
  { name: "El Pinar", department: "Canelones", latitude: -34.7950, longitude: -55.8730 },
  { name: "Pando", department: "Canelones", latitude: -34.7172, longitude: -55.9584, searchRadiusKm: 15 },
  { name: "Las Piedras", department: "Canelones", latitude: -34.7264, longitude: -56.2192, searchRadiusKm: 15 },
  { name: "Canelones", department: "Canelones", latitude: -34.5228, longitude: -56.2778, searchRadiusKm: 20 },
  { name: "Montevideo", department: "Montevideo", latitude: -34.9011, longitude: -56.1645, searchRadiusKm: 18 },
  { name: "Pocitos", department: "Montevideo", latitude: -34.9098, longitude: -56.1506, searchRadiusKm: 5 },
  { name: "Punta Carretas", department: "Montevideo", latitude: -34.9235, longitude: -56.1595, searchRadiusKm: 5 },
  { name: "Parque Batlle", department: "Montevideo", latitude: -34.8955, longitude: -56.1530, searchRadiusKm: 5 },
  { name: "Buceo", department: "Montevideo", latitude: -34.8977, longitude: -56.1294, searchRadiusKm: 5 },
  { name: "Malvin", aliases: ["Malvín"], department: "Montevideo", latitude: -34.8932, longitude: -56.1002, searchRadiusKm: 5 },
  { name: "Carrasco", department: "Montevideo", latitude: -34.8859, longitude: -56.0584, searchRadiusKm: 6 },
  { name: "Centro", department: "Montevideo", latitude: -34.9055, longitude: -56.1910, searchRadiusKm: 5 },
  { name: "Cordon", aliases: ["Cordón"], department: "Montevideo", latitude: -34.9002, longitude: -56.1782, searchRadiusKm: 5 },
  { name: "Ciudad Vieja", department: "Montevideo", latitude: -34.9061, longitude: -56.2053, searchRadiusKm: 5 },
  { name: "Tres Cruces", department: "Montevideo", latitude: -34.8936, longitude: -56.1662, searchRadiusKm: 5 },
  { name: "La Blanqueada", department: "Montevideo", latitude: -34.8864, longitude: -56.1540, searchRadiusKm: 5 },
  { name: "Union", aliases: ["Unión"], department: "Montevideo", latitude: -34.8798, longitude: -56.1350, searchRadiusKm: 5 },
  { name: "Prado", department: "Montevideo", latitude: -34.8585, longitude: -56.2070, searchRadiusKm: 5 },
  { name: "Aguada", department: "Montevideo", latitude: -34.8890, longitude: -56.1940, searchRadiusKm: 5 },
  { name: "Goes", department: "Montevideo", latitude: -34.8790, longitude: -56.1780, searchRadiusKm: 5 },
  { name: "Colon", aliases: ["Colón"], department: "Montevideo", latitude: -34.8015, longitude: -56.2235, searchRadiusKm: 7 },
  { name: "Penarol", aliases: ["Peñarol"], department: "Montevideo", latitude: -34.8270, longitude: -56.2010, searchRadiusKm: 6 },
  { name: "Manga", department: "Montevideo", latitude: -34.8075, longitude: -56.1135, searchRadiusKm: 7 },
  { name: "Cerro", department: "Montevideo", latitude: -34.8895, longitude: -56.2520, searchRadiusKm: 6 },
  { name: "La Teja", department: "Montevideo", latitude: -34.8635, longitude: -56.2310, searchRadiusKm: 5 },
  { name: "Paso Molino", department: "Montevideo", latitude: -34.8575, longitude: -56.2200, searchRadiusKm: 5 },
  { name: "Maldonado", department: "Maldonado", latitude: -34.9000, longitude: -54.9500, searchRadiusKm: 20 },
  { name: "Punta del Este", department: "Maldonado", latitude: -34.9620, longitude: -54.9500, searchRadiusKm: 15 },
  { name: "San Carlos", department: "Maldonado", latitude: -34.7912, longitude: -54.9182, searchRadiusKm: 15 },
  { name: "San Jose", aliases: ["San José"], department: "San Jose", latitude: -34.3375, longitude: -56.7136, searchRadiusKm: 20 },
  { name: "Colonia del Sacramento", aliases: ["Colonia"], department: "Colonia", latitude: -34.4626, longitude: -57.8398, searchRadiusKm: 20 },
  { name: "Salto", department: "Salto", latitude: -31.3833, longitude: -57.9667, searchRadiusKm: 20 },
  { name: "Paysandu", aliases: ["Paysandú"], department: "Paysandu", latitude: -32.3214, longitude: -58.0756, searchRadiusKm: 20 },
  { name: "Rivera", department: "Rivera", latitude: -30.9053, longitude: -55.5508, searchRadiusKm: 20 },
  { name: "Rocha", department: "Rocha", latitude: -34.4833, longitude: -54.3333, searchRadiusKm: 20 }
];

export function normalizePlaceName(value: string) {
  return value.toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const PLACE_NAMES = PLACES.flatMap((place) => [place.name, ...(place.aliases ?? [])]
  .map((name) => ({ name, normalized: normalizePlaceName(name), place })))
  .sort((left, right) => right.normalized.length - left.normalized.length);

export function knownUruguayLocationNames() {
  return PLACE_NAMES.map((item) => item.name);
}

export function findUruguayPlace(value: string | null | undefined) {
  const normalized = normalizePlaceName(String(value ?? ""));
  if (!normalized) return null;
  const exact = PLACE_NAMES.find((item) => item.normalized === normalized);
  if (exact) return exact.place;
  return PLACE_NAMES.find((item) => new RegExp(`(?:^| )${item.normalized.replace(/\s+/g, "\\s+")}(?: |$)`).test(normalized))?.place ?? null;
}

export function distanceKm(left: UruguayPlace, right: UruguayPlace) {
  const toRadians = (degrees: number) => degrees * Math.PI / 180;
  const latitudeDelta = toRadians(right.latitude - left.latitude);
  const longitudeDelta = toRadians(right.longitude - left.longitude);
  const leftLatitude = toRadians(left.latitude);
  const rightLatitude = toRadians(right.latitude);
  const haversine = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(leftLatitude) * Math.cos(rightLatitude) * Math.sin(longitudeDelta / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

export function defaultLocationRadiusKm(location: string) {
  return findUruguayPlace(location)?.searchRadiusKm ?? 15;
}

export function nearbyUruguayLocations(location: string, radiusKm = defaultLocationRadiusKm(location)) {
  const target = findUruguayPlace(location);
  if (!target) return [location];
  return PLACES
    .filter((place) => distanceKm(target, place) <= radiusKm)
    .flatMap((place) => [place.name, ...(place.aliases ?? [])]);
}

export function evaluateUruguayProximity(candidateLocation: string, requestedLocation: string) {
  const candidate = findUruguayPlace(candidateLocation);
  const requested = findUruguayPlace(requestedLocation);
  if (!candidate || !requested) return null;
  const distance = distanceKm(candidate, requested);
  const radius = defaultLocationRadiusKm(requestedLocation);
  return {
    candidate: candidate.name,
    requested: requested.name,
    distanceKm: Math.round(distance * 10) / 10,
    radiusKm: radius,
    matches: distance <= radius
  };
}
