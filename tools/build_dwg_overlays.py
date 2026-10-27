"""Vektor DWG overlay ITC -> GeoJSON (private/, lalu dienkripsi encrypt_data.py).

1. ITC-CELLBLOCK-OVERLAY.dwg (lembar ITC-VSS-002): denah tipikal blok sel (satuan mm)
   beserta 4 kamera dan kerucut pandangnya, dipasang ke kelima blok MP no. 8 Rev.14.
   Penempatan: atap denah tipikal (layer "Garis Atap", 40,5 x 17,0 m) dicocokkan ke
   atap tiap blok di master plan (keliling sama, 115 m). Arah: ujung kanopi pintu
   masuk / sally port (grid K-L) dibaca dari garis atap+kanopi blok di master plan.
   Sisi kiri/kanan (cermin) tidak bisa dibaca dari atap; denah dipasang tanpa
   dicerminkan, jadi sisi kamera kamar mandi (CAM-Bx03) indikatif. Huruf blok A-E
   tidak tercantum di master plan: blok diberi nomor posisi 1-5.
2. ITC-SITE-OVERLAY-REV14.dwg: anotasi lembar (MTEXT + leader) di layer ITC-TXT-<lembar>,
   untuk lembar GEN-002, GEN-003, NET-002, VSS-001, PID-001, COM-002. Geometri ITC-nya
   sendiri sudah ada di weberek-itc-design.geojson (sumber yang sama).

Pemakaian (butuh ezdxf; DWG->DXF dengan NetDet/03-survei/tools/dwg-convert.sh -f dxf):
  python tools/build_dwg_overlays.py ITC-CELLBLOCK-OVERLAY.dxf ITC-SITE-OVERLAY-REV14.dxf
"""
import json
import math
import sys
from pathlib import Path

import ezdxf
from ezdxf import bbox, disassemble, path as dpath

from build_itc_design import BLOCK_ROWS, SCHEDULES, rows
from georef_rev14 import cad_to_lonlat, lonlat_to_cad

ROOT = Path(__file__).resolve().parents[1]
REGION = (0, -3000, 54000, 27000)        # denah utama di model space blok (mm)
ROOF = (5566, 3844, 46066, 20844)        # atap denah tipikal (mm)
PLAN_C = ((ROOF[0] + ROOF[2]) / 2, (ROOF[1] + ROOF[3]) / 2)
SKIP_LAYERS = {"GRID LINE", "Dimensi", "SECTION SYMBOL", "Garis Atap"}
SKIP_TYPES = {"TEXT", "MTEXT", "DIMENSION", "HATCH", "ATTRIB", "ATTDEF", "WIPEOUT", "POINT"}
FLATTEN = 40.0                           # mm, toleransi busur -> garis
SIMPLIFY = 0.03                          # m, Douglas-Peucker
MIN_LEN = 200.0                          # mm: goresan pendek (arsir/pola dalam blok furnitur) dibuang
SHEETS = ["GEN-002", "GEN-003", "NET-002", "VSS-001", "PID-001", "COM-002"]
CAMS = {   # dari ITC-VSS-002 (ketentuan instalasi)
    "CAM-Bx01": "Corridor vandal dome (FCL +3.080), facing CAM-Bx02; records all D4 cell-door events.",
    "CAM-Bx02": "Corridor vandal dome (FCL +3.080), facing CAM-Bx01; records all D4 cell-door events.",
    "CAM-Bx03": "Shower, high mount, privacy masking of wet areas per MoJ policy, humidity-resistant housing.",
    "CAM-Bx04": "Inside the block sally port: entrance door D3 and the ID & key desk; tied to the interlock cycle.",
}


def simplify(pts, tol=SIMPLIFY):
    if len(pts) < 3:
        return pts
    a, b = pts[0], pts[-1]
    dx, dy = b[0] - a[0], b[1] - a[1]
    n = math.hypot(dx, dy) or 1e-9
    d = [abs(dy * (p[0] - a[0]) - dx * (p[1] - a[1])) / n for p in pts[1:-1]]
    i = max(range(len(d)), key=d.__getitem__)
    if d[i] <= tol:
        return [a, b]
    return simplify(pts[:i + 2], tol)[:-1] + simplify(pts[i + 1:], tol)


