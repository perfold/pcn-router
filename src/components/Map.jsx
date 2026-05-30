import { useEffect, useRef } from "react";
import { Map as MaplibreMap, NavigationControl } from "maplibre-gl";

const SINGAPORE = { lng: 103.8198, lat: 1.3521 }; // map gets centered here when loaded in
const ZOOM = 11;

export default function Map() {
  const container = useRef(null);
  const map = useRef(null);

  useEffect(() => {
    if (map.current) return; // prevent map from reinitialising on re-render

    map.current = new MaplibreMap({
      container: container.current,
      style: "https://tiles.openfreemap.org/styles/liberty",
      center: [SINGAPORE.lng, SINGAPORE.lat],
      zoom: ZOOM,
    });

    map.current.addControl(new NavigationControl(), "top-right");
  }, []);

  return <div ref={container} style={{ width: "100%", height: "100%" }} />;
}
