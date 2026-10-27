"""Georeferensi Master Plan Rev.14 (grid lokal CAD, meter) ke WGS84.

Grid CAD = grid survei topografi (BM1-BM3) digeser (E +19650,805; N -1815,017);
tidak ada ikatan geodetik di dokumen, dan semua koordinat geografis Inception
Report diambil dari Google Earth. Maka dipakai transformasi rigid (skala 1,
CAD sudah metrik) hasil kuadrat terkecil dari lima titik kontrol:

  sudut persil P1-P4 (IR Table 3)  <->  sudut "Pagar 03 Area 25H" di CAD
  existing prison building (IR)     <->  outline existing building di CAD

Hasil: rotasi -2,66 derajat; residu P1 145 m, P2 71 m, P3 6 m, P4 67 m, EX 50 m
(bentuk persil P1-P4 Google Earth memang berbeda dari persil CAD). Cek
independen yang mendukung:
  - gerbang utama MG Rev.14 jatuh 9 m dari titik jalan akses OSM masuk situs;
  - koordinat lapangan CPT/GRS semuanya jatuh di dalam persil 25 ha CAD;
    koordinat lembar CPT (S 9 00 47.04, E 125 53 42.04) 20 m dari existing building;
  - pola kontur CAD berkorelasi 0,83 dengan DEM Copernicus 30 m; selisih
    tinggi +-39 m cocok dengan undulasi geoid (+41,5 m, EGM2008), jadi Z CAD
    adalah tinggi elipsoid GNSS.
Hipotesis "koordinat BM = UTM 51S terpotong" ditolak: titik CPT/GRS lapangan
jatuh di luar persil.

Akurasi posisi: +-50 m. Bisa dibuat presisi dengan satu sesi GNSS pada BM1-BM3.
"""
import math

DMS = lambda d, m, s: d + m / 60 + s / 3600

# Titik kontrol: (lon, lat) WGS84  <->  (x, y) CAD
CONTROL = {
    "P1": ((DMS(125, 53, 44.96), -DMS(9, 0, 58.32)), (28228.46, -280.53)),
    "P2": ((DMS(125, 53, 35.19), -DMS(9, 0, 48.84)), (27858.31, 189.75)),
    "P3": ((DMS(125, 53, 45.21), -DMS(9, 0, 39.04)), (28205.48, 462.24)),
    "P4": ((DMS(125, 53, 55.20), -DMS(9, 0, 46.13)), (28518.28, 320.25)),
    "EX": ((DMS(125, 53, 41.16), -DMS(9, 0, 47.49)), (28134.6, 216.3)),
}

# Bidang singgung lokal di tengah situs (jari-jari elipsoid WGS84).
LON0, LAT0 = 125.8955, -9.0135
_A, _E2 = 6378137.0, 0.00669437999014
_PHI = math.radians(LAT0)
_M = _A * (1 - _E2) / (1 - _E2 * math.sin(_PHI) ** 2) ** 1.5
_N = _A / math.sqrt(1 - _E2 * math.sin(_PHI) ** 2)
KX = _N * math.cos(_PHI) * math.pi / 180   # meter per derajat bujur
KY = _M * math.pi / 180                    # meter per derajat lintang


def _enu(lon, lat):
    return (lon - LON0) * KX, (lat - LAT0) * KY


def _fit():
    src = [c for _, c in CONTROL.values()]
    dst = [_enu(*g) for g, _ in CONTROL.values()]
    n = len(src)
    sx, sy = sum(p[0] for p in src) / n, sum(p[1] for p in src) / n
    dx, dy = sum(p[0] for p in dst) / n, sum(p[1] for p in dst) / n
    # rotasi optimal 2D (Procrustes tanpa skala)
    num = sum((a[0] - sx) * (b[1] - dy) - (a[1] - sy) * (b[0] - dx) for a, b in zip(src, dst))
    den = sum((a[0] - sx) * (b[0] - dx) + (a[1] - sy) * (b[1] - dy) for a, b in zip(src, dst))
    th = math.atan2(num, den)
    c, s = math.cos(th), math.sin(th)
    return th, c, s, dx - (c * sx - s * sy), dy - (s * sx + c * sy)


THETA, _C, _S, _TX, _TY = _fit()


def cad_to_lonlat(x, y):
    """Titik CAD (m) -> (lon, lat) WGS84, dibulatkan 7 desimal (+-1 cm)."""
    e = _C * x - _S * y + _TX
    n = _S * x + _C * y + _TY
    return round(LON0 + e / KX, 7), round(LAT0 + n / KY, 7)


def lonlat_to_cad(lon, lat):
    """Kebalikan cad_to_lonlat: (lon, lat) WGS84 -> titik grid CAD (m)."""
    e, n = (lon - LON0) * KX - _TX, (lat - LAT0) * KY - _TY
    return _C * e + _S * n, -_S * e + _C * n


def residuals():
    out = {}
    for key, (geo, cad) in CONTROL.items():
        lon, lat = cad_to_lonlat(*cad)
        ex, ny = _enu(lon, lat)
        gx, gy = _enu(*geo)
        out[key] = round(math.hypot(ex - gx, ny - gy), 1)
    return out


if __name__ == "__main__":
    print(f"rotation {math.degrees(THETA):.2f} deg; residuals (m) {residuals()}")
