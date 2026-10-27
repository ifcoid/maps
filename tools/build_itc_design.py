"""Lapisan desain ITC (Interim Rev.1) -> data/weberek-itc-design.geojson.

Geometri diambil langsung dari NetDet/05-desain/gambar-cad/cad/build_overlay_dwg.py
(sumber lembar ITC-GEN-002/003, NET-002, VSS-001, PID-001, COM-002 Rev.B), supaya
peta selalu sama dengan gambar CAD. Skrip itu membaca DXF di tingkat modul, jadi
yang dijalankan hanya blok geometrinya (semua pernyataan sebelum `doc = ...`) plus
beberapa konstanta yang didefinisikan di bagian lembar (WANTED_LATE).

Pemakaian: python3 tools/build_itc_design.py [path/build_overlay_dwg.py]
"""
import ast
import json
import math
import sys
from pathlib import Path

from georef_rev14 import cad_to_lonlat

ROOT = Path(__file__).resolve().parents[1]
OVERLAY = ROOT.parent / "05-desain/gambar-cad/cad/build_overlay_dwg.py"
WANTED_LATE = {"G2_BOXES", "G1_WORKSHOP", "ISOL", "MW_POS", "DAS", "DAS_CLEAR"}
SHEETS = "ITC drawing set Rev.B (Interim Rev.1)"


def load_geometry(path):
    """Jalankan blok geometri build_overlay_dwg.py tanpa membuka DXF."""
    tree = ast.parse(Path(path).read_text())
    keep, early = [], True
    for node in tree.body:
        if isinstance(node, ast.ImportFrom) or (
                isinstance(node, ast.Import) and any(a.name == "ezdxf" for a in node.names)):
            continue
        targets = [t.id for t in getattr(node, "targets", []) if isinstance(t, ast.Name)]
        if early and isinstance(node, ast.Assign) and targets == ["doc"]:
            early = False
        if early:
            # baris argumen CLI (SRC, KOPSRC, ...) tidak dipakai
            if isinstance(node, ast.Assign) and "sys.argv" in ast.unparse(node.value):
                continue
            keep.append(node)
        elif isinstance(node, ast.Assign) and set(targets) & WANTED_LATE:
            keep.append(node)
    ns = {}
    exec(compile(ast.Module(body=keep, type_ignores=[]), str(path), "exec"), ns)
    return ns


def ll(points):
    return [list(cad_to_lonlat(*p)) for p in points]


def feature(kind, geometry_type, coordinates, **properties):
    props = {"kind": kind}
    props.update({k: v for k, v in properties.items() if v is not None})
    return {"type": "Feature", "properties": props,
            "geometry": {"type": geometry_type, "coordinates": coordinates}}


def point(kind, xy, **properties):
    return feature(kind, "Point", list(cad_to_lonlat(*xy)), **properties)


def line(kind, points, **properties):
    return feature(kind, "LineString", ll(points), length_m=round(length(points)), **properties)


def polygon(kind, points, **properties):
    ring = list(points) + [points[0]]
    return feature(kind, "Polygon", [ll(ring)], **properties)


def length(points):
    return sum(math.dist(a, b) for a, b in zip(points, points[1:]))


def circle(c, r, n=36):
    return [(c[0] + r * math.cos(2 * math.pi * k / n), c[1] + r * math.sin(2 * math.pi * k / n)) for k in range(n)]


def box(c0, c1):
    return [c0, (c1[0], c0[1]), c1, (c0[0], c1[1])]


