// Temporary: inspects candidate schedule pages from GitHub's servers.
// URLS env: entries separated by " ;; ", each "url|regex|count|width"; prints context around regex matches.
const UA = { "User-Agent": "Mozilla/5.0 (compatible; PitWallCalendar/1.0; personal use)", "Accept": "text/html,application/json;q=0.9,*/*;q=0.8" };
const one = (s) => s.replace(/\s+/g, " ");
for (const arg of (process.env.URLS || "").split(" ;; ").filter(Boolean)) {
  const [u, re = "Practice", n = "4", w = "300"] = arg.split("||");
  try {
    const r = await fetch(u, { headers: UA, redirect: "follow" });
    const t = await r.text();
    const ms = [...t.matchAll(new RegExp(re, "g"))];
    console.log(`\n##### ${r.status} ${u} len=${t.length} matches(${re})=${ms.length}`);
    for (const m of ms.slice(0, +n)) console.log("  >> " + one(t.slice(Math.max(0, m.index - +w), m.index + +w)));
  } catch (e) {
    console.log(`ERR ${u}: ${e.message}`);
  }
}
