import { makeFindNearest } from "./nearest.js";

const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const MIN_INTERVAL_MS = 1100; // nominatim policy: max 1 req/s, keep a little margin

// queue all nominatim calls (search retries + nearest) behind one limiter, same pattern as the bot
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

// raw nominatim request for prebuilt params, returns the parsed result array
async function requestNominatim(params) {
  const res = await fetch(`${NOMINATIM}?${params}`, {
    headers: { "Accept-Language": "en" },
  });
  return res.json();
}

// single search request for one query string
async function searchNominatim(query) {
  const params = new URLSearchParams({
    q: query,
    countrycodes: "sg", // only singapore (duh)
    format: "json",
    limit: 1, // currently we're taking the top option, but will add dropdown menu to let user confirm which location they actually want (in the future)
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
