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
| WEC | fiawec.com race pages (schema.org data) |
| NASCAR Cup | NASCAR public schedule feed (`cf.nascar.com`) |

Run locally: `node scripts/build-data.mjs`, then serve `site/` with any static server.
