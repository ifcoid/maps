#!/usr/bin/env python3
"""Bangun GeoJSON peta Weberek dari OpenStreetMap + koordinat Inception Report.

Sumber:
  - Koordinat situs (P1..P4, existing prison building) dan trafo 50 kVA:
    Inception Report proyek induk (Table 3, Figure 42), dicatat di NetDet
    02-referensi/proyek-induk-weberek/inception-report-fulltext.txt.
  - Geometri jalan akses + jalur transmisi EDTL: OpenStreetMap (ODbL), ID way
    dipatok di bawah supaya hasil build bisa diulang.

Pakai:  python3 tools/build_weberek_data.py   (menulis ke data/)
"""
import json
import math
import pathlib
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
OVERPASS = "https://overpass-api.de/api/interpreter"
USER_AGENT = "ifcoid-maps/0.1 (NetDet Weberek ITC)"

# Rantai way OSM dari persimpangan jalan utama Betano-Umaboco (A) ke situs,
# (id, dibalik?) sesuai arah A -> situs.
CORRIDOR_WAYS = [(132078055, False), (132078712, False), (150033098, True), (1101678303, True)]
TRANSMISSION_WAY = 569858669  # jalur transmisi EDTL (power=line) yang lewat Dotik
# Track di luar sisi selatan situs: dari dekat trafo (ujung akhir) ke titik masuk E (ujung awal).
SOUTH_TRACK_WAY = 1215048172
CLIP_BBOX = (125.86, -9.10, 125.99, -8.99)  # lon/lat min-max untuk memotong jalur transmisi

# Panjang ruas cor dari A menurut Inception Report Figure 41 (A-B-C, +-4 km).
CONCRETE_LENGTH = 4000


def dms(d, m, s, negative=False):
    value = d + m / 60 + s / 3600
    return round(-value if negative else value, 7)


# Inception Report Table 3 (WGS84). Longitude P2/P4 di teks Bab 3 salah ketik;
# yang dipakai nilai tabel.
SITE = {
    "P1": (dms(125, 53, 44.96), dms(9, 0, 58.32, True)),
    "P2": (dms(125, 53, 35.19), dms(9, 0, 48.84, True)),
    "P3": (dms(125, 53, 45.21), dms(9, 0, 39.04, True)),
    "P4": (dms(125, 53, 55.20), dms(9, 0, 46.13, True)),
}
EXISTING_BUILDING = (dms(125, 53, 41.16), dms(9, 0, 47.49, True))
TRANSFORMER = (dms(125, 53, 34.97), dms(9, 0, 58.40, True))
CHURCH = (125.91521, -9.02501)  # Assembly of God, Aldeia Weberek (OSM node 1453634670)
DOTIK = (125.91691, -9.07051)   # OSM node 1785401012


def distance(a, b):
    """Jarak haversine (m), jari-jari sama dengan croot.js geomeasure."""
    r = 6371008.8
    la1, la2 = math.radians(a[1]), math.radians(b[1])
    h = (math.sin((la2 - la1) / 2) ** 2
         + math.cos(la1) * math.cos(la2) * math.sin(math.radians(b[0] - a[0]) / 2) ** 2)
    return 2 * r * math.atan2(math.sqrt(h), math.sqrt(1 - h))


def length(line):
    return sum(distance(a, b) for a, b in zip(line, line[1:]))


def overpass(query):
    body = urllib.parse.urlencode({"data": query}).encode()
    req = urllib.request.Request(OVERPASS, data=body, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=180) as resp:
        return json.load(resp)


def fetch_ways(ids):
    result = overpass(f"[out:json][timeout:120];way(id:{','.join(map(str, ids))});out geom;")
    return {e["id"]: [(p["lon"], p["lat"]) for p in e["geometry"]] for e in result["elements"]}


def chain(ways):
    line = []
    for way_id, reverse in CORRIDOR_WAYS:
        points = ways[way_id][::-1] if reverse else ways[way_id]
        if line:
            if distance(line[-1], points[0]) > 1:
                raise SystemExit(f"Way {way_id} tidak menyambung ({distance(line[-1], points[0]):.0f} m)")
            points = points[1:]
        line += points
    return line


