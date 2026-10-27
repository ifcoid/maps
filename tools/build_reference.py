"""Lapisan rujukan konektivitas -> private/weberek-reference.geojson (lalu encrypt_data.py).

1. ITU Broadband Maps (bbmaps.itu.int, WFS): jalur transmisi terestrial dan node di
   Timor-Leste. Data dilaporkan operator (go-live TL 2014; Palapa Ring 2013; Moratelindo 2022), garis 2-8 titik
   (sketsa kasar). Lisensi: syarat umum ITU (pemakaian non-komersial dengan atribusi);
   dipakai hanya sebagai rujukan, tidak sebagai dasar desain.
2. nPerf (nperf.com): TIDAK mengambil tile atau data cakupan. Syarat penggunaan nPerf
   (versi 16 Jun 2026, Art. 6.1-6.2, 8) melarang reproduksi, ekstraksi dan pemakaian
   profesional tanpa izin tertulis. Yang dimuat hanya catatan pengamatan bertanggal
   (dibaca di peta nPerf, 28 Okt 2026) yang ditempatkan di lokasi kota/dusun menurut
   OpenStreetMap, masing-masing dengan tautan ke peta nPerf.

Pemakaian: python3 tools/build_reference.py
"""
import json
import math
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SITE = (125.8955, -9.0135)      # pusat situs (lon, lat), sama dengan georef_rev14
BBOX = "124.0,-9.6,127.4,-8.1,EPSG:4326"
WFS = "https://bbmaps.itu.int/geoserver/ows"
UA = {"User-Agent": "ifcoid-maps/1.0 (Weberek ITC reference layer)"}
ITU_SOURCE = "ITU Broadband Maps, transmission map (bbmaps.itu.int), operator-reported; retrieved by tools/build_reference.py"
ITU_NOTE = ("Reference only: operator-reported to ITU, routes drawn with few points (rough sketch), node positions "
            "may be placeholders. Confirm with the operator before relying on it. "
            "ITU terms: non-commercial use with attribution.")

NPERF = "https://www.nperf.com/en/map/TL"
NPERF_SOURCE = "nPerf coverage map, read on 28 Oct 2026 (crowd-sourced speed tests; no samples ≠ no signal)"
NPERF_NOTES = [   # (lon, lat dari OSM, nama, catatan, tautan)
    (125.994, -9.028, "Fatukahi (Betano–Umaboco road), ≈11.5 km E",
     "TT Mobile: 4G, weak to moderate, a small patch of samples on the road near the suco office. "
     "Nearest TT Mobile signal to the site.", f"{NPERF}/-/1996012.TT-Mobile/signal"),
    (125.8528, -9.1208, "Wedauberek hamlet (Betano–Umaboco road), ≈12.6 km SSW",
     "Telemor: 4G+, weak (1–2 bars), a few samples. Nearest Telemor signal to the site. "
     "Not the project site: Weberek (Bairo Wesa) is the parcel shown on this map.",
     f"{NPERF}/-/1996013.Telemor/signal"),
    (125.722, -9.165, "Betano, ≈22–25 km SW",
     "Telkomcel: dense 4G with some 2G/3G and no-signal points; nearest Telkomcel signal. "
     "Telemor: no-signal samples.", f"{NPERF}/-/1996009.Telkomcel-Mobile/signal"),
    (125.649, -9.000, "Same (municipal capital), ≈26–28 km W",
     "Telkomcel: 4G / 4G+. TT Mobile: 4G / 3G. Telemor: no-signal samples.", f"{NPERF}/1937031.Same/-/signal"),
]


def fetch(type_name):
    query = urllib.parse.urlencode({"service": "WFS", "version": "1.0.0", "request": "GetFeature",
                                    "typeName": type_name, "outputFormat": "application/json", "bbox": BBOX})
    with urllib.request.urlopen(urllib.request.Request(f"{WFS}?{query}", headers=UA), timeout=60) as r:
        return json.load(r)["features"]


