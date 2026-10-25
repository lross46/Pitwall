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
        .map(([k, v]) => ({ label: ST_LABELS[k] || k, start: iso(v), race: RACE_KEYS.has(k), key: k }))
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
const CAT = { MGP: "MotoGP", MT2: "Moto2", MT3: "Moto3" };
async function dorna(acronym) {
  const events = [];
  for (const y of YEARS) {
    const list = (await motogpEvents(y)) || [];
    const gps = list.filter((e) => e.kind === "GP").sort((a, b) => (a.date_start || "").localeCompare(b.date_start || ""));
    gps.forEach((e, i) => {
      const code = String(e.short_name || e.shortname || "").toUpperCase();
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
          const url = code && sn ? `https://www.motogp.com/en/gp-results/${y}/${code}/${CAT[acronym]}/${sn}/classification`.toLowerCase() : undefined;
          return { label, start: iso(b.date_start), race: b.kind === "RACE", url };
        })
        .filter((s) => s.start)
        .sort((a, b) => a.start.localeCompare(b.start));
      if (!sessions.length) return;
      const nm = (e.name || e.shortname || "").replace(/\s+/g, " ").trim();
      const url = code ? `https://www.motogp.com/en/gp-results/${y}/${code}/${CAT[acronym]}/rac/classification`.toLowerCase() : undefined;
      events.push({ name: titleCase(nm), place: e.circuit?.name || "", round: i + 1, season: y, url, sessions });
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
  if (s !== s.toUpperCase()) return s;
  // Keep short sponsor acronyms (e.g. "PT Grand Prix of Thailand") and "GP" in capitals.
  return s.split(" ").map((w, i) => {
    if (i > 0 && /^(OF|DE|DEL|DI|THE)$/.test(w)) return w.toLowerCase();
    if (w === "GP" || (i === 0 && /^[A-Z]{2}$/.test(w))) return w;
    return w.toLowerCase().replace(/(^|[-'])\p{L}/gu, (c) => c.toUpperCase());
  }).join(" ");
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
      events.push({ name, place: ev.location?.name || "", round, season: +(slug.match(/(20\d\d)$/) || [])[1] || y, url: `${base}/en/race/${slug}`, sessions });
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
    events.push({ name, place: "", round, season: year, url, sessions });
  }
  if (!events.length) throw new Error(`no events parsed from ${base}`);
  return events;
}

// ---- Time zone helper: wall-clock time in an IANA zone -> UTC Date
function zonedToUtc(y, mo, d, h, mi, tz) {
  const guess = Date.UTC(y, mo, d, h, mi);
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric" })
    .formatToParts(new Date(guess)).map((p) => [p.type, +p.value]));
  const asZone = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
  return new Date(guess - (asZone - guess));
}

// ---- Indy NXT official site (server-rendered weekend schedule on each event page)
async function indynxt() {
  const events = [];
  for (const y of YEARS) {
    let html;
    try { html = await getText(`https://www.indynxt.com/schedule?year=${y}`); } catch (e) { if (y === YEARS[0]) throw e; continue; }
    const urls = [...new Set([...html.matchAll(new RegExp(`https://www\\.indynxt\\.com/Schedule/${y}/[A-Za-z0-9-]+`, "g"))].map((m) => m[0]))];
    let round = 0;
    for (const url of urls) {
      round++;
      let page;
      try { page = await getText(url); } catch { continue; }
      const name = strip((page.match(/<title[^>]*>([^<|]*)/) || [])[1] || url.split("/").pop());
      const table = page.split('class="schedule-table"')[1] || "";
      const sessions = [];
      let day = null;
      for (const chunk of table.split(/(?=<h3>)|(?=class="schedule-entry")/)) {
        const h = chunk.match(/^<h3>[A-Za-z]+,\s*([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2})<\/h3>/);
        if (h) { day = { mon: MONTHS[h[1].toLowerCase()], d: +h[2] }; continue; }
        if (!day || day.mon == null) continue;
        const tm = chunk.match(/class="schedule-time">\s*(\d{1,2}):(\d{2})\s*([AP]M)\s*ET/i);
        const desc = strip((chunk.match(/class="schedule-description">([\s\S]*?)<\/div>/) || [])[1] || "");
        if (!tm || !/indy\s*nxt/i.test(desc)) continue;
        let hh = +tm[1] % 12; if (/pm/i.test(tm[3])) hh += 12;
        const label = desc.replace(/^INDY NXT\s*-\s*/i, "").trim();
        sessions.push({ label, start: zonedToUtc(y, day.mon, day.d, hh, +tm[2], "America/New_York").toISOString(), race: /^race/i.test(label) });
      }
      if (!sessions.length) continue;
      events.push({ name: name.replace(/\s*-\s*INDY NXT.*$/i, "").trim(), place: "", round, season: y, url, sessions });
    }
  }
  if (!events.length) throw new Error("no Indy NXT events parsed");
  return events;
}

// ---- Supercars official site (session list embedded in each event's schedule page)
async function supercars() {
  const slugs = new Set();
  for (const tab of ["", "?tab=PAST"]) {
    try {
      const html = await getText(`https://www.supercars.com/calendar${tab}`);
      for (const m of html.matchAll(/\/events\/(20\d\d-[a-z0-9-]+)/g)) if (YEARS.includes(+m[1].slice(0, 4))) slugs.add(m[1]);
    } catch (e) { if (!tab) throw e; }
  }
  const events = [];
  const seriesSeen = new Set();
  console.log(`     supercars: ${slugs.size} event pages`);
  for (const slug of [...slugs].sort()) {
    let page;
    try { page = (await getText(`https://www.supercars.com/events/${slug}/schedule`)).replace(/\\"/g, '"'); } catch { continue; }
    const name = strip((page.match(/<title[^>]*>([^<|]*)/) || [])[1] || slug).replace(/\s*Schedule\s*$/i, "").trim();
    const sessions = [];
    const seen = new Set();
    for (const m of page.matchAll(/"name":"([^"]+)","startDate":"([^"]+)","type":"([^"]*)","natsoftEventCode":(?:null|"[^"]*"),"season":\{[^}]*\},"series":\{"name":"([^"]+)"/g)) {
      const [, label, startDate, type, series] = m;
      seriesSeen.add(series);
      if (!/supercars/i.test(series) || /super\s*[23]|super2|super3/i.test(series)) continue;
      if (!/practice|qualif|shootout|race|top ?10|warm/i.test(type + " " + label)) continue;
      const start = iso(startDate);
      if (!start || seen.has(start + label)) continue;
      seen.add(start + label);
      sessions.push({ label, start, race: /^race/i.test(type) || /^race/i.test(label) });
    }
    if (!sessions.length) continue;
    sessions.sort((a, b) => a.start.localeCompare(b.start));
    events.push({ name, place: "", round: events.length + 1, season: +slug.slice(0, 4), url: `https://www.supercars.com/events/${slug}`, sessions });
  }
  console.log(`     supercars series seen: ${[...seriesSeen].join(", ")}`);
  if (!events.length) throw new Error("no Supercars events parsed");
  return events;
}

// ---- WRC official calendar (rally start time and date range; stage times aren't published in a readable form)
async function wrc() {
  const events = [];
  for (const y of YEARS) {
    let html;
    try { html = await getText(`https://www.wrc.com/en/calendar/wrc-${y}`); } catch (e) { if (y === YEARS[0]) throw e; continue; }
    const cards = html.split(/(?=href="\/en\/events\/)/).slice(1);
    let round = 0;
    const seen = new Set();
    for (const c of cards) {
      const slug = (c.match(/^href="\/en\/events\/([a-z0-9-]+)"/) || [])[1];
      const dt = (c.match(/<time[^>]*datetime="([^"]+)"[^>]*>([^<]*)<\/time>/) || []);
      if (!slug || !dt[1] || seen.has(slug) || !slug.endsWith(String(y))) continue;
      seen.add(slug);
      round++;
      const start = new Date(dt[1]);
      const off = (dt[1].match(/([+-])(\d\d):(\d\d)$/) || []);
      const offMin = off.length ? (off[1] === "-" ? -1 : 1) * (+off[2] * 60 + +off[3]) : 0;
      const endDay = +((dt[2].match(/(\d{1,2})\s+[A-Za-z]+\s+20\d\d\s*$/) || [])[1] || 0);
      const name = slug.replace(/^wrc-/, "").replace(/-20\d\d$/, "").split("-").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
      const sessions = [{ label: "Rally starts", start: start.toISOString(), race: false }];
      // One all-day entry per remaining rally day, anchored to local noon.
      const local = new Date(start.getTime() + offMin * 60000);
      for (let i = 1; i <= 4; i++) {
        const d = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + i, 12) - offMin * 60000);
        const dLocal = new Date(d.getTime() + offMin * 60000).getUTCDate();
        sessions.push({ label: `Rally day ${i + 1}`, start: d.toISOString(), race: dLocal === endDay, allDay: true });
        if (dLocal === endDay || !endDay) break;
      }
      events.push({ name, place: "", round, season: y, url: `https://www.wrc.com/en/events/${slug}`, sessions });
    }
  }
  if (!events.length) throw new Error("no WRC events parsed");
  return events;
}

// ---- Wikipedia season articles (race dates only) for series whose official sites
// block automated access or don't publish session times in a readable form.
const MONTH_NAMES = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
async function wikiRaw(title, depth = 0) {
  const txt = await getText(`https://en.wikipedia.org/w/index.php?title=${encodeURIComponent(title.replace(/ /g, "_"))}&action=raw`);
  const redirect = txt.match(/^#REDIRECT\s*\[\[([^\]|#]+)/i);
  return redirect && depth < 2 ? wikiRaw(redirect[1], depth + 1) : txt;
}
function wikiDates(cell, year) {
  const c = cell.replace(/&nbsp;/g, " ").replace(/\{\{nowrap\|([^}]*)\}\}/gi, "$1");
  const mo = "(january|february|march|april|may|june|july|august|september|october|november|december)";
  let m = c.match(new RegExp(`(\\d{1,2})\\s*${mo}?\\s*[–-]\\s*(\\d{1,2})\\s+${mo}`, "i")); // "18–19 April", "30 April–1 May"
  if (m) {
    const m2 = MONTH_NAMES.indexOf(m[4].toLowerCase()), m1 = m[2] ? MONTH_NAMES.indexOf(m[2].toLowerCase()) : m2;
    return [[m1, +m[1]], [m2, +m[3]]];
  }
  m = c.match(new RegExp(`${mo}\\s+(\\d{1,2})\\s*[–-]\\s*(?:${mo}\\s+)?(\\d{1,2})`, "i")); // "January 24–25"
  if (m) {
    const m1 = MONTH_NAMES.indexOf(m[1].toLowerCase()), m2 = m[3] ? MONTH_NAMES.indexOf(m[3].toLowerCase()) : m1;
    return [[m1, +m[2]], [m2, +m[4]]];
  }
  m = c.match(new RegExp(`(\\d{1,2})\\s+${mo}|${mo}\\s+(\\d{1,2})`, "i"));
  if (m) return m[1] ? [[MONTH_NAMES.indexOf(m[2].toLowerCase()), +m[1]]] : [[MONTH_NAMES.indexOf(m[3].toLowerCase()), +m[4]]];
  return null;
}
async function wiki(titleFor) {
  const events = [];
  for (const y of YEARS) {
    let txt;
    try { txt = await wikiRaw(titleFor(y)); } catch (e) { if (y === YEARS[0]) throw e; continue; }
    const sec = txt.split(/\n==\s*(?:Race calendar|Calendar|Schedule)[^=\n]*==/i)[1];
    if (!sec) { if (y === YEARS[0]) throw new Error(`no calendar section in ${titleFor(y)}`); continue; }
    const table = (sec.match(/\{\|[\s\S]*?\n\|\}/) || [])[0] || "";
    const days = []; // {circuit, date}
    let lastCircuit = "";
    for (const row of table.split(/\n\|-/).slice(1)) {
      const links = [...row.matchAll(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g)]
        .map((l) => ({ target: l[1], text: (l[2] || l[1]).trim() }))
        .filter((l) => !/^(File|Image):/i.test(l.target) && !/championship|series|grand prix\b$/i.test(l.target) || /circuit|raceway|speedway|park|ring|international|autodromo|motorsport|street/i.test(l.target));
      const circuit = (links.find((l) => /circuit|raceway|speedway|park|ring|autodromo|motegi|suzuka|fuji|sugo|autopolis|knockhill|thruxton|croft|silverstone|brands|snetterton|donington|daytona|sebring|laguna|watkins|lime rock|road america|road atlanta|indianapolis|detroit|long beach|island|assen|aragón|aragon|jerez|estoril|portim|misano|most|cremona|magny|balaton|imola|zandvoort|spa|hockenheim|nürburgring|nurburgring|lausitz|sachsenring|norisring|oschersleben|salzburg|red bull/i.test(l.target + " " + l.text)) || {}).text || "";
      if (circuit) lastCircuit = circuit;
      const cells = row.split(/\n[|!]|\|\|/);
      let dates = null;
      for (const cell of cells) { if (/\[\[|\{\{flag/i.test(cell) && !/\d{1,2}\s*[A-Z]/.test(cell)) continue; dates = wikiDates(cell.replace(/<ref[\s\S]*?(<\/ref>|\/>)/g, ""), y); if (dates) break; }
      if (!dates || !(circuit || lastCircuit)) continue;
      const [[m1, d1], [m2, d2] = [m1, d1]] = dates;
      if (m1 < 0 || m2 < 0) continue;
      for (let dt = Date.UTC(y, m1, d1); dt <= Date.UTC(y, m2, d2); dt += 864e5) days.push({ circuit: circuit || lastCircuit, date: dt });
    }
    // Group consecutive days at the same circuit into one race weekend.
    days.sort((a, b) => a.date - b.date);
    const seen = new Set();
    let cur = null, round = 0;
    for (const d of days) {
      if (seen.has(d.date)) continue;
      seen.add(d.date);
      if (!cur || cur.circuit !== d.circuit || d.date - cur.last > 3 * 864e5) {
        cur = { circuit: d.circuit, last: d.date, ev: { name: d.circuit, place: "", round: ++round, season: y, sessions: [] } };
        events.push(cur.ev);
      }
      cur.last = d.date;
      cur.ev.sessions.push({ label: "Race weekend", start: new Date(d.date + 12 * 36e5).toISOString(), race: false, allDay: true });
    }
  }
  for (const e of events) { const last = e.sessions.at(-1); last.race = true; last.label = e.sessions.length > 1 ? "Race day" : "Race day"; }
  if (!events.length) throw new Error("no dates parsed from Wikipedia");
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

// ---- Super Formula official race pages (Japanese timetable, times in JST)
const SF_LABEL = (t) => t
  .replace(/フリー走行\s*\(?FP(\d)\)?/, "Practice $1").replace(/フリー走行/, "Practice")
  .replace(/予選\s*/, "Qualifying ").replace(/Gr\.\s*([AB])/, "Group $1")
  .replace(/決勝レース|決勝/, "Race").replace(/\s+/g, " ").trim();
async function superformula() {
  const events = [];
  for (const y of YEARS) {
    let list;
    try { list = await getText(`https://superformula.net/sf3/race_taxonomy/${y}`); } catch (e) { if (y === YEARS[0]) throw e; continue; }
    const ids = [...new Set([...list.matchAll(/<li>\s*<a href="https:\/\/superformula\.net\/sf3\/race\/(\d+)\/"/g)].map((m) => m[1]))];
    for (const id of ids) {
      const url = `https://superformula.net/sf3/race/${id}/`;
      let page;
      try { page = await getText(url); } catch { continue; }
      const title = strip((page.match(/<title>([^<｜|]*)/) || [])[1] || "");
      if (!/Rd\./.test(title) || /test/i.test(title)) continue;
      const block = (page.match(/table_time_schedule[\s\S]*?(?=<span class="ank"|race_detail01_block03)/) || [])[0] || "";
      const sessions = [];
      for (const t of block.matchAll(/<caption>\s*(\d{1,2})\.(\d{1,2})[\s\S]*?<\/caption>([\s\S]*?)<\/table>/g)) {
        const [, mo, d, rows] = t;
        for (const r of rows.matchAll(/<th>\s*(\d{1,2}):(\d\d)[^<]*<\/th>\s*<td>([^<]+)<\/td>/g)) {
          if (!/フリー走行|予選|決勝/.test(r[3])) continue;
          const start = new Date(Date.UTC(y, +mo - 1, +d, +r[1] - 9, +r[2])).toISOString();
          sessions.push({ label: SF_LABEL(r[3]), start, race: /決勝/.test(r[3]) });
        }
      }
      if (!sessions.length) continue;
      sessions.sort((a, b) => a.start.localeCompare(b.start));
      const m = title.match(/Rd\.([\d.&\s-]+?)\s+(.+)$/) || [];
      const round = +(String(m[1] || "").match(/\d+/) || [events.length + 1])[0];
      const venue = titleCase((m[2] || title).trim());
      events.push({ name: venue, place: venue, round, season: y, url, sessions });
    }
  }
  if (!events.length) throw new Error("no Super Formula timetables parsed");
  return events;
}

// ---- DTM official API (same data the dtm.com event pages use)
async function dtm() {
  const list = (await getJSON("https://api.dtm.com/data?query=events")).events || [];
  const events = [];
  for (const y of YEARS) {
    const evs = list.filter((e) => String(e.startTime || "").startsWith(String(y))).sort((a, b) => a.startTime.localeCompare(b.startTime));
    let round = 0;
    for (const e of evs) {
      round++;
      let d;
      try { d = await getJSON(`https://api.dtm.com/data?query=eventDetails&slug=${encodeURIComponent(e.slug)}`); } catch { d = null; }
      const ev = d?.event || d?.eventDetails || d || {};
      const tt = (ev.timetable || []).filter((t) => t.raceSeries === "DTM" && t.start);
      const sessions = tt.map((t) => ({ label: String(t.label || "").trim(), start: iso(t.start), race: /^(race|rennen)/i.test(t.label || "") })).filter((s) => s.start && s.label);
      const url = `https://www.dtm.com/en/events/${e.slug}`;
      if (!sessions.length) {
        // Timetable not published yet: show the weekend as dates only.
        const a = new Date(e.startTime), b = new Date(e.endTime || e.startTime);
        for (let t = Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate(), 12); t <= b.getTime() + 12 * 36e5; t += 864e5)
          sessions.push({ label: "Race weekend", start: new Date(t).toISOString(), race: false, allDay: true });
        if (sessions.length) { sessions.at(-1).label = "Race day"; sessions.at(-1).race = true; }
      }
      if (!sessions.length) continue;
      events.push({ name: String(e.name || e.slug).replace(/\s+powered by.*$|\s+by\s+[A-Z].*$/i, "").trim(), place: ev.city || "", round, season: y, url, sessions });
    }
  }
  if (!events.length) throw new Error("no DTM events in api.dtm.com");
  return events;
}

// ---- WorldSBK official API (public endpoint behind worldsbk.com's event pages)
async function wsbk() {
  const API = "https://api.wsbk.pulselive.com/wsbk-events/v1";
  const events = [];
  for (const y of YEARS) {
    let rounds;
    try { rounds = (await getJSON(`${API}/seasons/${y}/rounds`)).data || []; } catch (e) { if (y === YEARS[0]) throw e; continue; }
    rounds = rounds.filter((r) => !/test/i.test(`${r.attributes?.description} ${r.attributes?.name}`)).sort((a, b) => (a.attributes.sequence_order ?? 99) - (b.attributes.sequence_order ?? 99));
    let round = 0;
    for (const r of rounds) {
      round++;
      const code = r.attributes.source_id;
      let list = [];
      try { list = (await getJSON(`${API}/seasons/${y}/rounds/${code}/sessions`)).data || []; } catch { list = []; }
      const sessions = list
        .filter((x) => x.relationships?.category?.data?.id === "SBK" && x.attributes?.start_date_utc)
        .map((x) => ({ label: x.attributes.brief_description || x.attributes.description, start: iso(x.attributes.start_date_utc), race: /^(RC\d|SPRC)$/.test(x.attributes.short_name || "") }))
        .filter((x) => x.start)
        .sort((a, b) => a.start.localeCompare(b.start));
      if (!sessions.length) continue;
      events.push({ name: r.attributes.description || r.attributes.name, place: r.attributes.name || "", round, season: y, url: `https://www.worldsbk.com/en/calendar/event/${y}-${code}`, sessions });
    }
  }
  if (!events.length) throw new Error("no WorldSBK sessions in the API");
  return events;
}

// Official source first; fill in any rounds it doesn't cover (e.g. next year's dates) from a fallback.
async function withFallback(primary, fallback) {
  let main = [];
  try { main = await primary(); } catch (e) { console.log(`     primary source failed, using fallback only: ${e.message}`); }
  let extra = [];
  try { extra = await fallback(); } catch (e) { if (!main.length) throw e; }
  const days = main.flatMap((e) => e.sessions.map((s) => Date.parse(s.start)));
  const covered = (ev) => ev.sessions.some((s) => days.some((d) => Math.abs(d - Date.parse(s.start)) < 3 * 864e5));
  const out = [...main, ...extra.filter((ev) => !covered(ev))];
  out.sort((a, b) => a.sessions[0].start.localeCompare(b.sessions[0].start));
  return out;
}

// ---- Official results pages for series whose schedule comes from sportstimes.
// Each listing page links rounds in calendar order, so link N belongs to round N.
async function roundLinks(url, re) {
  try { return [...new Set([...(await getText(url)).matchAll(re)].map((m) => m[0]))]; }
  catch (e) { console.log(`     results links unavailable: ${e.message}`); return []; }
}
const F1_SESSION = { fp1: "practice/1", fp2: "practice/2", fp3: "practice/3", qualifying: "qualifying", sprintQualifying: "sprint-qualifying", sprint: "sprint-results", gp: "race-result" };
const FE_SESSION = { fp1: "free-practice-1", fp2: "free-practice-2", fp3: "free-practice-3", qualifying: "qualifying", race: "race", race1: "race", race2: "race" };
async function withResults(id, events) {
  for (const y of YEARS) {
    const evs = events.filter((e) => e.season === y);
    if (!evs.length) continue;
    if (id === "f1") {
      const links = await roundLinks(`https://www.formula1.com/en/results/${y}/races`, new RegExp(`/en/results/${y}/races/\\d+/[a-z0-9-]+(?=/race-result)`, "g"));
      links.forEach((l, i) => {
        const ev = evs.find((e) => e.round === i + 1);
        if (!ev) return;
        const base = `https://www.formula1.com${l}`;
        ev.url = `${base}/race-result`;
        for (const s of ev.sessions) if (F1_SESSION[s.key]) s.url = `${base}/${F1_SESSION[s.key]}`;
      });
    } else if (id === "f2" || id === "f3") {
      const host = id === "f2" ? "https://www.fiaformula2.com" : "https://www.fiaformula3.com";
      const links = await roundLinks(`${host}/Calendar`, new RegExp(`/en/racing/${y}/[a-z0-9-]+`, "g"));
      // The calendar isn't in round order, so match each link's slug to the event's location or name.
      const slug = (t) => String(t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      for (const l of links) {
        const sl = l.split("/").pop();
        const ev = evs.find((e) => [e.place, e.name.replace(/\s+round$/i, "")].some((t) => slug(t) === sl));
        if (ev) ev.url = host + l;
      }
    } else if (id === "fe") {
      const links = await roundLinks("https://www.fiaformulae.com/en/results", /results-and-standings\?season=\d+&(?:amp;)?round=\d+-[a-z0-9-]+/g);
      const seasons = links.map((l) => +l.match(/season=(\d+)/)[1]);
      const cur = Math.max(0, ...seasons);
      for (const l of links) {
        const m = l.replace("&amp;", "&").match(/season=(\d+)&round=(\d+)-/);
        if (!m || +m[1] !== cur) continue;
        const ev = evs.find((e) => e.round === +m[2]);
        if (!ev) continue;
        ev.url = `https://www.fiaformulae.com/en/${l.replace("&amp;", "&")}`;
        for (const s of ev.sessions) if (FE_SESSION[s.key]) s.url = `${ev.url}&session=${FE_SESSION[s.key]}`;
      }
    } else if (id === "f1-academy" && y === new Date().getUTCFullYear()) {
      // The calendar only lists the current season; race ids rise with the round (a countdown banner repeats one, so sort).
      const ids = (await roundLinks("https://www.f1academy.com/Racing-Series/Calendar", /Results\?raceid=(\d+)/g)).map((l) => +l.split("=")[1]).sort((a, b) => a - b);
      if (ids.length === evs.length) ids.forEach((n, i) => {
        const ev = evs.find((e) => e.round === i + 1);
        if (ev) ev.url = `https://www.f1academy.com/Racing-Series/Results?raceid=${n}`;
      });
      else console.log(`     f1-academy: ${ids.length} result ids for ${evs.length} events, skipped`);
    }
  }
  for (const e of events) for (const s of e.sessions) delete s.key;
  return events;
}

const SOURCES = {
  f1: async () => withResults("f1", await sportstimes("f1")),
  f2: async () => withResults("f2", await sportstimes("f2")),
  f3: async () => withResults("f3", await sportstimes("f3")),
  motogp: () => dorna("MGP"),
  moto2: () => dorna("MT2"),
  moto3: () => dorna("MT3"),
  wec: () => aco("https://www.fiawec.com"),
  gtwce: () => sro("https://www.gt-world-challenge-europe.com"),
  indycar: async () => withResults("indycar", await sportstimes("indycar")),
  fe: async () => withResults("fe", await sportstimes("fe")),
  "f1-academy": async () => withResults("f1-academy", await sportstimes("f1-academy")),
  nascar: () => nascar("series_1"),
  "nascar-oreilly": () => nascar("series_2"),
  elms: () => aco("https://www.europeanlemansseries.com"),
  indynxt: () => indynxt(),
  supercars: () => supercars(),
  wrc: () => wrc(),
  wsbk: () => withFallback(wsbk, () => wiki((y) => `${y} Superbike World Championship`)),
  imsa: () => wiki((y) => `${y} IMSA SportsCar Championship`),
  btcc: () => wiki((y) => `${y} British Touring Car Championship`),
  dtm: () => withFallback(dtm, () => wiki((y) => `${y} DTM`)),
  superformula: () => withFallback(superformula, () => wiki((y) => `${y} Super Formula Championship`)),
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
    const linked = events.filter((e) => e.url).length, sLinked = events.reduce((n, e) => n + e.sessions.filter((s) => s.url).length, 0);
    console.log(`ok   ${id}: ${events.length} events, ${events.reduce((n, e) => n + e.sessions.length, 0)} sessions, results links: ${linked} events/${sLinked} sessions`);
    const sample = events.find((e) => e.url);
    if (sample) console.log(`       link: R${sample.round} ${sample.name} -> ${sample.url}`);
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
