"""
reads graph.bin back and print/validate it, to check if the graph is correct
"""

import json
import sys
from pathlib import Path
import numpy as np

root = Path(__file__).parent.parent
bin_path = root / "public" / "data" / "graph.bin"
meta_path = root / "public" / "data" / "graph.meta.json"

DTYPES = {
    "uint64": np.uint64,
    "uint32": np.uint32,
    "int32": np.int32,
    "float32": np.float32,
}


def load():
    meta = json.loads(meta_path.read_text())
    raw = bin_path.read_bytes()
    arrays = {}
    for s in meta["sections"]:
        dt = np.dtype(DTYPES[s["dtype"]]).newbyteorder("<" if meta["little_endian"] else ">")
        arrays[s["name"]] = np.frombuffer(
            raw, dtype=dt, count=s["count"], offset=s["byte_offset"]
        )
    return meta, arrays


def validate(meta, arrays):
    print("=== header ===")
    print(f"format      : {meta['format']}")
    print(f"coord_scale : {meta['coord_scale']}")
    print(f"nodes       : {meta['num_nodes']}")
    print(f"edges       : {meta['num_edges']}")
    print(f"coords      : {meta['num_coords']}")
    print()

    print("=== sections ===")
    for s in meta["sections"]:
        print(f"{s['name']:15s} {s['dtype']:8s} count={s['count']:>9d} "
              f"offset={s['byte_offset']:>10d} bytes={s['byte_length']:>10d}")
    print()

    ok = True
    scale = meta["coord_scale"]

    # counts line up
    if len(arrays["node_osm"]) != meta["num_nodes"]:
        print("FAIL: node_osm count != num_nodes"); ok = False
    if len(arrays["edge_from"]) != meta["num_edges"]:
        print("FAIL: edge_from count != num_edges"); ok = False
    if len(arrays["coord_offsets"]) != meta["num_edges"] + 1:
        print("FAIL: coord_offsets should be num_edges+1"); ok = False
    if arrays["coord_offsets"][-1] != meta["num_coords"]:
        print("FAIL: last coord offset != num_coords"); ok = False
    if len(arrays["packed_lng"]) != meta["num_coords"]:
        print("FAIL: packed_lng count != num_coords"); ok = False

    # offsets monotonic non-decreasing
    off = arrays["coord_offsets"].astype(np.int64)
    if np.any(np.diff(off) < 0):
        print("FAIL: coord_offsets not monotonic"); ok = False

    # node indices in edges are in range
    N = meta["num_nodes"]
    if arrays["edge_from"].max() >= N or arrays["edge_to"].max() >= N:
        print("FAIL: edge endpoint index out of node range"); ok = False

    # every edge's first/last packed coord should match its endpoint node coord
    node_lng = arrays["node_lng"].astype(np.int64)
    node_lat = arrays["node_lat"].astype(np.int64)
    plng = arrays["packed_lng"].astype(np.int64)
    plat = arrays["packed_lat"].astype(np.int64)
    ef, et = arrays["edge_from"], arrays["edge_to"]
    mism = 0
    for i in range(meta["num_edges"]):
        a, b = off[i], off[i + 1]
        if plng[a] != node_lng[ef[i]] or plat[a] != node_lat[ef[i]]:
            mism += 1
        if plng[b - 1] != node_lng[et[i]] or plat[b - 1] != node_lat[et[i]]:
            mism += 1
    if mism:
        print(f"WARN: {mism} edge endpoints don't match node coords")
    else:
        print("ok: all edge endpoints match their node coords")

    print()
    print("PASS" if ok else "FAIL")
    return ok


def dump_edge(arrays, meta, i):
    off = arrays["coord_offsets"]
    scale = meta["coord_scale"]
    a, b = off[i], off[i + 1]
    print(f"edge {i}: from_idx={arrays['edge_from'][i]} to_idx={arrays['edge_to'][i]} "
          f"weight={arrays['edge_weight'][i]:.1f} coords={b - a}")
    for k in range(a, b):
        print(f"  [{arrays['packed_lng'][k] / scale:.6f}, {arrays['packed_lat'][k] / scale:.6f}]")


def dump_node(arrays, meta, i):
    scale = meta["coord_scale"]
    print(f"node {i}: osm={int(arrays['node_osm'][i])} "
          f"lng={arrays['node_lng'][i] / scale:.6f} lat={arrays['node_lat'][i] / scale:.6f}")


def main():
    if not bin_path.exists():
        print(f"ERROR: {bin_path} not found. run build-graph.py first")
        sys.exit(1)
    meta, arrays = load()
    if "--edge" in sys.argv:
        dump_edge(arrays, meta, int(sys.argv[sys.argv.index("--edge") + 1]))
    elif "--node" in sys.argv:
        dump_node(arrays, meta, int(sys.argv[sys.argv.index("--node") + 1]))
    else:
        validate(meta, arrays)


if __name__ == "__main__":
    main()
