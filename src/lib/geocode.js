const NOMINATIM = "https://nominatim.openstreetmap.org/search";

// geocodes a string to {lat, lng, label} using nominatim
export async function geocode(query) {
  const params = new URLSearchParams({
    q: query,
    countrycodes: "sg", // only singapore (duh)
    format: "json",
    limit: 1, // currently we're taking the top option, but will add dropdown menu to let user confirm which location they actually want (in the future)
  });

  const res = await fetch(`${NOMINATIM}?${params}`, {
    headers: { "Accept-Language": "en" },
  });
  const results = await res.json();

  if (!results.length) return null;

  const top = results[0];
  return {
    lat: parseFloat(top.lat),
    lng: parseFloat(top.lon),
    label: top.display_name,
  };
}
