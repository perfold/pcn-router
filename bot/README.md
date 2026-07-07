# pcn-router telegram bot

a companion telegram bot for pcn-router that brings its functionality your phone, without opening the web app.

add stops by sending an address or a location pin, reorder them, and get back a rendered route preview, distance and eta, a `.gpx` file, and a share link that opens the same route in the web app.

unlike the web app (which is fully client-side, no backend), this bot is a **self-hosted** long-running Node process. it's designed to run on modest hardware, built and tested on my Raspberry Pi 3B (2GB RAM).

---

## commands

| command  | what it does                                       |
| -------- | -------------------------------------------------- |
| `/add`   | add a stop by address (e.g. `/add waterway point`) |
| `/stops` | show the current list of stops                     |
| `/route` | route the current stops                            |
| `/clear` | start over                                         |

you can also send a plain address or a location pin to add a stop, and reorder / flip / remove stops with the inline buttons.

---

## running it

from the repo root:

```bash
cd bot
npm install
BOT_TOKEN=<your-telegram-bot-token> node index.js
```

the bot reuses the same routing graph and PCN overlay as the web app (`public/data/`), so it must be run from within the repo. the paths are resolved relative to the repo root, not the `bot/` folder. you can get your bot token from [@BotFather](https://t.me/BotFather).

---

## map tiles

route previews are rendered server-side from [CARTO Positron](https://carto.com/basemaps/) tiles (a light basemap, distinct from the web app's OpenFreeMap tiles), composited with the route line using `sharp`.

tiles are cached to disk (`bot/.tile-cache/`) on first use. `warm-cache.js` can pre-seed the cache for Singapore ahead of time, can be useful on a low-powered host:

```bash
node warm-cache.js
```

---

## stack

| layer             | tool                                      |
| ----------------- | ----------------------------------------- |
| bot framework     | grammY                                    |
| image compositing | sharp (libvips)                           |
| spatial index     | rbush                                     |
| tiles             | CARTO Positron (© OpenStreetMap, © CARTO) |

---

## attribution

route preview images use CARTO Positron basemap tiles:

© OpenStreetMap contributors, © CARTO

see the [main README](../README.md) for the web app's full data attribution.
