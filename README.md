# Pit Wall

A phone-first motorsport calendar. Pick your series, see the month at a glance, tap a day for every session in your local time. Installable from the browser ("Add to Home Screen").

## How it works

- `site/` is the app: a single `index.html`, plus a manifest, service worker and icons.
- `scripts/build-data.mjs` downloads schedules and writes `site/data/schedule.json`.
- `.github/workflows/deploy.yml` runs that script daily (and on every push), then publishes `site/` to GitHub Pages. If a source is down, the series keeps its last published schedule.

## Sources

| Series | Source |
|---|---|
| F1, F2, F3, MotoGP, IndyCar, Formula E, F1 Academy | [sportstimes/f1](https://github.com/sportstimes/f1) community data |
| Moto2, Moto3 | Official MotoGP API (`api.pulselive.motogp.com`) |
| WEC, ELMS | fiawec.com / europeanlemansseries.com race pages (schema.org data) |
| GT World Challenge Europe | gt-world-challenge-europe.com event timetables |
| NASCAR Cup, NASCAR O'Reilly | NASCAR public schedule feed (`cf.nascar.com`) |
| Indy NXT | indynxt.com event schedules |
| Supercars | supercars.com event schedules |
| WRC | wrc.com calendar (start time, then rally days) |
| WorldSBK, IMSA, BTCC, DTM, Super Formula | Wikipedia season articles (dates only, no session times) |

If any source fails, the series keeps its last schedule, the app marks it "may be outdated", and the daily run fails so GitHub emails the repo owner.

Run locally: `node scripts/build-data.mjs`, then serve `site/` with any static server.
