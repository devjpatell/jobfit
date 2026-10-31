// JobFit core: pure functions, no DOM, so they run in the browser and in Node tests alike.
import { SKILLS, CASED, CATEGORY_LABELS } from "./skills.js";

const STOPWORDS = new Set(("a an the and or but if of to in on at by for with from as is are was were be been being " +
  "this that these those it its we you your our they their he she his her them i me my will would can could should may " +
  "might must shall do does did done have has had not no nor so than too very just also into over under about across " +
  "per via etc using use used able including include includes such other more most any all each every some own same " +
  "work working experience years year team teams role job candidate candidates company strong excellent ability skills " +
  "knowledge understanding plus preferred required requirements qualifications responsibilities another new " +
  "thousands between through what who where when why how build building built help helps ideal looking join").split(/\s+/));

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Whole-word match that treats + # . / - as part of a token, so "C" does not match inside "C#".
function aliasRegex(alias, cased) {
  const body = esc(cased ?? alias).replace(/\\ /g, "\\s+").replace(/ /g, "\\s+");
  return new RegExp(`(?<![A-Za-z0-9+#])${body}(?![A-Za-z0-9+#]|\\.[A-Za-z])`, cased ? "g" : "gi");
}

const MATCHERS = [];
for (const [category, entries] of Object.entries(SKILLS)) {
  for (const [name, aliases] of Object.entries(entries)) {
    MATCHERS.push({
      name,
      category,
      regexes: aliases.map((a) => aliasRegex(a, CASED[a])),
    });
  }
}

/** Find every known skill in a text. Returns Map(name -> {category, count}). */
export function findSkills(text) {
  const found = new Map();
  for (const m of MATCHERS) {
    let count = 0;
    for (const re of m.regexes) {
      re.lastIndex = 0;
      count += (text.match(re) || []).length;
    }
    if (count) found.set(m.name, { category: m.category, count });
  }
  return found;
}

