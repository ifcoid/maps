#!/usr/bin/env python3
"""Master Plan Rev.14 (DXF) -> data/weberek-masterplan-rev14.geojson + titik ITC.

DXF dibuat dari DWG proyek induk dengan konverter NetDet:
  NetDet/03-survei/tools/dwg-convert.sh -f dxf -o /tmp/mp14 \
      "NetDet/02-referensi/proyek-induk-weberek/sumber/MASTER PLAN Rev.14.dwg"
Pakai (butuh ezdxf):
  python3 tools/build_masterplan.py "/tmp/mp14/MASTER PLAN Rev.14.dxf"

Georeferensi: tools/georef_rev14.py (rigid, +-50 m).
Titik ITC disalin dari NetDet/05-desain/gambar-cad/cad/build_overlay_dwg.py
(lembar overlay Rev.14); ubah di sana dulu, lalu salin ke sini.
"""
import json
import math
import pathlib
import re
import sys

import ezdxf

from georef_rev14 import cad_to_lonlat, residuals, THETA

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "private"   # data sensitif: plaintext tidak di-commit, lihat tools/encrypt_data.py

# Batas area yang diambil (grid CAD); di luarnya legenda dan kop gambar.
BBOX = (27500, -650, 29500, 850)
MIN_LENGTH = 2.0  # m; garis lebih pendek (simbol, perabot) dibuang
TOLERANCE = 0.25  # m; toleransi penyederhanaan Douglas-Peucker

# layer CAD -> jenis fitur peta
KINDS = {
    "C-TINN-BNDY": "mp-survey",
    "1 Pagar 01 Tembok Utama": "mp-wall",
    "1 Pagar 02 keliling Sel Napi": "mp-fence",
    "Garis Atap": "mp-roof",
    "0": "mp-line",
    "Wall 15": "mp-line",
    "WALL": "mp-line",
    "Wall Line": "mp-line",
    "DENAH": "mp-line",
}

# Nama generik per jenis/layer untuk garis yang tidak dekat label mana pun.
GENERIC = {
    "mp-roof": "Building roof outline",
    "mp-survey": "Topographic survey boundary",
    "mp-line": "Site layout line (roads, kerbs, platforms, building walls)",
}
AREA_LABELS = {"PARKING AREA": "Parking area", "VIP ENTER & LOADING WAY": "VIP entrance & loading way",
               "WATER SUPPLY & FIRE HYDRAND": "Water supply & fire hydrant area",
               "EXISTING RECLUSES BUILDING": "Existing recluses building", "EXISTING MUDDY ROAD": "Existing muddy road",
               "RURAL HOUSING AREA": "Rural housing area", "COMMUNAL RICE FIELD": "Communal rice field"}
MP_RADIUS = 20    # m; jarak maksimum titik tengah garis ke label nomor MP
AREA_RADIUS = 35  # m; jarak maksimum ke label area
MAX_BUILDING_AREA = 6000  # m2; bentuk tertutup lebih besar = platform/area, bukan bangunan
MAX_PART_LENGTH = 150     # m; garis lebih panjang (jalan, platform) tidak dinamai dari label terdekat

# --- titik ITC (grid CAD, m) dari build_overlay_dwg.py ---
WALL = [(28384.4, 85.9), (28322.0, -43.5), (28122.5, 52.7), (28152.9, 115.8), (28108.0, 137.4),
        (28077.2, 189.0), (28118.2, 273.9), (28177.7, 282.0), (28222.6, 260.3), (28253.0, 323.4),
        (28452.5, 227.1), (28389.6, 96.6)]
PARCEL = [(27858.3, 189.7), (28205.5, 462.2), (28518.3, 320.2), (28228.5, -280.5)]
TOWERS = {"T1": (28253, 321), "T2": (28449, 226), "T3": (28320, -40), "T4": (28124, 55), "T5": (28098, 231)}
GATES = {"MG": (28387, 91), "NG": (28207, 266), "SG": (28231, 2)}
CR, PH, BTS = (28295, 137), (28420, 210), (28455, 45)
BACKHAUL = [CR, GATES["MG"], (28420, 84), (28398, 10), (28420, -29), (28560, -130)]
BENCHMARKS = {"BM1": ((28038.466, 183.035), "N 1998.052, E 8387.661, Z 167.663"),
              "BM2": ((28214.156, -72.091), "N 1742.926, E 8563.351, Z 160.551"),
              "BM3": ((28405.954, 159.623), "N 1974.640, E 8755.149, Z 162.473")}
WATER = [(28030.0, 151.7), (28148.1, 65.8), (28234.3, -180.9)]


def inside(points):
    return all(BBOX[0] <= x <= BBOX[2] and BBOX[1] <= y <= BBOX[3] for x, y in points)


def length(points):
    return sum(math.dist(a, b) for a, b in zip(points, points[1:]))


