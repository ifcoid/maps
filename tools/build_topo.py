#!/usr/bin/env python3
"""Kontur survei topografi dari Master Plan Rev.14 (DXF) -> private/weberek-topo.geojson.

Layer "1 KONTUR" di DWG proyek induk: kontur interval 1 m (El. +159 s.d. +176) di
atas grid survei BM1-BM3, kontur indeks tiap 5 m. Polyline berelevasi 0 di layer
yang sama adalah garis potongan memanjang (STA 0+000 s.d. 0+501,20), bukan kontur,
jadi dilewati. Level proyek +-0,000 = El. +160,00.

Elevasi survei = tinggi elipsoid GNSS (README, georeferensi: selisih dengan DEM
Copernicus +-39 m, undulasi geoid EGM2008 +41,5 m). Tinggi di atas muka laut
(seperti kontur OpenTopoMap) kira-kira El. - 41,5 m.

DXF dibuat seperti tools/build_masterplan.py:
  NetDet/03-survei/tools/dwg-convert.sh -f dxf -o /tmp/mp14 \
      "NetDet/02-referensi/proyek-induk-weberek/sumber/MASTER PLAN Rev.14.dwg"
Pakai (butuh ezdxf), lalu python3 tools/encrypt_data.py:
  python3 tools/build_topo.py "/tmp/mp14/MASTER PLAN Rev.14.dxf"
"""
import json
import math
import pathlib
import sys

import ezdxf

from build_masterplan import line, simplify

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "private" / "weberek-topo.geojson"   # sumber DWG klien: ikut dienkripsi
LAYER = "1 KONTUR"
DATUM = 160.0         # El. dari level proyek +-0,000
GEOID = 41.5          # m; undulasi geoid EGM2008 di situs (elipsoid -> muka laut)
INDEX = 5             # kontur indeks tiap 5 m
TOLERANCE = 0.3       # m; penyederhanaan Douglas-Peucker (interval kontur 1 m)
MIN_LABEL_LENGTH = 40  # m; kontur tertutup kecil (gundukan, cekungan) tidak diberi label
SOURCE = ("Master Plan Rev.14 (DWG), layer 1 KONTUR: topographic survey on the BM1–BM3 grid; "
          "horizontal position georeferenced ±50 m")


def main(dxf_path):
    msp = ezdxf.readfile(dxf_path).modelspace()
    features = []
    for entity in msp.query(f'LWPOLYLINE[layer=="{LAYER}"]'):
        z = round(entity.dxf.elevation, 2)
        if not z:
            continue
        points = [tuple(p) for p in entity.get_points("xy")]
        if entity.closed:
            points.append(points[0])
        length = sum(math.dist(a, b) for a, b in zip(points, points[1:]))
        relative = z - DATUM
        features.append(line(
            "topo-contour", simplify(points, TOLERANCE),
            name=f"Contour El. +{z:.2f} m", elevation=z, index=z % INDEX == 0,
            tag=f"+{z:.0f}" if length >= MIN_LABEL_LENGTH else None,
            detail=f"{relative:+.2f} m relative to project level ±0.000 (El. +{DATUM:.2f})",
            note=f"1 m interval, index contour every 5 m. Survey elevations are GNSS ellipsoid heights: "
                 f"above mean sea level this contour is ≈ +{z - GEOID:.0f} m (EGM2008 geoid +{GEOID} m), "
                 f"the datum of the Topo basemap contours.", source=SOURCE))
    features.sort(key=lambda f: f["properties"]["elevation"])
    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(json.dumps({"type": "FeatureCollection", "features": features},
                              ensure_ascii=False, separators=(",", ":")))
    levels = sorted({f["properties"]["elevation"] for f in features})
    vertices = sum(len(f["geometry"]["coordinates"]) for f in features)
    print(f"{OUT.name}: {len(features)} contours, El. +{levels[0]:.0f} to +{levels[-1]:.0f}, {vertices} vertices")


if __name__ == "__main__":
    main(sys.argv[1])