def build(g):
    CR, PH, BTS, WALL, F2, F3, HSE = g["CR"], g["PH"], g["BTS"], g["WALL"], g["F2"], g["F3"], g["HSE"]
    TOWERS, GATES = g["TOWERS"], g["GATES"]
    out = []

    # --- zona keamanan (Security Design Matrix, ITC-GEN-003) ---
    out.append(polygon("itc-grade", WALL, grade=3, name="Grade 3: support inside the wall",
                       detail="Clinic, chapel, vocational, warehouse, indoor field, existing prison building (MP no. 31): "
                              "VSS, controlled-door access, tool control.",
                       source="ITC-GEN-003; Security Design Matrix, Interim Report Table 2.1 (proposed)"))
    out.append(polygon("itc-grade", F2, grade="3c", name="Grade 3 core: PAGAR-02 inmate zone",
                       detail="Blocks A–E, hub/auditorium, kitchen, library–visitor: VSS with line-crossing analytics on "
                              "PAGAR-02, block access control, intercom, duress.",
                       source="ITC-GEN-003; Security Design Matrix (proposed)"))
    g2 = {"HO": "Head office (MP no. 4)", "PH": "Power house / genset", "PP": "Police post, outside the wall (MP no. 2)",
          "BTS": "BTS yard"}
    for key, (c0, c1) in g["G2_BOXES"].items():
        out.append(polygon("itc-grade", box(c0, c1), grade=2, name=f"Grade 2: {g2[key]}",
                           detail="Card access, VSS at entries, network access per role.",
                           source="ITC-GEN-003; Security Design Matrix (proposed)"))
    out.append(polygon("itc-grade", HSE, grade=1, name="Grade 1: staff housing (PAGAR-04 wall, 48 units)",
                       detail="Estate access-point cameras only; no inmate systems. GSN zone Z7.",
                       source="ITC-GEN-003; Security Design Matrix (proposed)"))
    out.append(polygon("itc-grade", g["G1_WORKSHOP"], grade=1,
                       name="Grade 1: agriculture workshop (MP no. 21) + hydrant (MP no. 22)",
                       detail="Estate access-point cameras only.",
                       source="ITC-GEN-003; Security Design Matrix (proposed)"))
    out.append(line("itc-grade4-line", WALL + [WALL[0]], grade=4, name="Grade 4: PAGAR-01 prison wall",
                    detail="Wall-top perimeter detection (12 zones), inner-face IR cameras, tower PTZ + thermal.",
                    source="ITC-GEN-003; Security Design Matrix (proposed)"))
    g4pts = {**{k: (v, f"Gate {k}") for k, v in GATES.items()},
             "ER/CR": (CR, "Equipment room / control room"), "ISOL": (g["ISOL"], "Isolation cells (MP no. 9)"),
             **{k: (v, f"Guard tower {k}") for k, v in TOWERS.items()}}
    for key, (xy, label) in g4pts.items():
        out.append(polygon("itc-grade4-point", circle(xy, 21 if key == "ER/CR" else 12.5), grade=4,
                           name=f"Grade-4 point: {label}",
                           detail="Interlocks, biometrics, intercom and duress per the Security Design Matrix.",
                           source="ITC-GEN-003 (proposed)"))

    # --- DAS / seluler (ITC-COM-002) ---
    out.append(polygon("itc-nodas", F2, name="No DAS: inmate zone inside PAGAR-02 (incl. library–visitor)",
                       detail="Passive denial: no DAS, residual signal ≤ −110 dBm at PAGAR-02 by design, no jamming. "
                              "Contraband-phone detection = option O2.",
                       source="ITC-COM-002 Rev.B"))
    ru = {"HO": "DAS RU-1, RU-2: head office (MP no. 4)", "MG": "DAS RU-3 police post (MP no. 2), RU-5 MG + screening",
          "NG": "DAS RU-6: north gate NG", "SG": "DAS RU-4: south staff gate SG",
          "HSE": "DAS RU-7, RU-8: staff housing (outdoor)"}
    for key, poly in g["DAS"].items():
        out.append(polygon("itc-das", poly, name=ru[key],
                           detail=f"Indoor/outdoor cellular coverage from the shared BTS via the BDA head-end in the ER. "
                                  f"Clearance to PAGAR-02 ≥ 5 m (computed {g['DAS_CLEAR'][key]:.0f} m).",
                           source="ITC-COM-002 Rev.B; remote schedule ITC-COM-004"))
    out.append(polygon("itc-bts-fall", circle(BTS, 30), name="BTS fall zone, radius 30 m",
                       detail="Approx. 30 m monopole; the fall zone stays clear of the prison wall. "
                              "Shared micro-BTS for Timor Telecom, Telkomcel and Telemor, outside the PAGAR-03 site fence.",
                       source="ITC-COM-002 Rev.B"))
    out.append(polygon("itc-bts-yard", g["BTS_YARD"], name="BTS yard (indicative outline)",
                       detail="Own compound across the road from the main gate; land for the compound requested from MoJ/JV.",
                       source="ITC-VSS-001 / COM-002 Rev.B"))

    # --- jaringan (ITC-GEN-002 / NET-002) ---
    ring = [CR] + WALL + [CR]
    out.append(line("itc-ring", ring, name="Perimeter fiber ring",
                    detail="One 24-core G.652D armored cable (8 SSN / 8 GSN / 8 spare), ERPS protection; 9 nodes: "
                           "ER/CR, MG, T3, SG, T4, T5, NG, T1, T2. Duct along the inner face of the PAGAR-01 wall, "
                           "trench shared with the wall works; two separate entries to the ER/CR.",
                    source="ITC-GEN-002 / ITC-NET-002 Rev.B"))
    spur = {"BLK": ("TR-BLK", "hub (MP no. 7), blocks A–E, isolation"), "KIT": ("TR-KTV", "kitchen/cafeterias + library–visitor"),
            "VOC": ("TR-VOC", "vocational center + warehouse"), "PHC": ("CAB-PH", "power house/genset + chapel"),
            "CLI": ("TR-KLN", "clinic"), "FLD": ("TR-FLD", "indoor field (MP no. 17)"),
            "EXB": ("TR-EXB", "existing prison building (MP no. 31)")}
    spur_note = "12-core spur (4 SSN / 4 GSN / 4 spare), star from the ER/CR; drawn schematic, duct follows the roads (D-4)."
    for key, xy in g["SPURS"].items():
        code, label = spur[key]
        out.append(line("itc-spur", [CR, xy], name=f"Spur {code}", label=label, detail=spur_note,
                        source="ITC-NET-002 Rev.B"))
    out.append(line("itc-spur", [CR, GATES["SG"], g["HSEC"]], name="Spur TR-HSE", label="staff housing estate (via SG)",
                    detail=spur_note, source="ITC-NET-002 Rev.B"))
    out.append(line("itc-spur", [CR, GATES["MG"], BTS], name="Spur CAB-BTS", label="BTS yard (via MG)",
                    detail=spur_note, source="ITC-NET-002 Rev.B"))
    out.append(line("itc-bda", [BTS, (28420, 84.3), GATES["MG"], CR], name="BDA feed fiber",
                    detail="BTS to the BDA head-end in the ER/CR, in the backhaul duct.", source="ITC-GEN-002 / COM-002 Rev.B"))
    sleeve = ["Sleeve: western notch of the wall (ring route)", "Sleeve: near the north gate NG (ring route)",
              "Sleeve: existing-building spur (TR-EXB)"]
    for name, xy in zip(sleeve, g["SLEEVES"]):
        out.append(point("itc-sleeve", xy, name=name,
                         detail="Sleeve through the 2 m retaining wall (western +2.0 m platform), cast with the wall, "
                                "handholes on both sides.", source="ITC-NET-002 Rev.B"))

    # --- deteksi perimeter (ITC-PID-001) ---
    cuts, walls = g["CUTS"], g["WALL"]
    for i in range(12):
        seg = g["sub"](walls, cuts[i], cuts[i + 1])
        out.append(line("itc-pids", seg, name=f"Detection zone Z{i + 1:02d}", zone_index=i + 1,
                        detail="Fiber-optic sensing cable on the anti-climb wall topping. Alarm → tower PTZ auto-slews "
                               "to the zone → operator verifies.",
                        source="ITC-PID-001 Rev.B; mounting detail ITC-PID-002"))
    for key, xy in g["MW_POS"].items():
        out.append(point("itc-mw", xy, name=f"Microwave barrier {key}",
                         detail="Microwave barrier pair across the vehicle gate opening.", source="ITC-PID-001 Rev.B"))

    # --- kamera (ITC-VSS-001) ---
    def cam(kind, xy, code, label, grade, detail):
        out.append(point("itc-cam", xy, cam=kind, name=code, label=label, grade=grade, detail=detail,
                         source="ITC-VSS-001 Rev.B; schedule ITC-VSS-005 (positions provisional, D-4)"))
    for i, xy in enumerate(g["WALL_CAMS"], 1):
        cam("wall", xy, f"CAM-PW{i:02d}", "Fixed IR bullet, PAGAR-01 wall", 4,
            "One camera per approx. 66 m on the inner face of the prison wall (18 in total).")
    for i, xy in enumerate(g["F2_CAMS"], 1):
        cam("f2", xy, f"CAM-PF{i:02d}", "Fixed IR + line-crossing analytics, PAGAR-02", 3,
            "Alarm when a person crosses the virtual line on the inmate-zone fence (8 in total).")
    for i, (key, xy) in enumerate(TOWERS.items(), 1):
        dp, dt, _ = g["VSS_TWR"][key]
        cam("ptz", (xy[0] + dp[0], xy[1] + dp[1]), f"CAM-TP{i:02d}", f"PTZ on tower {key}", 4,
            "Overwatch of the PAGAR-03 site; auto-slews to a wall detection alarm. Symbol offset from the tower for legibility.")
        cam("thermal", (xy[0] + dt[0], xy[1] + dt[1]), f"CAM-TT{i:02d}", f"Thermal on tower {key}", 4,
            "Night, haze and vegetation detection. Symbol offset from the tower for legibility.")
    for key, cams in (("MG", g["MG_CAMS"]), ("NG", g["NG_CAMS"]), ("SG", g["SG_CAMS"])):
        for i, xy in enumerate(cams, 1):
            cam("gate", xy, f"{key} camera {i}", f"Gate camera, {key}", 4,
                "Sally port, entry/exit recording and screening; detail on ITC-VSS-003.")
    cam("anpr", g["ANPR"], "CAM-AN01", "ANPR, main-gate approach", 4, "Automatic number plate recognition.")
    # SITE_CAMS: 9 kamera situs (CAM-ST01..09) lalu 4 akses perumahan (CAM-HS01..04), urutan legenda VSS-001
    for i, xy in enumerate(g["SITE_CAMS"]):
        if i < 9:
            cam("site", xy, f"CAM-ST{i + 1:02d}", "Site camera (grade 2/1 areas)", 2,
                "Entries of the head office, police post, power house, BTS yard and parking.")
        else:
            cam("site", xy, f"CAM-HS{i - 8:02d}", "Staff housing access camera", 1, "Estate access point (grade 1).")

    # --- radio (Bab 6) ---
    out.append(point("itc-radio", TOWERS["T5"], name="DMR repeater 1 (primary), tower T5",
                     detail="DMR Tier II, UHF 400 MHz (ANC assignment pending), AES-256, ≥24 h battery. T5 stands on the "
                            "western +2.0 m platform, the highest tower base on site.",
                     source="Interim Report Ch. 6; ITC-COM-001 Rev.B"))
    out.append(point("itc-radio", CR, name="DMR repeater 2 (hot-standby), control room",
                     detail="Hot-standby / IP site connect with repeater 1; dispatch console in the control room. "
                            "DMO fallback if both repeaters are lost.",
                     source="Interim Report Ch. 6; ITC-COM-001 Rev.B"))
    out.append(point("itc-das-he", CR, name="DAS head-end (HE) in the equipment room",
                     detail="BDA head-end fed from the BTS by fiber in the backhaul duct.", source="ITC-COM-002 Rev.B"))
    return out, {"cams": sum(1 for f in out if f["properties"]["kind"] == "itc-cam"),
                 "ring_m": round(length(ring)), "zones": [round(z) for z in g["ZLEN"]]}


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else OVERLAY
    g = load_geometry(src)
    features, summary = build(g)
    assert summary["cams"] == 66, summary          # = jumlah di lembar VSS-001
    path = ROOT / "data" / "weberek-itc-design.geojson"
    path.write_text(json.dumps({"type": "FeatureCollection", "name": "weberek-itc-design",
                                "source": SHEETS, "features": features}, ensure_ascii=False, separators=(",", ":")))
    print(f"{path.name}: {len(features)} features; {summary}")


if __name__ == "__main__":
    main()