def lonlat(points):
    return [list(cad_to_lonlat(*p)) for p in points]


def feature(kind, geometry_type, coordinates, **props):
    return {"type": "Feature", "properties": {"kind": kind, **{k: v for k, v in props.items() if v is not None}},
            "geometry": {"type": geometry_type, "coordinates": coordinates}}


# ------------------------------- blok sel ----------------------------------
def site_blocks():
    """(pusat atap, sumbu ke ujung kanopi, pusat lengkap) tiap blok MP no. 8 di grid CAD."""
    mp = json.loads((ROOT / "private" / "weberek-masterplan-rev14.geojson").read_text())
    blocks = []
    outlines = [[lonlat_to_cad(*q) for q in f["geometry"]["coordinates"]] for f in mp["features"]
                if f["properties"].get("name", "").startswith("MP no. 8: BLOC") and f["properties"]["kind"] == "mp-line"
                and "(part of)" not in f["properties"]["name"] and len(f["geometry"]["coordinates"]) == 9]
    for f in mp["features"]:
        p = f["properties"]
        if p["kind"] != "mp-roof" or not p.get("name", "").startswith("MP no. 8"):
            continue
        ring = [lonlat_to_cad(*q) for q in f["geometry"]["coordinates"]][:4]
        c = (sum(q[0] for q in ring) / 4, sum(q[1] for q in ring) / 4)
        edges = [(ring[i], ring[(i + 1) % 4]) for i in range(4)]
        a, b = max(edges, key=lambda e: math.dist(*e))
        L = math.dist(a, b)
        u = ((b[0] - a[0]) / L, (b[1] - a[1]) / L)
        # garis atap + kanopi blok ini: ujung yang lebih jauh dari pusat = sisi kanopi
        outline = min(outlines, key=lambda o: math.dist(c, (sum(q[0] for q in o) / 9, sum(q[1] for q in o) / 9)))
        proj = [(q[0] - c[0]) * u[0] + (q[1] - c[1]) * u[1] for q in outline]
        if -min(proj) > max(proj):
            u = (-u[0], -u[1])
        reach = max(abs(x) for x in proj)
        blocks.append({"c": c, "u": u, "length": L, "reach": reach})
    assert len(blocks) == 5, len(blocks)
    hub = (28235, 165)   # pusat hub MP no. 7 (grid CAD): blok diberi nomor berlawanan jarum jam
    blocks.sort(key=lambda k: math.atan2(k["c"][1] - hub[1], k["c"][0] - hub[0]))
    return blocks


def placer(block):
    (cx, cy), (ux, uy) = block["c"], block["u"]
    vx, vy = -uy, ux

    def to_cad(x, y):
        a, b = (x - PLAN_C[0]) / 1000, (y - PLAN_C[1]) / 1000
        return cx + a * ux + b * vx, cy + a * uy + b * vy
    return to_cad


def plan_lines(msp):
    """Semua garis arsitektur denah tipikal (mm), INSERT/MLINE diurai."""
    lines = []
    ents = [e for e in msp if not e.dxf.layer.startswith("ITC") and e.dxf.layer not in SKIP_LAYERS]
    for e in disassemble.recursive_decompose(ents):
        if e.dxftype() in SKIP_TYPES or e.dxf.layer in SKIP_LAYERS:
            continue
        try:
            p = dpath.make_path(e)
        except (TypeError, ValueError):
            continue
        for sub in p.sub_paths():
            pts = [(v.x, v.y) for v in sub.flattening(FLATTEN)]
            if len(pts) < 2 or sum(math.dist(pts[i], pts[i + 1]) for i in range(len(pts) - 1)) < MIN_LEN:
                continue
            if all(REGION[0] <= x <= REGION[2] and REGION[1] <= y <= REGION[3] for x, y in pts):
                lines.append(pts)
    return lines


