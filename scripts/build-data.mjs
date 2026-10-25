// Builds site/data/schedule.json from public schedule sources.
// Each source is fetched independently; if one fails, the last published
// data for that series is kept so the app never loses a calendar.
import { writeFile, mkdir, appendFile } from "node:fs/promises";

const OUT = new URL("../site/data/schedule.json", import.meta.url);
const PREVIOUS_URL = process.env.PREVIOUS_URL || "";
const now = new Date();
const YEARS = [now.getUTCFullYear(), now.getUTCFullYear() + 1];
const UA = { "User-Agent": "Mozilla/5.0 (compatible; PitWallCalendar/1.0; personal use)" };

async function getJSON(url) {
  const r = await fetch(url, { headers: UA });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}
async function getText(url) {
  const r = await fetch(url, { headers: UA });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.text();
}
const iso = (s) => {
  const d = new Date(s);
  return isNaN(d) ? null : d.toISOString();
};

// ---- sportstimes/f1 community data (F1, F2, F3, MotoGP, IndyCar, FE, F1 Academy)
const ST_LABELS = {
  fp1: "Practice 1", fp2: "Practice 2", fp3: "Practice 3", practice: "Practice",
  practice1: "Practice 1", practice2: "Practice 2", practice3: "Practice 3", practice4: "Practice 4",
  practice5: "Practice 5", practice6: "Practice 6", practice7: "Practice 7", practice8: "Practice 8",
  FinalPractice: "Final practice", qualifying: "Qualifying", qualifying1: "Qualifying 1",
  qualifying2: "Qualifying 2", sprintQualifying: "Sprint qualifying", sprint: "Sprint",
  feature: "Feature race", gp: "Grand Prix", race: "Race", race1: "Race 1", race2: "Race 2",
  race3: "Race 3", warmup: "Warm-up",
};
const RACE_KEYS = new Set(["gp", "race", "feature", "sprint", "race1", "race2", "race3"]);
const ST_NAME = {
  f1: (n) => `${n} Grand Prix`,
  motogp: (n) => `${n} GP`,
  f2: (n) => `${n} round`, f3: (n) => `${n} round`, "f1-academy": (n) => `${n} round`,
};

async function sportstimes(id) {
  const events = [];
  for (const y of YEARS) {
    let d;
    try { d = await getJSON(`https://raw.githubusercontent.com/sportstimes/f1/main/_db/${id}/${y}.json`); }
    catch (e) { if (y === YEARS[0]) throw e; continue; } // next season often not published yet
    for (const r of d.races || []) {
      if (r.canceled || r.cancelled) continue;
      const sessions = Object.entries(r.sessions || {})
        .map(([k, v]) => ({ label: ST_LABELS[k] || k, start: iso(v), race: RACE_KEYS.has(k) }))
        .filter((s) => s.start);
      if (!sessions.length) continue;
      events.push({
        name: (ST_NAME[id] || ((n) => n))(r.name),
        place: id === "motogp" ? r.location || "" : [r.location].filter(Boolean).join(""),
        round: r.round, season: y, sessions,
      });
    }
  }
  return events;
}

// ---- MotoGP official API (Moto2 / Moto3)
const motogpSeason = new Map();
async function motogpEvents(year) {
  if (!motogpSeason.has(year)) {
    motogpSeason.set(year, getJSON(`https://api.pulselive.motogp.com/motogp/v1/events?seasonYear=${year}`).catch(() => []));
  }
  return motogpSeason.get(year);
}
async function dorna(acronym) {
  const events = [];
  for (const y of YEARS) {
    const list = (await motogpEvents(y)) || [];
    const gps = list.filter((e) => e.kind === "GP").sort((a, b) => (a.date_start || "").localeCompare(b.date_start || ""));
    gps.forEach((e, i) => {
      const bs = (e.broadcasts || []).filter((b) => b.category?.acronym === acronym && b.date_start && !["PRESS", "WARM_UP"].includes(b.kind));
      const sessions = bs
        .map((b) => {
          const sn = (b.shortname || "").toUpperCase();
          let label = b.name || sn;
          if (sn === "FP1") label = "Practice 1";
          else if (sn === "FP2") label = "Practice 2";
          else if (sn === "PR") label = "Practice";
          else if (sn === "Q1") label = "Qualifying 1";
          else if (sn === "Q2") label = "Qualifying 2";
          else if (sn === "SPR") label = "Sprint";
          else if (sn === "RAC") label = "Race";
          return { label, start: iso(b.date_start), race: b.kind === "RACE" };
        })
        .filter((s) => s.start)
        .sort((a, b) => a.start.localeCompare(b.start));
      if (!sessions.length) return;
      const nm = (e.name || e.shortname || "").replace(/\s+/g, " ").trim();
      events.push({ name: titleCase(nm), place: e.circuit?.name || "", round: i + 1, season: y, sessions });
    });
  }
  if (!events.length) {
    const seen = new Set();
    for (const y of YEARS) for (const e of (await motogpEvents(y)) || []) for (const b of e.broadcasts || []) if (b.category?.acronym) seen.add(b.category.acronym);
    throw new Error(`no ${acronym} sessions (categories in feed: ${[...seen].join(", ")})`);
  }
  return events;
}
function titleCase(s) {
  return s === s.toUpperCase() ? s.toLowerCase().replace(/\b\p{L}/gu, (c) => c.toUpperCase()).replace(/\bGp\b/g, "GP").replace(/\b(Of|De|Del|Di)\b/g, (w) => w.toLowerCase()) : s;
}