def km(a, b):
    """Jarak (km) dua titik lon/lat, pendekatan bidang datar (cukup untuk < 100 km)."""
    k = 111.32
    return math.hypot((a[0] - b[0]) * k * math.cos(math.radians((a[1] + b[1]) / 2)), (a[1] - b[1]) * k)


def feature(kind, geometry, **props):
    return {"type": "Feature", "properties": {"kind": kind, **{k: v for k, v in props.items() if v not in (None, "")}},
            "geometry": geometry}


def golive(value):
    s = str(value or "")
    return f"{s[:4]}-{s[4:6]}-{s[6:8]}" if len(s) == 8 else None


def circle(c, radius_km, n=72):
    dx = radius_km / (111.32 * math.cos(math.radians(c[1])))
    dy = radius_km / 111.32
    ring = [[round(c[0] + dx * math.cos(2 * math.pi * i / n), 6), round(c[1] + dy * math.sin(2 * math.pi * i / n), 6)]
            for i in range(n)]
    return {"type": "Polygon", "coordinates": [ring + [ring[0]]]}


def main():
    out = []
    for f in fetch("ITU:trx_public_2"):
        p = f["properties"]
        out.append(feature("ref-itu-link", f["geometry"], name=f"{p.get('operator_l')}: {p.get('from_')} – {p.get('to_')}",
                           label=p.get("type_inf"), operator=p.get("operator_l"), status=p.get("status"),
                           length_m=round((p.get("distance") or 0) * 1000) or None,
                           detail=golive(p.get("golive_dat")) and f"Go-live date as reported to ITU: {golive(p.get('golive_dat'))}",
                           note=ITU_NOTE, source=ITU_SOURCE))
    for f in fetch("ITU:itu_nodes_public"):
        p = f["properties"]
        xy = f["geometry"]["coordinates"]
        xy = xy[0] if isinstance(xy[0], list) else xy
        out.append(feature("ref-itu-node", {"type": "Point", "coordinates": xy[:2]}, name=f"ITU node: {p.get('name')}",
                           label=p.get("type_infr"), country=p.get("country"),
                           detail=f"{km(xy, SITE):.1f} km from the site", note=ITU_NOTE, source=ITU_SOURCE))
    out.append(feature("ref-nperf-ring", circle(SITE, 10), name="No mobile measurements within 10 km of the site",
                       detail="nPerf: no samples from Telemor, Telkomcel or TT Mobile within 10 km (incl. Fatuberliu, "
                              "Dotik, Alas). OpenCelliD: no observations near the site (nearest ≈29 km N). "
                              "OpenStreetMap: no telecom tower within 30 km.",
                       note="Supports the zero-signal design basis. nPerf tiles are not reproduced here: the nPerf "
                            "terms (Art. 6, 8) require written permission for reuse.",
                       link=f"{NPERF}/-/-/signal", source=NPERF_SOURCE))
    for lon, lat, name, note, link in NPERF_NOTES:
        out.append(feature("ref-nperf", {"type": "Point", "coordinates": [lon, lat]}, name=f"nPerf: {name}",
                           detail=note, link=link, location="Place location: OpenStreetMap", source=NPERF_SOURCE))
    path = ROOT / "private" / "weberek-reference.geojson"
    path.write_text(json.dumps({"type": "FeatureCollection", "features": out}, ensure_ascii=False, separators=(",", ":")))
    links = [f for f in out if f["properties"]["kind"] == "ref-itu-link"]
    nodes = [f for f in out if f["properties"]["kind"] == "ref-itu-node"]
    nearest = min(nodes, key=lambda f: km(f["geometry"]["coordinates"], SITE))
    print(f"{path.name}: {len(links)} ITU links, {len(nodes)} ITU nodes, {len(NPERF_NOTES)} nPerf notes; "
          f"nearest node {nearest['properties']['name']} {nearest['properties']['detail']}")


if __name__ == "__main__":
    main()
