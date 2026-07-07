// render a route preview png with a carto positron basemap and the route itself

import { readFileSync, existsSync, mkdirSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";
import sharp from "sharp";

sharp.concurrency(1);
sharp.cache(false);

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const W = 800;
const H = 600;
const FILL = 0.8;
const TILE = 256;
const MAX_ZOOM = 17;

const ROUTE_COLOR = "#f97316";
const PCN_COLOR = "#750000";

// carto positron basemap
const TILE_URL =
  process.env.TILE_URL ||
  "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png";
const TILE_SUBDOMAINS = ["a", "b", "c", "d"];
const TILE_CACHE = path.join(root, "bot", ".tile-cache");
const TILE_UA = "pcn-router-bot/1.0 (https://github.com/perfold/pcn-router)";

let pcnFeatures = null;

export function loadOverlay() {
  const geo = JSON.parse(
    readFileSync(path.join(root, "public/data/pcn-overlay.geojson"), "utf8"),
  );
  pcnFeatures = geo.features.map((f) => {
    const coords = f.geometry.coordinates;
    let minLng = Infinity,
      minLat = Infinity,
      maxLng = -Infinity,
      maxLat = -Infinity;
    for (const [lng, lat] of coords) {
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
    return { bbox: [minLng, minLat, maxLng, maxLat], coords };
  });
  console.log(`overlay loaded: ${pcnFeatures.length} pcn features`);
}

function mercX(lng, z) {
  return ((lng + 180) / 360) * TILE * 2 ** z;
}
function mercY(lat, z) {
  const r = (lat * Math.PI) / 180;
  return (
    ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) *
    TILE *
    2 ** z
  );
}

function fitViewport(coords) {
  let minLng = Infinity,
    minLat = Infinity,
    maxLng = -Infinity,
    maxLat = -Infinity;
  for (const [lng, lat] of coords) {
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }

  let z = MAX_ZOOM;
  for (; z > 1; z--) {
    const spanX = mercX(maxLng, z) - mercX(minLng, z);
    const spanY = mercY(minLat, z) - mercY(maxLat, z);
    if (spanX <= W * FILL && spanY <= H * FILL) break;
  }
  const cx = (mercX(minLng, z) + mercX(maxLng, z)) / 2;
  const cy = (mercY(minLat, z) + mercY(maxLat, z)) / 2;
  const originX = Math.round(cx - W / 2);
  const originY = Math.round(cy - H / 2);
  return {
    zoom: z,
    bbox: [minLng, minLat, maxLng, maxLat],
    project([lng, lat]) {
      return [mercX(lng, z) - originX, mercY(lat, z) - originY];
    },
    originX,
    originY,
  };
}

async function fetchTile(z, x, y) {
  const max = 2 ** z;
  if (y < 0 || y >= max) return null;
  x = ((x % max) + max) % max;
  const cachePath = path.join(TILE_CACHE, `${z}-${x}-${y}.png`);
  if (existsSync(cachePath)) return readFileSync(cachePath);
  try {
    const sub = TILE_SUBDOMAINS[(x + y) % TILE_SUBDOMAINS.length];
    const url = TILE_URL.replace("{s}", sub)
      .replace("{z}", z)
      .replace("{x}", x)
      .replace("{y}", y);
    const res = await fetch(url, { headers: { "User-Agent": TILE_UA } });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    mkdirSync(TILE_CACHE, { recursive: true });
    writeFileSync(cachePath, buf);
    return buf;
  } catch {
    return null;
  }
}

// render all tiles covering the viewport onto a base canvas
async function renderBasemap(zoom, originX, originY) {
  const x0 = Math.floor(originX / TILE);
  const x1 = Math.floor((originX + W) / TILE);
  const y0 = Math.floor(originY / TILE);
  const y1 = Math.floor((originY + H) / TILE);

  const jobs = [];
  for (let ty = y0; ty <= y1; ty++)
    for (let tx = x0; tx <= x1; tx++)
      jobs.push(
        fetchTile(zoom, tx, ty).then((buf) =>
          buf
            ? { buf, left: tx * TILE - originX, top: ty * TILE - originY }
            : null,
        ),
      );
  const tiles = (await Promise.all(jobs)).filter(Boolean);

  const layers = [];
  for (const t of tiles) {
    const cropL = Math.max(0, -t.left);
    const cropT = Math.max(0, -t.top);
    const w = Math.min(TILE - cropL, W - Math.max(0, t.left));
    const h = Math.min(TILE - cropT, H - Math.max(0, t.top));
    if (w <= 0 || h <= 0) continue;
    const img =
      cropL || cropT || w < TILE || h < TILE
        ? await sharp(t.buf)
            .extract({ left: cropL, top: cropT, width: w, height: h })
            .toBuffer()
        : t.buf;
    layers.push({
      input: img,
      left: Math.max(0, Math.round(t.left)),
      top: Math.max(0, Math.round(t.top)),
    });
  }

  return sharp({
    create: { width: W, height: H, channels: 3, background: "#e8e4dc" },
  })
    .composite(layers)
    .png()
    .toBuffer();
}

function polyline(coords, project, step = 1) {
  let d = "";
  for (let i = 0; i < coords.length; i += step) {
    const [x, y] = project(coords[i]);
    d += (d ? "L" : "M") + x.toFixed(1) + " " + y.toFixed(1);
  }

  if (step > 1 && (coords.length - 1) % step !== 0) {
    const [x, y] = project(coords[coords.length - 1]);
    d += "L" + x.toFixed(1) + " " + y.toFixed(1);
  }
  return d;
}

export async function renderRoutePng(routeCoords, waypoints) {
  const { zoom, bbox, project, originX, originY } = fitViewport(routeCoords);
  const [minLng, minLat, maxLng, maxLat] = bbox;
  const margin = 0.005;

  const basemap = await renderBasemap(zoom, originX, originY);

  const routeStep = routeCoords.length > 4000 ? 2 : 1;
  const routeD = polyline(routeCoords, project, routeStep);
  // white outline under the orange route line so it stays legible
  const routePath =
    `<path d="${routeD}" fill="none" stroke="#ffffff" stroke-width="7" stroke-linejoin="round" stroke-linecap="round"/>` +
    `<path d="${routeD}" fill="none" stroke="${ROUTE_COLOR}" stroke-width="4" stroke-linejoin="round" stroke-linecap="round"/>`;

  // numbered waypoint markers: green start, red end, grey middle
  let markers = "";
  waypoints.forEach((wp, i) => {
    const [x, y] = project(wp.lngLat);
    const fill =
      i === 0 ? "#27ae60" : i === waypoints.length - 1 ? "#c0392b" : "#7f8c8d";
    markers += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="13" fill="${fill}" stroke="#fff" stroke-width="3"/>`;
    markers += `<text x="${x.toFixed(1)}" y="${(y + 5.5).toFixed(1)}" text-anchor="middle" font-family="sans-serif" font-size="15" font-weight="bold" fill="#fff">${i + 1}</text>`;
  });

  // roll credits
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
${routePath}
${markers}
<rect x="${W - 248}" y="${H - 24}" width="248" height="24" fill="#ffffff" opacity="0.75"/>
<text x="${W - 8}" y="${H - 8}" text-anchor="end" font-family="sans-serif" font-size="12" fill="#333">© OpenStreetMap contributors © CARTO</text>
</svg>`;

  return sharp(basemap)
    .composite([{ input: Buffer.from(svg), left: 0, top: 0 }])
    .png()
    .toBuffer();
}