// ---- ACO sites: FIA WEC and ELMS (schema.org JSON-LD on each race page)
async function aco(base) {
  const events = [];
  const seenSlugs = new Set();
  for (const y of YEARS) {
    let html;
    try { html = await getText(`${base}/en/season/${y}`); } catch (e) { if (y === YEARS[0]) throw e; continue; }
    const slugs = [...new Set([...html.matchAll(/\/en\/race\/([a-z0-9-]+)/g)].map((m) => m[1]))]
      .filter((s) => (base.includes("fiawec") ? s.endsWith(`-${y}`) : true) && !/prologue|official-test|collective-test|test-days?/.test(s));
    let round = 0;
    for (const slug of slugs) {
      round++;
      if (seenSlugs.has(slug)) continue;
      seenSlugs.add(slug);
      let page;
      try { page = await getText(`${base}/en/race/${slug}`); } catch { continue; }
      const blocks = [...page.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/g)];
      let ev = null;
      for (const b of blocks) {
        try {
          const j = JSON.parse(b[1].trim());
          const cand = [j, ...(j["@graph"] || [])].find((x) => x && x.subEvent);
          if (cand) { ev = cand; break; }
        } catch {}
      }
      if (!ev) continue;
      const fullName = String(ev.name || slug).trim();
      const name = fullName.replace(/^(FIA\s+)?(WEC|ELMS)\s*[-–]?\s*/i, "").replace(/\s+\d{4}$/, "").trim();
      const sessions = [].concat(ev.subEvent || [])
        .map((s) => {
          // "Qualifying - LMGT3 - 6 Hours of Monza 2026" -> "Qualifying - LMGT3"
          const parts = String(s.name || "").split(" - ").map((x) => x.trim());
          if (parts.length > 1 && (parts.at(-1) === fullName || parts.at(-1).replace(/\s+\d{4}$/, "") === name)) parts.pop();
          const label = parts.join(" · ").replace(/HYPERCAR/g, "Hypercar");
          return { label: label.replace(/^Qualifying session/i, "Qualifying"), start: iso(s.startDate), race: /^race/i.test(label) };
        })
        .filter((s) => s.start && s.label)
        .sort((a, b) => a.start.localeCompare(b.start));
      if (!sessions.length) continue;
      events.push({ name, place: ev.location?.name || "", round, season: +(slug.match(/(20\d\d)$/) || [])[1] || y, sessions });
    }
  }
  if (!events.length) throw new Error(`no events parsed from ${base}`);
  return events;
}

