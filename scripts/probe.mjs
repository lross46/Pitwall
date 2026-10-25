// Temporary: checks which schedule sources are reachable from GitHub's servers.
const UA = { "User-Agent": "Mozilla/5.0 (compatible; PitWallCalendar/1.0; personal use)", "Accept": "text/html,application/json;q=0.9,*/*;q=0.8" };
const urls = process.argv.slice(2).length ? process.argv.slice(2) : [
  "https://www.europeanlemansseries.com/en/season/2026",
  "https://www.gt-world-challenge-europe.com/calendar",
  "https://www.worldsbk.com/en/calendar",
  "https://api.worldsbk.com/",
  "https://www.imsa.com/weathertech/schedule/",
  "https://www.indycar.com/indynxt/schedule",
  "https://api.wrc.com/content/filters/calendar?championship=wrc&origin=vcms&year=2026",
  "https://www.wrc.com/en/calendar",
  "https://www.dtm.com/en/calendar",
  "https://www.btcc.net/calendar/",
  "https://www.supercars.com/calendar",
  "https://superformula.net/sf3/en/race/",
  "https://en.wikipedia.org/w/api.php?action=parse&page=2026_Super_Formula_Championship&prop=sections&format=json",
];
for (const u of urls) {
  try {
    const r = await fetch(u, { headers: UA, redirect: "follow" });
    const t = await r.text();
    const title = (t.match(/<title[^>]*>([^<]*)/i) || [])[1] || "";
    const ld = (t.match(/application\/ld\+json/g) || []).length;
    const next = /__NEXT_DATA__/.test(t) ? " NEXT_DATA" : "";
    const nuxt = /__NUXT__/.test(t) ? " NUXT" : "";
    const tt = (t.match(/timetable__container/g) || []).length;
    console.log(`${r.status} ${u} -> ${r.url}\n    len=${t.length} ld=${ld} timetable=${tt}${next}${nuxt} title="${title.trim().slice(0, 80)}"`);
    const apis = [...new Set([...t.matchAll(/https?:\/\/[a-z0-9.-]*(?:api|cdn|data|feed|pulselive)[a-z0-9.-]*\.[a-z]+[^"'\s<>)]{0,80}/gi)].map((m) => m[0]))].slice(0, 12);
    if (apis.length) console.log("    urls: " + apis.join("  "));
    if (t.trim().startsWith("{") || t.trim().startsWith("[")) console.log("    json: " + t.slice(0, 600).replace(/\s+/g, " "));
  } catch (e) {
    console.log(`ERR ${u}: ${e.message}`);
  }
}
