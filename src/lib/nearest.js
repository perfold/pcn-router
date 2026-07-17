// nearest point of interest search

const RADII_M = [1000, 3000, 8000]; // radius distances

// haversine distance in metres
export function haversineM(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const c =
    sinLat * sinLat +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      sinLng *
      sinLng;
  return R * 2 * Math.atan2(Math.sqrt(c), Math.sqrt(1 - c));
}

// bounding box string for nominatim's viewbox param
function viewboxAround(lat, lng, radiusM) {
  const dLat = radiusM / 111320; // metres per degree of latitude
  const dLng = radiusM / (111320 * Math.cos((lat * Math.PI) / 180));
  return [lng - dLng, lat - dLat, lng + dLng, lat + dLat]
    .map((v) => v.toFixed(6))
    .join(",");
}

// builds a findNearest(query, lat, lng) -> {lat, lng, label, distanceM}
export function makeFindNearest(searchFn) {
  return async function findNearest(query, lat, lng) {
    const q = query.trim().toLowerCase().replace(/\s+/g, " ");

    for (const radiusM of RADII_M) {
      const params = new URLSearchParams({
        q,
        countrycodes: "sg",
        format: "json",
        limit: "10", // take several and pick the closest ourselves
        viewbox: viewboxAround(lat, lng, radiusM),
        bounded: "1", // restrict results to the viewbox
      });
      const results = await searchFn(params);
      if (!results || !results.length) continue;

      // closest hit by straight-line distance
      let best = null;
      let bestD = Infinity;
      for (const r of results) {
        const d = haversineM(lat, lng, parseFloat(r.lat), parseFloat(r.lon));
        if (d < bestD) {
          bestD = d;
          best = r;
        }
      }
      return {
        lat: parseFloat(best.lat),
        lng: parseFloat(best.lon),
        label: best.display_name,
        distanceM: bestD,
      };
    }
    return null;
  };
}
