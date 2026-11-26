const normal = (value: unknown) => String(value || "").toLowerCase().normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const rankKey = (value: unknown) => {
  const s = String(value || "").trim(), m = s.match(/^(\d+)(?:er|re|e)?$/i);
  return m ? String(Number(m[1]) > 9 ? 0 : Number(m[1])) : s.toUpperCase();
};

export function publicPerformance(p: Record<string, any>): Record<string, any> | null {
  if (typeof p.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(p.date)
    || typeof p.hippodrome !== "string" || typeof p.rang !== "string"
    || !/^(?:[0-9]{1,2}(?:er|e|re)?|DAI|D|DA|DI|DM|T|A|NP|NC)$/i.test(p.rang.trim())) return null;
  const result: Record<string, any> = {date: p.date, hippodrome: p.hippodrome, rang: p.rang.trim(),
    officiel: true, statut: "officiel", source_description: "Résultat officiel — Écurie Initial"};
  const details = p.performance;
  const sameRace = details && details.officiel === true && details.date === p.date
    && normal(details.hippodrome) === normal(p.hippodrome) && rankKey(details.rang) === rankKey(p.rang)
    && (!p.course || String(p.course).toUpperCase() === String(details.course).toUpperCase());
  const source = sameRace ? {...p, ...details} : p;
  if (typeof source.course === "string" && /^R\d+C\d+$/i.test(source.course)) {
    result.course = source.course.toUpperCase();
    result.course_url = "https://www.equidia.fr/courses/" + p.date + "/" + result.course.replace("C", "/C");
    result.video_url = result.course_url;
    result.video_source = "equidia_course";
  }
  for (const key of ["driver", "jockey", "entraineur", "type", "prix", "type_course", "surface", "ferrure", "reduction_km"])
    if (typeof source[key] === "string" && source[key].length < 240) result[key] = source[key];
  for (const key of ["numero", "distance", "partants", "allocation", "allocation_place"])
    if (typeof source[key] === "number" && Number.isFinite(source[key]) && source[key] >= 0) result[key] = source[key];
  if (sameRace && Array.isArray(details.arrivee) && details.arrivee.length > 0 && details.arrivee.length <= 100) {
    const seen = new Set<number>();
    const valid = details.arrivee.every((row: any) => row && Number.isSafeInteger(row.rang) && row.rang > 0
      && Number.isSafeInteger(row.numero) && row.numero > 0 && !seen.has(row.numero) && seen.add(row.numero)
      && typeof row.cheval === "string" && row.cheval.length > 0 && row.cheval.length < 120);
    const target = details.arrivee.find((row: any) => row.numero === details.numero);
    if (valid && target && rankKey(target.rang) === rankKey(p.rang)) result.arrivee = details.arrivee.map((row: any) => {
      const out: Record<string, any> = {rang: row.rang, numero: row.numero, cheval: row.cheval};
      for (const key of ["driver", "jockey", "monte"])
        if (typeof row[key] === "string" && row[key].length < 120) out[key] = row[key];
      return out;
    });
  }
  return result;
}