def simplify(points, tolerance=TOLERANCE):
    """Douglas-Peucker di grid CAD (m)."""
    if len(points) < 3:
        return points
    (x1, y1), (x2, y2) = points[0], points[-1]
    span = math.hypot(x2 - x1, y2 - y1)
    def offset(p):
        if span == 0:
            return math.hypot(p[0] - x1, p[1] - y1)
        return abs((x2 - x1) * (y1 - p[1]) - (x1 - p[0]) * (y2 - y1)) / span
    i, worst = max(((i, offset(p)) for i, p in enumerate(points[1:-1], 1)), key=lambda t: t[1])
    if worst <= tolerance:
        return [points[0], points[-1]]
    return simplify(points[:i + 1], tolerance)[:-1] + simplify(points[i:], tolerance)


def lonlat(points):
    # 6 desimal = +-10 cm, jauh di bawah akurasi georeferensi
    return [[round(v, 6) for v in cad_to_lonlat(x, y)] for x, y in points]


def feature(kind, geometry_type, coordinates, **properties):
    return {"type": "Feature", "properties": {"kind": kind, **properties},
            "geometry": {"type": geometry_type, "coordinates": coordinates}}


def polygon(kind, points, **properties):
    ring = points if points[0] == points[-1] else points + [points[0]]
    return feature(kind, "Polygon", [lonlat(ring)], **properties)


def line(kind, points, **properties):
    return feature(kind, "LineString", lonlat(points), **properties)


def point(kind, xy, **properties):
    return feature(kind, "Point", [round(v, 6) for v in cad_to_lonlat(*xy)], **properties)


def entity_points(entity):
    kind = entity.dxftype()
    if kind == "LINE":
        return [(entity.dxf.start.x, entity.dxf.start.y), (entity.dxf.end.x, entity.dxf.end.y)], False
    if kind == "LWPOLYLINE":
        return [(p[0], p[1]) for p in entity.get_points("xy")], entity.closed
    return None, False


def text_of(entity):
    return (entity.plain_text() if entity.dxftype() == "MTEXT" else entity.dxf.text).strip()


def read_labels(msp):
    """Legenda MP (nomor -> nama), posisi label nomor MP, dan posisi label area."""
    legend, numbers, areas = {}, [], []
    for e in msp.query('MTEXT TEXT[layer=="0"]'):
        text = text_of(e)
        xy = (e.dxf.insert.x, e.dxf.insert.y)
        if text.startswith("LEGEND"):
            legend = {int(n): name.strip() for n, name in re.findall(r"(\d+)\.\s*([^\n]+)", text)}
        elif text.isdigit():
            numbers.append((int(text), xy))
        elif text in AREA_LABELS:
            areas.append((AREA_LABELS[text], xy))
    return legend, numbers, areas


def ring_area(ring):
    return abs(sum(x1 * y2 - x2 * y1 for (x1, y1), (x2, y2) in zip(ring, ring[1:] + ring[:1]))) / 2


def point_in(xy, ring):
    x, y = xy
    hit = False
    for (x1, y1), (x2, y2) in zip(ring, ring[1:] + ring[:1]):
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            hit = not hit
    return hit


def describe(kind, layer, pts, closed, labels, zones):
    """Properti popup untuk satu garis master plan: nama dari label MP/area terdekat.
    Sumber tidak disimpan per fitur (ukuran file); halaman menyusunnya dari `layer`."""
    legend, numbers, areas = labels
    cx = sum(p[0] for p in pts) / len(pts)
    cy = sum(p[1] for p in pts) / len(pts)
    props = {"layer": layer, "length_m": round(length(pts), 1)}
    for zone, ring in zones:
        if point_in((cx, cy), ring):
            props["zone"] = zone
            break
    else:
        props["zone"] = "outside the prison parcel"
    if kind == "mp-survey":
        props["name"] = GENERIC[kind] + ("" if closed else " (river side)")
        return props
    name = None
    if closed and ring_area(pts) <= MAX_BUILDING_AREA:
        # bentuk tertutup kecil yang memuat label nomor MP = bangunan itu sendiri
        inside_labels = [(n, xy) for n, xy in numbers if point_in(xy, pts)]
        if inside_labels:
            n = min(inside_labels, key=lambda t: math.dist(t[1], (cx, cy)))[0]
            name = f"MP no. {n}: {legend.get(n, '?')}"
    near = props["length_m"] <= MAX_PART_LENGTH  # titik tengah garis panjang tidak bermakna
    if not name and near and numbers:
        n, xy = min(numbers, key=lambda t: math.dist(t[1], (cx, cy)))
        if math.dist(xy, (cx, cy)) <= MP_RADIUS:
            name = f"MP no. {n}: {legend.get(n, '?')} (part of)"
    if not name and near and areas:
        area, xy = min(areas, key=lambda t: math.dist(t[1], (cx, cy)))
        if math.dist(xy, (cx, cy)) <= AREA_RADIUS:
            name = f"{area} (layout)"
    props["name"] = name or GENERIC.get(kind, "Master plan line")
    return props