def split_at(line, chainage):
    """Pecah garis di jarak `chainage` (m) dari awal; kembalikan (kepala, ekor, titik potong)."""
    run = 0.0
    for i, (a, b) in enumerate(zip(line, line[1:])):
        step = distance(a, b)
        if run + step >= chainage:
            t = (chainage - run) / step
            cut = (round(a[0] + t * (b[0] - a[0]), 7), round(a[1] + t * (b[1] - a[1]), 7))
            return line[:i + 1] + [cut], [cut] + line[i + 1:], cut
        run += step
    raise ValueError("chainage melebihi panjang garis")


def segment_intersection(p, p2, q, q2):
    """Titik potong ruas p-p2 dan q-q2 (bidang datar lokal), atau None."""
    r = (p2[0] - p[0], p2[1] - p[1])
    s = (q2[0] - q[0], q2[1] - q[1])
    den = r[0] * s[1] - r[1] * s[0]
    if den == 0:
        return None
    t = ((q[0] - p[0]) * s[1] - (q[1] - p[1]) * s[0]) / den
    u = ((q[0] - p[0]) * r[1] - (q[1] - p[1]) * r[0]) / den
    if 0 <= t <= 1 and 0 <= u <= 1:
        return t
    return None


def first_boundary_crossing(line, ring):
    """Chainage (m) tempat garis pertama kali memotong batas polygon."""
    run = 0.0
    for a, b in zip(line, line[1:]):
        hits = [t for q, q2 in zip(ring, ring[1:]) if (t := segment_intersection(a, b, q, q2)) is not None]
        if hits:
            return run + min(hits) * distance(a, b)
        run += distance(a, b)
    raise ValueError("garis tidak memotong batas situs")


def ring_area(ring):
    """Luas polygon kecil (m2) dengan proyeksi equirectangular lokal."""
    lat0 = math.radians(sum(p[1] for p in ring) / len(ring))
    k = 6371008.8 * math.pi / 180
    xy = [(p[0] * k * math.cos(lat0), p[1] * k) for p in ring]
    return abs(sum(x1 * y2 - x2 * y1 for (x1, y1), (x2, y2) in zip(xy, xy[1:]))) / 2


def clip_to_bbox(line, bbox):
    inside = [p for p in line if bbox[0] <= p[0] <= bbox[2] and bbox[1] <= p[1] <= bbox[3]]
    return inside


def feature(geometry_type, coordinates, **properties):
    return {"type": "Feature", "properties": properties,
            "geometry": {"type": geometry_type, "coordinates": coordinates}}


def point(position, **properties):
    return feature("Point", list(position), **properties)


def line_feature(line, **properties):
    return feature("LineString", [list(p) for p in line], **properties)


def write(name, features):
    path = DATA / name
    path.write_text(json.dumps({"type": "FeatureCollection", "features": features}, indent=1) + "\n")
    print(f"{path.relative_to(ROOT)}: {len(features)} features")


