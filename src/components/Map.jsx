import { useEffect, useRef } from "react";
import { Map as MaplibreMap, NavigationControl } from "maplibre-gl";

const SINGAPORE = { lng: 103.8198, lat: 1.3521 }; // map centres here on load
const ZOOM = 11;

export default function Map() {
  const container = useRef(null);
  const map = useRef(null);

  useEffect(() => {
    if (map.current) return; // prevent reinitialising on re-render

    map.current = new MaplibreMap({
      container: container.current,
      style: "https://tiles.openfreemap.org/styles/liberty",
      center: [SINGAPORE.lng, SINGAPORE.lat],
      zoom: ZOOM,
    });

    map.current.addControl(new NavigationControl(), "top-right");

    // wait for base map to finish loading before adding layers
    map.current.on("load", async () => {
      const res = await fetch("/data/graph.geojson");
      const geojson = await res.json();

      map.current.addSource("graph", {
        type: "geojson",
        data: geojson,
      });

      // paths that overlap with nparks/lta/ura reference data (preferred by router)
      map.current.addLayer({
        id: "graph-dedicated",
        type: "line",
        source: "graph",
        filter: ["==", ["get", "path_type"], "dedicated"],
        paint: {
          "line-color": "#000080",
          "line-width": 2,
        },
      });

      // osm-only paths used to connect dedicated segments
      map.current.addLayer({
        id: "graph-footway",
        type: "line",
        source: "graph",
        filter: ["==", ["get", "path_type"], "footway"],
        paint: {
          "line-color": "#808080",
          "line-width": 1,
        },
      });
    });
  }, []);

  return <div ref={container} style={{ width: "100%", height: "100%" }} />;
}