def masterplan(msp):
    features = []
    labels = read_labels(msp)
    zones = [("inside the prison wall (PAGAR 01)", WALL), ("inside the prison parcel (25 ha)", PARCEL)]
    # Persil: dua polyline "Pagar 03 Area 25H" = batas 25 ha dan pagar area rumah dinas.
    parcels = [entity_points(e)[0] for e in msp.query('LWPOLYLINE[layer=="1 Pagar 03 Area 25H"]')]
    for pts in parcels:
        if len(pts) == 5:
            features.append(polygon("mp-boundary", pts[:4], name="Prison parcel (PAGAR 03, approx. 25 ha)",
                                    source="Master Plan Rev.14"))
        else:
            features.append(line("mp-fence", pts, name="Staff housing fence (PAGAR 03)",
                                 length_m=round(length(pts), 1), source="Master Plan Rev.14"))
    for e in msp.query('LWPOLYLINE[layer=="1 Pagar 04 Alternative"]'):
        features.append(polygon("mp-agri", entity_points(e)[0], name="Agricultural area (58 ha)",
                                source="Master Plan Rev.14"))
    for e in msp.query("LINE LWPOLYLINE"):
        kind = KINDS.get(e.dxf.layer)
        if not kind:
            continue
        pts, closed = entity_points(e)
        if not pts or len(pts) < 2 or not inside(pts):
            continue
        if closed:
            pts = pts + [pts[0]]
        if length(pts) < MIN_LENGTH:
            continue
        if kind in ("mp-wall", "mp-fence"):
            props = {"name": {"mp-wall": "Prison wall (PAGAR 01)",
                              "mp-fence": "Inmate zone fence (PAGAR 02)"}[kind],
                     "length_m": round(length(pts), 1), "source": "Master Plan Rev.14"}
        else:
            props = describe(kind, e.dxf.layer, pts, closed, labels, zones)
        features.append(line(kind, simplify(pts), **props))
    # Existing building: polyline 9 titik (+-52 x 9 m, cocok dengan IR 51,66 x 9,35 m).
    for e in msp.query('LWPOLYLINE[layer=="0"]'):
        pts = entity_points(e)[0]
        if len(pts) == 9 and abs(sum(p[0] for p in pts) / 9 - 28134.6) < 2:
            features.append(polygon("mp-existing", pts, name="Existing prison building",
                                    detail="Surveyed outline, approx. 52 x 9 m (IR: 51.66 x 9.35 m)",
                                    source="Master Plan Rev.14"))
            break  # outline yang sama digambar dua kali di DWG
    return features


def itc_layer():
    features = [line("itc-backhaul", BACKHAUL, name="Fiber backhaul duct (ITC)",
                     note="ER/CR to main gate, then along the gate road to the site exit towards Dotik",
                     source="ITC-NET-002 / GEN-002 (Interim Rev.1)")]
    features.append(point("itc-node", CR, name="ER/CR", label="Equipment room / control room, Head Office (MP no. 4)"))
    features.append(point("itc-node", PH, name="PH", label="Power house / genset (MP no. 14/15): ITC supply point"))
    features.append(point("itc-node", BTS, name="BTS", label="BTS monopole co-location (3 operators)"))
    for key, xy in GATES.items():
        features.append(point("itc-gate", xy, name=key, label={"MG": "Main gate", "NG": "North gate",
                                                                "SG": "South gate"}[key]))
    for key, xy in TOWERS.items():
        features.append(point("itc-tower", xy, name=key, label="Guard tower (MP no. 30)"))
    for key, (xy, metric) in BENCHMARKS.items():
        features.append(point("mp-benchmark", xy, name=key, label="Survey benchmark", detail=metric))
    for i, xy in enumerate(WATER, 1):
        features.append(point("mp-water", xy, name=f"W{i}", label="Water source (borehole, GRS)"))
    return features


def write(name, features):
    path = OUT / name
    path.write_text(json.dumps({"type": "FeatureCollection", "features": features}, separators=(",", ":")) + "\n")
    print(f"{path.relative_to(ROOT)}: {len(features)} features, {path.stat().st_size / 1024:.0f} KiB")


def main():
    msp = ezdxf.readfile(sys.argv[1]).modelspace()
    print(f"georef: rotation {math.degrees(THETA):.2f} deg, residuals (m) {residuals()}")
    write("weberek-masterplan-rev14.geojson", masterplan(msp))
    write("weberek-itc.geojson", itc_layer())


if __name__ == "__main__":
    main()
