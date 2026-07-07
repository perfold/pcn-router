// pre-seed the tile cache for singapore once, so the pi serves almost entirely from disk

import { existsSync, mkdirSync, writeFileSync } from "fs";
import path from "path";

const BBOX = [103.6, 1.2, 104.05, 1.48]; // [minLng, minLat, maxLng, maxLat] singapore
const ZOOMS = [12, 13, 14, 15];
const CACHE = "./bot/.tile-cache";
const SUBDOMAINS = ["a", "b", "c", "d"];
const UA = "pcn-router-bot/1.0 (https://github.com/perfold/pcn-router)";

const lon2x = (lng, z) => Math.floor(((lng + 180) / 360) * 2 ** z);
const lat2y = (lat, z) => {
  const r = (lat * Math.PI) / 180;
  return Math.floor(
    ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z,
  );
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

mkdirSync(CACHE, { recursive: true });
let fetched = 0,
  skipped = 0;

for (const z of ZOOMS) {
  const [x0, x1] = [lon2x(BBOX[0], z), lon2x(BBOX[2], z)];
  const [y0, y1] = [lat2y(BBOX[3], z), lat2y(BBOX[1], z)];
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      const p = path.join(CACHE, `${z}-${x}-${y}.png`);
      if (existsSync(p)) {
        skipped++;
        continue;
      }
      const sub = SUBDOMAINS[(x + y) % SUBDOMAINS.length];
      const url = `https://${sub}.basemaps.cartocdn.com/light_all/${z}/${x}/${y}.png`;
      const res = await fetch(url, { headers: { "User-Agent": UA } });
      if (res.ok) {
        writeFileSync(p, Buffer.from(await res.arrayBuffer()));
        fetched++;
      }
      await sleep(200);
    }
  }
  console.log(`z${z} done (fetched ${fetched}, skipped ${skipped} so far)`);
}
console.log(`complete: ${fetched} tiles fetched, ${skipped} already cached`);
