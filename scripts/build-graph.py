"""
- downloads OSM Singapore map, with only cycle-able paths
- compares overlap with "ground truth" NParks, LTA and URA geojson, from data.gov.sg
- rewards paths that overlap with "ground truth", as well as certain types of paths (see highway_multipliers)
- generates a packed binary graph (graph.bin + graph.meta.json) for the router + pcn-overlay.geojson for the pcn layer
"""

import json
import sys
from pathlib import Path
import geopandas as gpd
import osmnx as ox
import numpy as np
from collections import Counter

root = Path(__file__).parent.parent
merged_path = root / "public" / "data" / "merged.geojson" # merged geojson from NParks, LTA and URA datasets
bin_path = root / "public" / "data" / "graph.bin" # packed routing graph 
meta_path = root / "public" / "data" / "graph.meta.json"
overlay_path = root / "public" / "data" / "pcn-overlay.geojson" # dedicated cyclepath edges only, for the map overlay

coord_scale = 10_000_000

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

# export the routing graph as a packed binary + the pcn overlay geojson.
def export_binary(edges: gpd.GeoDataFrame, bin_path: Path, meta_path: Path, overlay_path: Path) -> None:
    print("Exporting graph.bin + meta + overlay...")

    node_index = {} 
    node_osm = []
    node_lng = []  
    node_lat = []    

    def get_node(osm_id, lng, lat):
        idx = node_index.get(osm_id)
        if idx is None:
            idx = len(node_osm)
            node_index[osm_id] = idx
            node_osm.append(osm_id)
            node_lng.append(lng)
            node_lat.append(lat)
        return idx

    edge_from = [] 
    edge_to = []  
    edge_weight = [] 
    coord_offsets = [0]
    packed_lng = []
    packed_lat = []

    for _, row in edges.iterrows():
        coords = list(row.geometry.coords)
        f_lng, f_lat = coords[0]
        t_lng, t_lat = coords[-1]
        fi = get_node(int(row["u"]), f_lng, f_lat)
        ti = get_node(int(row["v"]), t_lng, t_lat)
        edge_from.append(fi)
        edge_to.append(ti)
        edge_weight.append(round(float(row["weight"]), 1))
        for x, y in coords:
            packed_lng.append(x)
            packed_lat.append(y)
        coord_offsets.append(len(packed_lng))

    num_nodes = len(node_osm)
    num_edges = len(edge_from)
    num_coords = len(packed_lng)

    arrays = {
        "node_osm": np.array(node_osm, dtype=np.uint64),
        "node_lng": np.round(np.array(node_lng) * coord_scale).astype(np.int32),
        "node_lat": np.round(np.array(node_lat) * coord_scale).astype(np.int32),
        "edge_from": np.array(edge_from, dtype=np.uint32),
        "edge_to": np.array(edge_to, dtype=np.uint32),
        "edge_weight": np.array(edge_weight, dtype=np.float32),
        "coord_offsets": np.array(coord_offsets, dtype=np.uint32),
        "packed_lng": np.round(np.array(packed_lng) * coord_scale).astype(np.int32),
        "packed_lat": np.round(np.array(packed_lat) * coord_scale).astype(np.int32),
    }

    section_order = [
        "node_osm", "node_lng", "node_lat",
        "edge_from", "edge_to", "edge_weight",
        "coord_offsets", "packed_lng", "packed_lat",
    ]
    meta = {
        "format": "pcn-graph-bin/1",
        "coord_scale": coord_scale,
        "num_nodes": num_nodes,
        "num_edges": num_edges,
        "num_coords": num_coords,
        "little_endian": True,
        "sections": [],
    }
    offset = 0
    buffers = []
    for name in section_order:
        arr = arrays[name].astype(arrays[name].dtype.newbyteorder("<"))
        b = arr.tobytes()
        meta["sections"].append({
            "name": name,
            "dtype": str(arr.dtype).replace("<", ""),
            "count": int(arr.size),
            "byte_offset": offset,
            "byte_length": len(b),
        })
        buffers.append(b)
        offset += len(b)

    bin_path.write_bytes(b"".join(buffers))
    meta_path.write_text(json.dumps(meta, indent=2))

    # dedicated cycle path geojson
    overlay = {"type": "FeatureCollection", "features": [
        {
            "type": "Feature",
            "geometry": {
                "type": "LineString",
                "coordinates": [[round(x, 6), round(y, 6)] for x, y in row.geometry.coords],
            },
            "properties": {"path_type": "dedicated"},
        }
        for _, row in edges[edges["path_type"] == "dedicated"].iterrows()
    ]}
    overlay_path.write_text(json.dumps(overlay, separators=(",", ":")))

    bin_mb = bin_path.stat().st_size / 1_000_000
    ov_mb = overlay_path.stat().st_size / 1_000_000
    print(f"{num_nodes} nodes, {num_edges} edges")
    print(f"graph.bin: {bin_mb:.1f} MB, pcn-overlay.geojson: {ov_mb:.1f} MB")


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

    bin_path.parent.mkdir(parents=True, exist_ok=True)
    export_binary(edges, bin_path, meta_path, overlay_path)
    print(f"\nDone: {bin_path}")


if __name__ == "__main__":
    main()