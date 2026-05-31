# pcn-router

a client-side bike route planner for Singapore that prioritises the Park Connector Network (PCN). type an address or click the map to set a start and end point. the router finds the most cycling-friendly path, preferring dedicated PCN and cycling infrastructure over shared footways.

### live at: [https://perfold.github.io/pcn-router]

---

## features

- **search or click**: type an address to geocode a start/end point, or click directly on the map
- **PCN-prioritised routing**: prefers dedicated cycling infrastructure over shared footways
- **shareable routes**: copy the url once a route is loaded, recipients see the same route when they open it
- **gpx export**: download the route as a `.gpx` file for use in cycling apps (e.g. Garmin, Komoot) or on a bike computer
- **speed-adjusted time estimate**: adjustable speed slider for personalised eta, can be used for runners too
- **show/hide PCN overlay**: toggle visibility of the dedicated cycling network on the map
- **mobile-friendly**: responsive layout that works on phones

---

## how it works

the routing graph is pre-built offline from NParks, LTA and URA datasets (from data.gov.sg) and OpenStreetMap, then committed to the repo. the browser loads the graph on startup and runs A\* entirely client-side, no backend, no server.

---

**weight scheme**

paths that overlap with the government PCN/cycling reference data get a lower routing weight (preferred). OSM-only footways get a higher weight and are used only to bridge gaps between dedicated segments. weights are further adjusted by highway type:

| highway type | real world example                      | multiplier |
| ------------ | --------------------------------------- | ---------- |
| cycleway     | long cycling paths/highways             | 0.75×      |
| pedestrian   | walkways, mainly around marina bay/city | 1.0×       |
| footway      | most pavements                          | 1.5×       |
| path         | small parks                             | 2.0×       |
| residential  | small roads in landed property estates  | 3.0×       |

---

## stack

| layer             | tool                          |
| ----------------- | ----------------------------- |
| frontend          | React + Vite                  |
| map               | MapLibre GL JS                |
| map tiles         | OpenFreeMap (bright)          |
| routing algorithm | A\* via ngraph.path           |
| spatial index     | rbush (nearest-node snapping) |
| geocoding         | Nominatim (OpenStreetMap)     |
| data pipeline     | Python (geopandas, osmnx)     |

---

## data sources

| dataset                  | source                  | notes                                        |
| ------------------------ | ----------------------- | -------------------------------------------- |
| Park Connector Loop      | NParks via data.gov.sg  | named PCN loops                              |
| Cycling Path Network     | LTA via data.gov.sg     | town-level cycling paths                     |
| Master Plan 2025 SDCP    | URA via data.gov.sg     | existing paths only, planned routes excluded |
| footway/cycleway network | OpenStreetMap via osmnx | used to connect gaps between dedicated paths |

---

## attribution

### map data

© OpenStreetMap contributors (openstreetmap.org)

- map tiles via OpenFreeMap, routing graph via osmnx
- map rendering via MapLibre GL JS (maplibre.org)

### singapore government datasets

contains information from the following datasets accessed on 27 May 2026, which are made available under the terms of the Singapore Open Data Licence version 1.0 (data.gov.sg/open-data/licence):

- Park Connector Loop
  https://data.gov.sg/datasets/d_a69ef89737379f231d2ae93fd1c5707f/view

- Cycling Path Network (GEOJSON)
  https://data.gov.sg/datasets/d_8f468b25193f64be8a16fa7d8f60f553/view

- Master Plan 2025 SDCP Cycling Network layer
  https://data.gov.sg/datasets/d_8fd4e04e7058ee19521d123caf28a855/view

---
