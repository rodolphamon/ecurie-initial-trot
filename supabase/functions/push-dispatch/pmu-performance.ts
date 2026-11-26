// Données publiques d'une arrivée PMU déjà identifiée par date/course/hippodrome.
const text = (value: unknown): string => String(value || "").normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();
const positive = (value: unknown): number | null => {
  const n = typeof value === "number" || typeof value === "string" && /^\d+$/.test(value) ? Number(value) : NaN;
  return Number.isSafeInteger(n) && n > 0 ? n : null;
};
const label = (value: unknown): string => typeof value === "string" ? value.trim() : "";

export function pmuPerformance(event: Record<string, any>, race: Record<string, any>,
  participants: Record<string, any>[], bib: number, expectedName: string): Record<string, any> | null {
  if (race.arriveeDefinitive !== true || !Array.isArray(race.ordreArrivee) || !race.ordreArrivee.length
    || !/^\d{4}-\d{2}-\d{2}$/.test(event.date || "") || !/^R\d+C\d+$/i.test(event.course || "")) return null;
  const runners = new Map<number, Record<string, any>>();
  for (const p of participants) {
    const n = positive(p.numPmu);
    if (!n || !label(p.nom) || runners.has(n)) return null;
    runners.set(n, p);
  }
  const runner = runners.get(bib);
  if (!runner || text(runner.nom) !== text(expectedName)) return null;
  const monteKey = text(race.discipline) === "ATTELE" ? "driver" : "jockey";
  const arrivee: Record<string, any>[] = [];
  const seen = new Set<number>();
  for (const group of race.ordreArrivee) {
    const numbers = Array.isArray(group) ? group : [group];
    if (!numbers.length) return null;
    const rang = arrivee.length + 1;
    for (const number of numbers) {
      const n = positive(number), p = n ? runners.get(n) : null;
      if (!n || !p || seen.has(n)) return null;
      seen.add(n);
      const row: Record<string, any> = { rang, numero: n, cheval: p.nom };
      const monte = label(p.driver || p.jockey);
      if (monte) row[monteKey] = monte;
      arrivee.push(row);
    }
  }
  const target = arrivee.find(row => row.numero === bib);
  if (!target) return null;
  const course = event.course.toUpperCase();
  const url = "https://www.equidia.fr/courses/" + event.date + "/" + course.replace("C", "/C");
  const result: Record<string, any> = {
    date: event.date, hippodrome: event.hippodrome, rang: String(target.rang),
    officiel: true, statut: "officiel", course, numero: bib, arrivee,
    source_description: "PMU : arrivée définitive " + course + ", cheval n°" + bib,
    course_url: url, video_url: url, video_source: "equidia_course",
  };
  const types: Record<string, string> = {ATTELE: "Trot attelé", MONTE: "Trot monté", PLAT: "Plat", HAIE: "Haies", "STEEPLE CHASE": "Steeple-chase", CROSS: "Cross"};
  const ferrures: Record<string, string> = {FERRE: "F4", DEFERRE_ANTERIEURS: "DA", DEFERRE_POSTERIEURS: "DP", DEFERRE_ANTERIEURS_POSTERIEURS: "D4", PROTEGE_ANTERIEURS: "PA", PROTEGE_POSTERIEURS: "PP", PROTEGE_ANTERIEURS_POSTERIEURS: "P4"};
  const values: Record<string, unknown> = {
    prix: label(race.libelle) || event.prix, type: types[text(race.discipline)] || event.type,
    type_course: event.type_course, surface: event.surface,
    distance: positive(runner.handicapDistance) || positive(race.distance),
    partants: positive(race.nombreDeclaresPartants),
    allocation: positive(race.montantTotalOffert) || positive(race.montantPrix),
    entraineur: label(runner.entraineur) || event.entraineur,
    ferrure: ferrures[runner.deferre] || event.ferrure,
  };
  const monte = label(runner.driver || runner.jockey), declared = label(event.driver || event.jockey || event.monte);
  // Conserver le prénom complet déjà connu si la source officielle confirme le même nom.
  const names = (s: string) => text(s).split(" ");
  const actual = names(monte), known = names(declared);
  const sameMonte = monte && declared && actual[0]?.[0] === known[0]?.[0]
    && actual.slice(1).join(" ") === known.slice(1).join(" ");
  if (monte) { values[monteKey] = sameMonte ? declared : monte; target[monteKey] = values[monteKey]; }
  const chrono = positive(runner.reductionKilometrique);
  if (chrono) values.reduction_km = Math.floor(chrono / 60000) + "′" + String(Math.floor(chrono / 1000) % 60).padStart(2, "0") + "″" + Math.floor(chrono / 100) % 10;
  const suffix = ({1: "1er", 2: "2eme", 3: "3eme", 4: "4eme", 5: "5eme"} as Record<number, string>)[target.rang];
  if (suffix && arrivee.filter(row => row.rang === target.rang).length === 1)
    values.allocation_place = positive(race["montantOffert" + suffix]);
  for (const [key, value] of Object.entries(values)) if (value !== null && value !== undefined && value !== "") result[key] = value;
  return result;
}
