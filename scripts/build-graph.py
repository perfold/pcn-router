"""
- downloads OSM Singapore map, with only cycle-able paths
- compares overlap with "ground truth" NParks, LTA and URA geojson, from data.gov.sg
- rewards paths that overlap with "ground truth", as well as certain types of paths (see highway_multipliers)
- generates geojson graph with weighted edges
"""

import json
import sys
from pathlib import Path
import geopandas as gpd
import osmnx as ox
from collections import Counter

root = Path(__file__).parent.parent
merged_path = root / "public" / "data" / "merged.geojson" # merged geojson from NParks, LTA and URA datasets
output_path = root / "public" / "data" / "graph.geojson"

crs_sg = "EPSG:3414" # svy21

dedicated_weight = 1.0  # overlaps PCN or cycling path from our merged geojson: prefer this
footway_weight = 1.5  # OSM pavements/paths: used to bridge the gaps between the PCNs

overlap_threshold = 0.5  # fraction of edge that must overlap PCN buffer to count as dedicated
pcn_buffer_radius = 10 

# multipliers applied on top of the dedicated/footway split, to bias certain kinds of paths
# can use overpass-turbo.eu to check out
highway_multipliers = {
    "cycleway": 0.75, # nice long cycling highways/paths, some overlap with PCN
    "pedestrian": 1.0, # mainly pavements/walkways around marina bay (not included in footway)
    "footway": 1.5, # basically every pavement
    "path": 2.0, # minor parks, some aren't included in footway: tampines quarry park, lorong halus, etc
    "residential": 3.0 # small roads in landed property areas
}

# OSM highway types to download
osm_filter = '["highway"~"cycleway|pedestrian|footway|path|residential"]'

# function to download osm map
def download_osm() -> gpd.GeoDataFrame:
    print("Downloading OSM Singapore network...")
    G = ox.graph_from_place("Singapore", custom_filter=osm_filter, retain_all=False)
    _, edges = ox.graph_to_gdfs(G)  # discard nodes, keep edges
    print(f"{len(edges)} edges downloaded")
    hw_counter = Counter()
    # print how many of each type of highway we downloaded
    for hw in edges["highway"]:
        if isinstance(hw, list):
            hw_counter[hw[0]] += 1
        else:
            hw_counter[hw] += 1
    print("Highway tags in OSM download:")
    for tag, count in sorted(hw_counter.items(), key=lambda x: -x[1]):
        print(f"{tag:20s} {count:6d}")
    return edges

def get_highway_multiplier(hw) -> float:
    # osmnx sometimes returns highway as a list when an edge has multiple tags
    if isinstance(hw, list):
        hw = hw[0]
    return highway_multipliers.get(hw, 2.0)  # default 2x for anything unexpected

# assign weights to the paths
def assign_weights(edges: gpd.GeoDataFrame, merged: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    print("Assigning weights...")

    edges_sg = edges.to_crs(crs_sg)
    merged_sg = merged.to_crs(crs_sg)

    # check which paths/edges are within pcn_buffer_radius of any PCN 
    pcn_buffered = merged_sg.copy()
    pcn_buffered["geometry"] = merged_sg.buffer(pcn_buffer_radius)

    edges_reset = edges_sg.reset_index()
    edges_reset["_pos"] = range(len(edges_reset))

    candidates = gpd.sjoin(
        edges_reset,
        pcn_buffered[["geometry"]],
        how="inner",
        predicate="intersects"
    )["_pos"].unique()

    print(f"{len(candidates)} candidate edges near PCN (of {len(edges_sg)} total)")

    # calc precise overlap ratio if within buffer to PCN
    pcn_union = pcn_buffered.union_all() 

    length_m = edges_sg.geometry.length
    is_dedicated = length_m.copy() * 0  # start all false (zeros)

    for idx in candidates: # loop thru every path/edge near a PCN
        geom = edges_sg.geometry.iloc[idx]
        length = length_m.iloc[idx]
        if length < 0.001:
            continue
        overlap = geom.intersection(pcn_union).length / length
        if overlap >= overlap_threshold:
            is_dedicated.iloc[idx] = 1 # mark as dedicated if overlap more than threshold 

    is_dedicated = is_dedicated > 0

    # base weight
    weight = length_m * footway_weight
    weight[is_dedicated] = length_m[is_dedicated] * dedicated_weight

    # apply highway multiplier
    highway_mult = edges_sg["highway"].apply(get_highway_multiplier)
    weight = weight * highway_mult

    edges = edges.copy()
    edges["path_type"] = "footway"
    edges.loc[is_dedicated, "path_type"] = "dedicated" # make sure all those within buffer are marked as dedicated
    edges["weight"] = weight

    print(f"dedicated (base 1x): {is_dedicated.sum()}")
    print(f"footway (base 1.5x): {(~is_dedicated).sum()}")

    return edges

# export graph as geojson
def export_graph(edges: gpd.GeoDataFrame, path: Path) -> None:
    print("Exporting graph.geojson...")
    features = []
    for _, row in edges.iterrows():
        features.append({
            "type": "Feature",
            "geometry": {
                "type": "LineString",
                "coordinates": [[round(x, 6), round(y, 6)] for x, y in row.geometry.coords]
            },
            "properties": {
                "from": int(row["u"]),
                "to": int(row["v"]),
                "weight": round(float(row["weight"]), 1),
                "path_type": row["path_type"],
                "highway": row["highway"] if isinstance(row["highway"], str) else row["highway"][0]
            }
        })

    geojson = {"type": "FeatureCollection", "features": features}
    with open(path, "w") as f:
        json.dump(geojson, f, separators=(",", ":"))

    size_mb = path.stat().st_size / 1_000_000
    print(f"{len(features)} edges: {size_mb:.1f} MB")


def main() -> None:
    if not merged_path.exists():
        print(f"ERROR: {merged_path} not found. run merge-layers.py first")
        sys.exit(1)

    edges = download_osm()

    print("Loading PCN reference layer...")
    merged = gpd.read_file(merged_path)
    print(f"{len(merged)} features")

    edges = assign_weights(edges, merged)

    # drop zero-weight edges
    edges = edges[edges["weight"] > 0].copy()

    # deduplicate parallel edges, keep lowest weight per (u, v) pair
    edges = edges.reset_index()
    edges = edges.sort_values("weight")
    edges = edges.drop_duplicates(subset=["u", "v"], keep="first")

    output_path.parent.mkdir(parents=True, exist_ok=True)
    export_graph(edges, output_path)
    print(f"\nDone: {output_path}")


if __name__ == "__main__":
    main()