// ---- SRO sites: GT World Challenge Europe (HTML timetable on each event page)
const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
const strip = (s) => s.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
const hm = (s) => { const m = s.match(/(\d{1,2})[:.h](\d{2})/); return m ? +m[1] * 60 + +m[2] : null; };
async function sro(base) {
  const html = await getText(`${base}/calendar`);
  // Each championship round has a "Round N" label near its /event/ link.
  const rounds = new Map();
  for (const m of html.matchAll(/Round\s+(\d+)/g)) {
    const after = html.slice(m.index, m.index + 4000);
    const before = html.slice(Math.max(0, m.index - 4000), m.index);
    const link = (after.match(/href="([^"]*\/event\/[^"]+)"/) || [...before.matchAll(/href="([^"]*\/event\/[^"]+)"/g)].pop() || [])[1];
    if (!link) continue;
    const url = link.startsWith("http") ? link : base + link;
    if (!rounds.has(url) || rounds.get(url) > +m[1]) rounds.set(url, +m[1]);
  }
  const events = [];
  for (const [url, round] of [...rounds].sort((a, b) => a[1] - b[1])) {
    let page;
    try { page = await getText(url); } catch { continue; }
    const name = strip((page.match(/class="[^"]*feature__heading[^"]*"[^>]*>([\s\S]*?)<\//) || [])[1] || "") || url.split("/").pop();
    const year = +((page.match(/20\d\d/) || [])[0] || now.getUTCFullYear());
    const sessions = [];
    for (const c of page.split(/class="[^"]*timetable__container/).slice(1)) {
      const cap = strip((c.match(/class="[^"]*timetable__caption[^"]*"[^>]*>([\s\S]*?)<\/(?:caption|div|h\d|span|p)>/) || [])[1] || "");
      const dm = cap.match(/(\d{1,2})\s+([A-Za-z]{3})/);
      if (!dm || MONTHS[dm[2].toLowerCase()] == null) continue;
      const day = +dm[1], mon = MONTHS[dm[2].toLowerCase()];
      for (const row of c.split(/<tr/).slice(1)) {
        const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((x) => strip(x[1]));
        if (cells.length < 3) continue;
        const [label, local, gmt] = cells;
        const lt = hm(local), gt = hm(gmt);
        if (!label || lt == null || gt == null) continue;
        if (/test|parade|pit ?walk|autograph|warm|pre-qual|grid walk|podium|press/i.test(label)) continue;
        let off = lt - gt; if (off > 720) off -= 1440; if (off < -720) off += 1440;
        const start = new Date(Date.UTC(year, mon, day, 0, lt) - off * 60000);
        sessions.push({ label, start: start.toISOString(), race: /^(main\s+)?race(\s*\d+)?$/i.test(label) || /hours? race$/i.test(label) });
      }
    }
    if (!sessions.length) continue;
    sessions.sort((a, b) => a.start.localeCompare(b.start));
    events.push({ name, place: "", round, season: year, sessions });
  }
  if (!events.length) throw new Error(`no events parsed from ${base}`);
  return events;
}

// ---- NASCAR public schedule feed
async function nascar(seriesKey) {
  const events = [];
  for (const y of YEARS) {
    let d;
    try { d = await getJSON(`https://cf.nascar.com/cacher/${y}/race_list_basic.json`); } catch (e) { if (y === YEARS[0]) throw e; continue; }
    const races = (d[seriesKey] || []).filter((r) => r.race_type_id === 1 || r.race_type_id == null);
    races.sort((a, b) => String(a.date_scheduled).localeCompare(String(b.date_scheduled)));
    races.forEach((r, i) => {
      const utc = (t) => iso(/[zZ]|[+-]\d\d:?\d\d$/.test(t) ? t : `${t}Z`);
      let sessions = (r.schedule || [])
        .filter((s) => [1, 2, 3].includes(s.run_type) && s.start_time_utc)
        .map((s) => ({ label: s.event_name.replace(/\s*\(.*?\)\s*/g, " ").trim(), start: utc(s.start_time_utc), race: s.run_type === 3 }))
        .filter((s) => s.start);
      if (!sessions.length && r.race_date) sessions = [{ label: "Race", start: utc(r.race_date), race: true }];
      if (!sessions.length) return;
      events.push({ name: r.race_name, place: r.track_name || "", round: i + 1, season: y, sessions });
    });
  }
  if (!events.length) throw new Error("no NASCAR races");
  return events;
}

const SOURCES = {
  f1: () => sportstimes("f1"),
  f2: () => sportstimes("f2"),
  f3: () => sportstimes("f3"),
  motogp: () => sportstimes("motogp"),
  moto2: () => dorna("MT2"),
  moto3: () => dorna("MT3"),
  wec: () => aco("https://www.fiawec.com"),
  gtwce: () => sro("https://www.gt-world-challenge-europe.com"),
  indycar: () => sportstimes("indycar"),
  fe: () => sportstimes("fe"),
  "f1-academy": () => sportstimes("f1-academy"),
  nascar: () => nascar("series_1"),
  "nascar-oreilly": () => nascar("series_2"),
  elms: () => aco("https://www.europeanlemansseries.com"),
  motoe: () => dorna("MTE"),
};

let previous = {};
if (PREVIOUS_URL) {
  try { previous = (await getJSON(PREVIOUS_URL)).series || {}; console.log("Loaded previous data"); }
  catch (e) { console.log("No previous data:", e.message); }
}

const series = {};
let failures = 0;
for (const [id, fn] of Object.entries(SOURCES)) {
  try {
    const events = await fn();
    series[id] = { updated: now.toISOString(), events };
    console.log(`ok   ${id}: ${events.length} events, ${events.reduce((n, e) => n + e.sessions.length, 0)} sessions`);
    const next = events.find((e) => e.sessions.some((s) => s.start > now.toISOString()));
    if (next) console.log(`       next: ${next.name} (${next.place}) · ${next.sessions.map((s) => `${s.label}${s.race ? "*" : ""} ${s.start.slice(5, 16)}`).join(" | ")}`);
  } catch (e) {
    failures++;
    if (previous[id]) {
      series[id] = { ...previous[id], stale: true };
      console.log(`keep ${id}: ${e.message} (using last published data)`);
    } else {
      console.log(`fail ${id}: ${e.message}`);
    }
  }
}

await mkdir(new URL("../site/data/", import.meta.url), { recursive: true });
await writeFile(OUT, JSON.stringify({ generated: now.toISOString(), series }));
console.log(`Wrote schedule.json (${failures} source(s) failed)`);
// The workflow publishes first, then fails the run if any source broke, so GitHub emails the owner.
if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `failures=${failures}\n`);