def main():
    DATA.mkdir(exist_ok=True)
    ways = fetch_ways([w for w, _ in CORRIDOR_WAYS] + [TRANSMISSION_WAY, SOUTH_TRACK_WAY])
    road = chain(ways)

    ring = [SITE[k] for k in ("P1", "P2", "P3", "P4", "P1")]
    site_area = ring_area(ring)
    entry_chainage = first_boundary_crossing(road, ring)
    concrete, rest, point_c = split_at(road, CONCRETE_LENGTH)
    unpaved, frontage, point_e = split_at(rest, entry_chainage - CONCRETE_LENGTH)
    weberek = min(road, key=lambda p: distance(p, CHURCH))
    weberek_chainage = length(road[:road.index(weberek) + 1])

    # --- situs ---
    site = [feature("Polygon", [[list(p) for p in ring]],
                    name="Weberek Correctional Facility site",
                    kind="site",
                    area_ha=round(site_area / 10000, 1),
                    location="Bairo Wesa, Aldeia Weberek, Suco Dotik, Posto Alas, Manufahi",
                    source="Inception Report Table 3 (WGS84 corners P1-P4)")]
    site += [point(pos, name=key, kind="boundary", source="Inception Report Table 3")
             for key, pos in SITE.items()]
    site.append(point(EXISTING_BUILDING, name="Existing prison building", kind="building",
                      source="Inception Report Table 3"))
    write("weberek-site.geojson", site)

    # --- koridor akses ---
    total = entry_chainage
    corridor = [
        line_feature(concrete, name="A-C: concrete-stabilized section", kind="road-concrete",
                     length_m=round(length(concrete)),
                     note="First approx. 4 km from junction A (Inception Report Fig. 41)"),
        line_feature(unpaved, name="C-E: degraded unpaved section", kind="road-unpaved",
                     length_m=round(length(unpaved)),
                     note="Frequently impassable in the wet season; reconstruction is a parent-project mitigation"),
        line_feature(frontage, name="Existing track across the site (towards Bairo Wesa)", kind="road-frontage",
                     length_m=round(length(frontage)),
                     note="Crosses the parcel; superseded by the site layout"),
        point(road[0], name="A", kind="node", chainage_m=0,
              label="Junction with Betano-Umaboco main road",
              note="Proposed fiber demarcation/splice point; national backbone PoP to be confirmed (DNIC/operators)"),
        point(point_c, name="C", kind="node", chainage_m=CONCRETE_LENGTH,
              label="End of concrete-stabilized section"),
        point(weberek, name="D", kind="node", chainage_m=round(weberek_chainage),
              label="Aldeia Weberek (Assembly of God church)"),
        point(point_e, name="E", kind="node", chainage_m=round(total),
              label="Site entry (road meets site boundary)"),
        point(DOTIK, name="Dotik", kind="place", source="OSM node 1785401012"),
    ]
    write("weberek-access-corridor.geojson", corridor)

    # --- listrik ---
    # Tie-in lewat track selatan, di luar persil: trafo -> track -> E.
    tie_in = [TRANSFORMER] + ways[SOUTH_TRACK_WAY][::-1] + [point_e]
    # Garis MV eksisting: tiang lurus dari simpang Aldeia Weberek (D) ke trafo; panjangnya
    # cocok dengan IR Fig. 42 (+-2.577 m), jadi tidak mengikuti jalan.
    mv_route = [weberek, TRANSFORMER]
    transmission = clip_to_bbox(ways[TRANSMISSION_WAY], CLIP_BBOX)
    power = [
        point(TRANSFORMER, name="Existing 50 kVA transformer", kind="transformer",
              detail="Pole-mounted, H-frame, three-phase MV; ground-level feeder pillar with LV panel",
              coordinate="S 9 00 58.40, E 125 53 34.97",
              distance_to_site_entry_m=round(length(tie_in)),
              note="Adequate for construction power only; 24/7 operation needs a dedicated substation + 2 gensets (MEP scope)",
              source="Inception Report Fig. 42-44"),
        line_feature(mv_route, name="Existing MV distribution line (indicative)", kind="mv-existing",
                     length_m=round(length(mv_route)),
                     note="Straight pole line from the Aldeia Weberek junction (D) to the transformer, matching the approx. 2,577 m stated in the Inception Report; alignment not surveyed",
                     source="Inception Report Fig. 42"),
        line_feature(tie_in, name="Proposed supply tie-in: transformer to site entry", kind="mv-proposed",
                     length_m=round(length(tie_in)),
                     note="Indicative route along the existing track outside the south boundary, avoiding the compound; continues inside the site to the power house near the chapel (MP no. 10, 14/15). MEP/EDTL scope.",
                     source=f"OSM way {SOUTH_TRACK_WAY}; MoM 3 Jul 2026; Master Plan Rev.14"),
        line_feature(transmission, name="EDTL transmission line", kind="transmission",
                     source=f"OpenStreetMap way {TRANSMISSION_WAY}"),
    ]
    write("weberek-power.geojson", power)

    print(f"corridor A->E {total:.0f} m (A->C {length(concrete):.0f}, C->E {length(unpaved):.0f}), "
          f"D at {weberek_chainage:.0f} m; site {site_area / 10000:.1f} ha; tie-in {length(tie_in):.0f} m; "
          f"MV D->T {length(mv_route):.0f} m")


if __name__ == "__main__":
    main()
