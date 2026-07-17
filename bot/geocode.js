import { makeFindNearest } from "../src/lib/nearest.js";

const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const MIN_INTERVAL_MS = 1100; // nominatim policy: max 1 req/s, keep a little margin so bursts never breach it

// queue geocode calls, since nominatim usage is capped at 1 call per sec
let geocodeChain = Promise.resolve(0);
function schedule(fn) {
  const run = geocodeChain.then(async (lastAt) => {
    const wait = lastAt + MIN_INTERVAL_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    return fn();
  });

  geocodeChain = run.then(
    () => Date.now(),
    () => Date.now(),
  );
  return run;
}

async function requestNominatim(params) {
  const res = await fetch(`${NOMINATIM}?${params}`, {
    headers: {
      "Accept-Language": "en",
      "User-Agent":
        "pcn-router-bot/1.0 (https://github.com/perfold/pcn-router)",
    },
  });
  return res.json();
}

// single search request for one query string
async function searchNominatim(query) {
  const params = new URLSearchParams({
    q: query,
    countrycodes: "sg",
    format: "json",
    limit: 1,
  });

  const results = await requestNominatim(params);

  if (!results.length) return null;

  const top = results[0];
  return {
    lat: parseFloat(top.lat),
    lng: parseFloat(top.lon),
    label: top.display_name,
  };
}

// geocodes a string to {lat, lng, label} using nominatim.
export async function geocode(query) {
  return schedule(() => searchNominatim(query));
}

// nearest <place> to current loc/last waypoint
export const findNearest = makeFindNearest((params) =>
  schedule(() => requestNominatim(params)),
);
