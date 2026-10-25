// Temporary: inspects candidate schedule pages from GitHub's servers.
const UA = { "User-Agent": "Mozilla/5.0 (compatible; PitWallCalendar/1.0; personal use)", "Accept": "text/html,application/json;q=0.9,*/*;q=0.8" };
const urls = process.argv.slice(2);
const one = (s) => s.replace(/\s+/g, " ");
for (const u of urls) {
  try {
    const r = await fetch(u, { headers: UA, redirect: "follow" });
    const t = await r.text();
    console.log(`\n##### ${r.status} ${u} -> ${r.url} len=${t.length}`);
    const scripts = [...t.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1]).slice(0, 15);
    console.log("scripts: " + scripts.join("  "));
    const links = [...new Set([...t.matchAll(/href="([^"]*(?:event|race|round|rally|schedule|calendar)[^"]*)"/gi)].map((m) => m[1]))].slice(0, 40);
    console.log("links: " + links.join("  "));
    const isoRe = /20\d\d-\d\d-\d\dT\d\d:\d\d/g;
    const isos = [...t.matchAll(isoRe)];
    console.log(`iso datetimes: ${isos.length}`);
    for (const m of isos.slice(0, 6)) console.log("  ctx: " + one(t.slice(Math.max(0, m.index - 220), m.index + 80)));
    for (const kw of ["Practice", "Qualifying", "Superpole", "Shakedown", "Race 1", "data-start", "timestamp", "api"]) {
      const i = t.indexOf(kw);
      if (i >= 0) console.log(`  [${kw}] ` + one(t.slice(Math.max(0, i - 200), i + 200)));
    }
  } catch (e) {
    console.log(`ERR ${u}: ${e.message}`);
  }
}