def cellblocks(path):
    msp = ezdxf.readfile(path).modelspace()
    arch = plan_lines(msp)
    cams = [(e.dxf.center.x, e.dxf.center.y) for e in msp.query('CIRCLE[layer=="ITC-CAM-BLOCK"]')]
    names = sorted(((e.dxf.insert.x, e.dxf.insert.y), e.plain_text()) for e in msp.query('MTEXT[layer=="ITC-CAM-BLOCK"]'))
    fovs = [[(x, y) for x, y in e.get_points("xy")] for e in msp.query('LWPOLYLINE[layer=="ITC-CAM-FOV"]')]
    out, segments = [], 0
    for n, block in enumerate(site_blocks(), 1):
        place = placer(block)
        assert abs(block["length"] - (ROOF[2] - ROOF[0]) / 1000) < 1.0, block   # atap sama panjang
        geoms = []
        for pts in arch:
            cad = simplify([place(*q) for q in pts])
            if math.dist(cad[0], cad[-1]) < 0.05 and len(cad) == 2:
                continue
            geoms.append(lonlat(cad))
        segments += len(geoms)
        label = f"Cell block {n} (MP no. 8)"
        out.append(feature("cb-arch", "MultiLineString", geoms, name=label,
                           detail="Typical Cell Block A–E architectural plan (block-type CAD), placed on the Rev.14 roof "
                                  "outline; entrance / sally-port end from the canopy. Handedness indicative.",
                           note="Block letters A–E are not shown on the Master Plan; blocks are numbered "
                                "counter-clockwise around the hub.",
                           devices=rows(BLOCK_ROWS), devices_source=SCHEDULES,
                           source="ITC-CELLBLOCK-OVERLAY.dwg (ITC-VSS-002 Rev.B)"))
        for pts in fovs:
            # kamera pemilik kerucut = kamera terdekat ke titik pertama kerucut
            cam = min(cams, key=lambda c: math.dist(c, pts[0]))
            name = min(names, key=lambda t: math.dist(t[0], cam))[1]
            ring = [place(*q) for q in pts]
            out.append(feature("cb-fov", "Polygon", [lonlat(ring + [ring[0]])], name=f"Field of view {name}",
                               label=label, source="ITC-CELLBLOCK-OVERLAY.dwg (ITC-VSS-002 Rev.B)"))
        for cam in cams:
            name = min(names, key=lambda t: math.dist(t[0], cam))[1]
            out.append(feature("itc-cam", "Point", list(cad_to_lonlat(*place(*cam))), cam="block", grade=3,
                               name=name, label=f"{label}, ID CAM-B<letter>{name[-2:]}", detail=CAMS[name],
                               source="ITC-CELLBLOCK-OVERLAY.dwg (ITC-VSS-002 Rev.B); schedule ITC-VSS-005"))
    print(f"cell blocks: 5 blocks, {segments} plan lines, {len(cams) * 5} cameras")
    return out


# ------------------------------ anotasi lembar ------------------------------
def annotations(path):
    msp = ezdxf.readfile(path).modelspace()
    out = []
    for sheet in SHEETS:
        layer = f"ITC-TXT-{sheet}"
        for e in msp.query(f'MTEXT[layer=="{layer}"]'):
            box = bbox.extents([e])
            c = ((box.extmin.x + box.extmax.x) / 2, (box.extmin.y + box.extmax.y) / 2)
            text = e.plain_text().strip()
            out.append(feature("dwg-note", "Point", list(cad_to_lonlat(*c)), sheet=sheet, text=text,
                               name=text.replace("\n", " "), source=f"ITC-SITE-OVERLAY-REV14.dwg, layer {layer}"))
        leaders = [[(x, y) for x, y in e.get_points("xy")] for e in msp.query(f'LWPOLYLINE[layer=="{layer}"]')]
        if leaders:
            out.append(feature("dwg-leader", "MultiLineString", [lonlat(p) for p in leaders], sheet=sheet,
                               name=f"Label leaders, sheet ITC-{sheet}", source=f"ITC-SITE-OVERLAY-REV14.dwg, layer {layer}"))
    print(f"annotations: {sum(1 for f in out if f['properties']['kind'] == 'dwg-note')} notes on {len(SHEETS)} sheets")
    return out


def main():
    cellblock_dxf, site_dxf = sys.argv[1:3]
    features = cellblocks(cellblock_dxf) + annotations(site_dxf)
    path = ROOT / "private" / "weberek-dwg-overlays.geojson"
    path.write_text(json.dumps({"type": "FeatureCollection", "features": features},
                               ensure_ascii=False, separators=(",", ":")))
    print(f"{path.relative_to(ROOT)}: {len(features)} features, {path.stat().st_size / 1024:.0f} KiB")


if __name__ == "__main__":
    main()
