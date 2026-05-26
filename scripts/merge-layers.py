"""
merges the nparks, lta and ura .geojson files ripped from data.gov.sg into a singular .geojson
"""

import sys
from pathlib import Path
import geopandas as gpd
import pandas as pd

# paths
root = Path(__file__).parent.parent # proj root
source_dir = Path(__file__).parent / "source-data" # data goes here
output_path = root / "public" / "data" / "merged.geojson" # in /public so frontend can access it

# edit the file names if there's new updated .geojsons
nparks_geojson = source_dir / "ParkConnectorLoop.geojson" # major pcn networks, named loop routes, managed by NParks
lta_geojson = source_dir / "CyclingPathNetworkGEOJSON.geojson" # in-neighbourhood cycling paths, managed by LTA & Town Council
ura_geojson = source_dir / "MasterPlan2025SDCPCyclingNetworklayer.geojson" # a LOT of cycle paths, but most are not done, just planned for the future, from URA

# do math in svy21 coord ref system
# reproject back to wgs84 after, since MapLibre uses WGS84
crs_sg = "EPSG:3414"
crs_wgs84  = "EPSG:4326"

# a LTA or URA segment is considered a duplicate of a PCN segment if more
# than this fraction of its length falls inside the nparks PCN buffer.
duplicate_overlap_threshold = 0.70  # 70%

# buffer radius (metres) around PCN features used for duplicate detection.
pcn_buffer_radius = 15  # metres

# load data
def load_nparks(path: Path) -> gpd.GeoDataFrame:
    print("Loading NPARKS...")
    gdf = gpd.read_file(path)
    print(f"{len(gdf)} features loaded")

    gdf = gdf.explode(index_parts=False).reset_index(drop=True)

    gdf["source_dir"] = "nparks"
    gdf["path_type"] = "pcn"
    gdf["name"] = gdf["PARK"].fillna("")
    gdf["pcn_loop"] = gdf["PCN_LOOP"].fillna("")
    gdf["agency"] = ""

    print(f"  {len(gdf)} features after exploding MultiLineStrings")
    return gdf[["source_dir", "path_type", "name", "pcn_loop", "agency", "geometry"]]


def load_lta(path: Path) -> gpd.GeoDataFrame:
    print("Loading LTA...")
    gdf = gpd.read_file(path)
    print(f"  {len(gdf)} features loaded")

    gdf = gdf.explode(index_parts=False).reset_index(drop=True)

    gdf["source_dir"] = "lta"
    gdf["path_type"] = "cycling_path"
    gdf["name"] = gdf["CYL_PATH"].fillna("")
    gdf["pcn_loop"] = ""
    gdf["agency"] = gdf["AGENCY_MAINT"].fillna("")

    print(f"  {len(gdf)} features after exploding MultiLineStrings")
    return gdf[["source_dir", "path_type", "name", "pcn_loop", "agency", "geometry"]]


def load_ura(path: Path) -> gpd.GeoDataFrame:
    print("Loading URA...")
    gdf = gpd.read_file(path)
    print(f"  {len(gdf)} features loaded")

    existing = gdf[gdf["PRP_STATUS"] == "EXISTING"].copy() # remove planned routes, only keep existing routes (PRP_STATUS="EXISTING")
    planned  = len(gdf) - len(existing)
    print(f"  Dropped {planned} PLANNED features, keeping {len(existing)} EXISTING")

    existing = existing.explode(index_parts=False).reset_index(drop=True)

    existing["source_dir"]    = "ura"
    existing["path_type"] = "cycling_path"
    existing["name"]      = ""
    existing["pcn_loop"]  = ""
    existing["agency"]    = ""

    print(f"  {len(existing)} features after exploding MultiLineStrings")
    return existing[["source_dir", "path_type", "name", "pcn_loop", "agency", "geometry"]]

# function to remove dupes
def remove_pcn_duplicates(
    candidate: gpd.GeoDataFrame,
    pcn: gpd.GeoDataFrame,
    label: str,
) -> gpd.GeoDataFrame:
    
    print(f"\nDeduplicating {label} against NPARKS (buffer={pcn_buffer_radius}m, threshold={duplicate_overlap_threshold:.0%})...")

    pcn_metric = pcn.to_crs(crs_sg) # convert into svy21
    candidate_sg = candidate.to_crs(crs_sg)

    pcn_buffer = pcn_metric.buffer(pcn_buffer_radius).union_all() # combine/union/merge all pcn tgt with a buffer

    keep   = []
    dropped = 0

    for idx, row in candidate_sg.iterrows():
        geom   = row.geometry
        length = geom.length

        if length == 0: # if cycle path has 0 length somehow
            dropped += 1
            continue

        inside_length = geom.intersection(pcn_buffer).length
        overlap_ratio = inside_length / length # check how much of this segment is inside the PCN buffer

        if overlap_ratio >= duplicate_overlap_threshold: # if overlap too much, drop
            dropped += 1
        else:
            keep.append(idx)

    result = candidate.loc[keep].copy()
    print(f"  Dropped {dropped} duplicates, kept {len(result)} unique features")
    return result

# generate report to see how many PCN in merged geojson
def report(gdf: gpd.GeoDataFrame) -> None:
    print("Merge Summary")
    print(f"Num of PCN/Cycle Paths : {len(gdf)}")

    by_source_dir = gdf.groupby("source_dir").size()
    print("\nBy source_dir:")

    for src, count in by_source_dir.items(): # print how many PCN from each dataset
        print(f"{src:10s}: {count}")


def main() -> None:
    # make sure dataset files are in the right folder
    for label, path in [("NPARKS", nparks_geojson), ("LTA", lta_geojson), ("URA", ura_geojson)]:
        if not path.exists():
            print(f"ERROR: {label} file not found at {path}")
            print("Place your GeoJSONs in scripts/source-data/")
            sys.exit(1)

    output_path.parent.mkdir(parents=True, exist_ok=True)

    # load datasets
    nparks = load_nparks(nparks_geojson)
    lta    = load_lta(lta_geojson)
    ura    = load_ura(ura_geojson)

    nparks = nparks.set_crs(crs_wgs84)
    lta    = lta.set_crs(crs_wgs84)
    ura    = ura.set_crs(crs_wgs84)

    # remove duplicate PCN/cycle paths, use nparks dataset as reference
    lta_deduped = remove_pcn_duplicates(lta, nparks, "LTA")
    ura_deduped = remove_pcn_duplicates(ura, nparks, "URA")

    # merge all 3 into 1
    print("\nMerging layers...")
    merged = gpd.GeoDataFrame(
        pd.concat([nparks, lta_deduped, ura_deduped], ignore_index=True),
        crs=crs_wgs84,
    )

    # drop any null or empty
    before = len(merged)
    merged = merged[~merged.geometry.is_empty & merged.geometry.notna()].copy()
    if len(merged) < before:
        print(f"  Dropped {before - len(merged)} null/empty geometries")

    report(merged)

    # return file
    merged.to_file(output_path, driver="GeoJSON")
    print(f"{output_path} created")


if __name__ == "__main__":
    main()