const REQUIRED_HEAD = /(required|requirements|must[- ]have|minimum qualifications|basic qualifications|what you (?:need|bring)|you have|qualifications)/i;
const PREFERRED_HEAD = /(preferred|nice[- ]to[- ]have|bonus|pluses|desired|good to have|preferred qualifications|extra credit)/i;
const RESP_HEAD = /(responsibilities|what you'?ll do|the role|about the job|about you|about us|benefits|compensation)/i;

/**
 * Tag each line of a job description as required, preferred or neutral.
 * Headings switch the current section; a line that itself says "preferred" or "a plus" is preferred.
 */
export function sectionize(jd) {
  let current = "neutral";
  return jd.split(/\r?\n/).map((raw) => {
    const line = raw.trim();
    const isHeading = line.length > 0 && line.length < 70 && !/[.;]$/.test(line) && (/:$/.test(line) || /^[A-Z][^a-z]*$/.test(line) || /^#+\s/.test(line) || line.split(/\s+/).length <= 6);
    if (isHeading) {
      if (PREFERRED_HEAD.test(line)) current = "preferred";
      else if (REQUIRED_HEAD.test(line)) current = "required";
      else if (RESP_HEAD.test(line)) current = "neutral";
    }
    let tag = current;
    if (/\b(a plus|is a plus|nice to have|preferred|bonus points?|ideally)\b/i.test(line)) tag = "preferred";
    else if (/\b(must|required|requirement|minimum of)\b/i.test(line) && current !== "preferred") tag = "required";
    return { line, tag };
  });
}

/** Skills the job asks for, each with an importance weight. */
export function jobSkills(jd) {
  const weightOf = { required: 3, neutral: 2, preferred: 1 };
  const out = new Map();
  for (const { line, tag } of sectionize(jd)) {
    for (const [name, info] of findSkills(line)) {
      const prev = out.get(name);
      const weight = weightOf[tag];
      if (!prev) out.set(name, { ...info, weight, tag });
      else {
        prev.count += info.count;
        if (weight > prev.weight) Object.assign(prev, { weight, tag });
      }
    }
  }
  for (const s of out.values()) s.weight += Math.min(s.count - 1, 2) * 0.5; // mentioned often = matters more
  return out;
}

// ------------------------------------------------------------------ text similarity

export function tokenize(text) {
  return (text.toLowerCase().match(/[a-z][a-z0-9+#.]*[a-z0-9+#]|[a-z]/g) || [])
    .map((t) => t.replace(/\.$/, ""))
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

/** Cosine similarity of term-frequency vectors with log damping, 0..1. */
export function similarity(a, b) {
  const tf = (tokens) => {
    const m = new Map();
    for (const t of tokens) m.set(t, (m.get(t) || 0) + 1);
    for (const [k, v] of m) m.set(k, 1 + Math.log(v));
    return m;
  };
  const A = tf(tokenize(a)), B = tf(tokenize(b));
  let dot = 0, na = 0, nb = 0;
  for (const [k, v] of A) { na += v * v; if (B.has(k)) dot += v * B.get(k); }
  for (const v of B.values()) nb += v * v;
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

/** Job keywords (not in the skill dictionary) that appear often in the JD but never in the resume. */
export function missingKeywords(resume, jd, limit = 8) {
  const res = new Set(tokenize(resume));
  const known = new Set();
  for (const name of findSkills(jd).keys()) for (const t of tokenize(name)) known.add(t);
  const counts = new Map();
  for (const t of tokenize(jd)) if (!res.has(t) && !known.has(t) && t.length > 3) counts.set(t, (counts.get(t) || 0) + 1);
  return [...counts].filter(([, c]) => c >= 2).sort((x, y) => y[1] - x[1]).slice(0, limit).map(([t, c]) => ({ term: t, count: c }));
}

// ------------------------------------------------------------------ experience

const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 };

/** Years the job asks for, e.g. "3+ years", "2-4 years", "minimum of 5 years". Returns the smallest number found. */
export function requiredYears(jd) {
  const nums = [];
  const re = /(\d{1,2})\s*(?:\+|plus)?\s*(?:-|–|to)?\s*(\d{1,2})?\s*\+?\s*(?:years?|yrs?)\b/gi;
  for (const m of jd.matchAll(re)) {
    const n = parseInt(m[1], 10);
    if (n > 0 && n < 30) nums.push(n);
  }
  return nums.length ? Math.min(...nums) : null;
}

/**
 * Total professional time from date ranges like "Jun 2024 – Jun 2025" or "2021 - Present".
 * Overlapping ranges are merged so two parallel jobs are not double counted.
 */
export function resumeYears(resume, today = new Date()) {
  const mon = "(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?";
  const point = `(?:${mon}\\s+)?(\\d{4})`;
  const re = new RegExp(`${point}\\s*(?:-|–|—|to)\\s*(?:(present|current|now)|${point})`, "gi");
  const ranges = [];
  for (const m of resume.matchAll(re)) {
    const sm = m[1] ? MONTHS[m[1].toLowerCase().slice(0, 3)] : 0;
    const start = parseInt(m[2], 10) * 12 + sm;
    let end;
    if (m[3]) end = today.getFullYear() * 12 + today.getMonth();
    else {
      const em = m[4] ? MONTHS[m[4].toLowerCase().slice(0, 3)] : 11;
      end = parseInt(m[5], 10) * 12 + em;
    }
    if (end >= start && start > 1950 * 12) ranges.push([start, end + 1]);
  }
  ranges.sort((a, b) => a[0] - b[0]);
  let months = 0, curS = null, curE = null;
  for (const [s, e] of ranges) {
    if (curE === null || s > curE) { if (curE !== null) months += curE - curS; curS = s; curE = e; }
    else curE = Math.max(curE, e);
  }
  if (curE !== null) months += curE - curS;
  return { years: Math.round((months / 12) * 10) / 10, ranges: ranges.length };
}

// ------------------------------------------------------------------ resume quality checks

const WEAK = ["responsible for", "worked on", "helped with", "helped to", "assisted with", "duties included", "tasked with", "involved in", "participated in", "various"];

export function resumeChecks(resume) {
  const lines = resume.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  let bullets = lines.filter((l) => /^[-•*●▪◦–]\s+/.test(l));
  if (bullets.length < 3) {
    // Pasted from a PDF the bullet symbols are often lost: fall back to lines that start with a past-tense verb.
    bullets = lines.filter((l) => /^[A-Z][a-z]+ed\b/.test(l) && l.split(/\s+/).length > 6);
  }
  const quantified = bullets.filter((b) => /\d/.test(b));
  const words = (resume.match(/\b\w+\b/g) || []).length;
  const checks = [];
  const add = (ok, title, detail) => checks.push({ ok, title, detail });

  add(/[\w.+-]+@[\w-]+\.[\w.]+/.test(resume), "Email address", "Recruiters need a way to reach you.");
  add(/(\+?\d[\d\s().-]{8,}\d)/.test(resume), "Phone number", "Many recruiters call first.");
  add(/linkedin\.com\/|linkedin/i.test(resume), "LinkedIn link", "Most recruiters check LinkedIn before calling.");
  add(words >= 300 && words <= 900, `Length: ${words} words`, words < 300 ? "Very short. Add projects, results and skills." : words > 900 ? "Long. For under 10 years of experience, aim for one page (about 400-800 words)." : "Good length for one page.");
  if (bullets.length >= 3) {
    const pct = Math.round((quantified.length / bullets.length) * 100);
    add(pct >= 40, `${pct}% of bullets include a number`, "Numbers make impact concrete: %, time saved, users, requests per second, dollars.");
  }
  const weakHits = WEAK.filter((w) => new RegExp(`\\b${w}\\b`, "i").test(resume));
  add(weakHits.length === 0, weakHits.length ? `Weak phrases: ${weakHits.map((w) => `"${w}"`).join(", ")}` : "No weak phrases", "Start bullets with what you did: built, designed, cut, shipped, automated.");
  const pron = (resume.match(/\b(I|me|my)\b/g) || []).length;
  add(pron <= 2, pron > 2 ? `First person used ${pron} times` : "Written without \"I\" and \"my\"", "Resumes usually drop \"I\" and \"my\".");
  return checks;
}

// ------------------------------------------------------------------ main entry

export function analyze(resume, jd, today = new Date()) {
  const job = jobSkills(jd);
  const have = findSkills(resume);

  let total = 0, got = 0;
  const matched = [], missing = [];
  for (const [name, s] of job) {
    total += s.weight;
    const item = { name, category: s.category, label: CATEGORY_LABELS[s.category], tag: s.tag, weight: s.weight, jdCount: s.count };
    if (have.has(name)) { got += s.weight; matched.push({ ...item, resumeCount: have.get(name).count }); }
    else missing.push(item);
  }
  const order = (a, b) => b.weight - a.weight || a.name.localeCompare(b.name);
  matched.sort(order); missing.sort(order);

  const skillScore = total ? got / total : 0;
  const textScore = similarity(resume, jd);
  // Text overlap between a resume and a job posting rarely passes 0.5, so scale it to a 0..1 range first.
  const textNorm = Math.min(textScore / 0.5, 1);
  const score = Math.round((job.size ? 0.75 * skillScore + 0.25 * textNorm : textNorm) * 100);

  const need = requiredYears(jd);
  const exp = resumeYears(resume, today);

  return {
    score,
    skillScore: Math.round(skillScore * 100),
    textScore: Math.round(textScore * 100),
    matched,
    missing,
    extraSkills: [...have.keys()].filter((k) => !job.has(k)).sort(),
    keywords: missingKeywords(resume, jd),
    experience: { required: need, found: exp.years, ranges: exp.ranges, meets: need === null ? null : exp.years >= need },
    checks: resumeChecks(resume),
  };
}
