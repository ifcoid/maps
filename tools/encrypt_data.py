"""Enkripsi data sensitif (private/*.geojson) -> data/secure/weberek.bin.

Repo ini publik, sedangkan layout lapas dan desain keamanan (kamera, zona deteksi,
grade, zona tanpa sinyal) tidak boleh terbaca umum. Semua GeoJSON di private/
digabung jadi satu JSON {nama: FeatureCollection}, dikompres gzip, lalu dienkripsi
AES-256-GCM. Kunci = PBKDF2-HMAC-SHA256(password, salt, ITERATIONS). Browser
membukanya dengan WebCrypto (weberek/secure.js).

Format berkas: "WBK1" | salt (16) | iv (12) | ciphertext+tag.
Password: variabel MAPS_DATA_PASSWORD di /home/adb/awangga/.env (atau lingkungan).
Bila belum ada, dibuat acak dan ditambahkan ke .env; password tidak pernah dicetak.

Pemakaian: python3 tools/encrypt_data.py
"""
import gzip
import json
import os
import secrets
from pathlib import Path

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

ROOT = Path(__file__).resolve().parents[1]
ENV = Path("/home/adb/awangga/.env")
MAGIC = b"WBK1"
ITERATIONS = 600_000   # sama dengan weberek/secure.js
KEY = "MAPS_DATA_PASSWORD"


def password():
    if os.environ.get(KEY):
        return os.environ[KEY]
    for line in ENV.read_text().splitlines():
        if line.startswith(KEY + "="):
            return line.split("=", 1)[1].strip().strip('"').strip("'")
    # 4 kelompok x 5 karakter, tanpa huruf yang mudah tertukar (0/O, 1/l/I)
    alphabet = "abcdefghjkmnpqrstuvwxyz23456789"
    value = "-".join("".join(secrets.choice(alphabet) for _ in range(5)) for _ in range(4))
    with ENV.open("a") as f:
        f.write(f"\n# Password peta ifcoid/maps (data terenkripsi, tools/encrypt_data.py)\n{KEY}={value}\n")
    print(f"{KEY} baru dibuat dan disimpan di {ENV}")
    return value


def main():
    bundle = {p.stem: json.loads(p.read_text()) for p in sorted((ROOT / "private").glob("*.geojson"))}
    plain = gzip.compress(json.dumps(bundle, ensure_ascii=False, separators=(",", ":")).encode(), mtime=0)
    salt, iv = secrets.token_bytes(16), secrets.token_bytes(12)
    kdf = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=ITERATIONS)
    key = kdf.derive(password().encode())
    out = ROOT / "data" / "secure" / "weberek.bin"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(MAGIC + salt + iv + AESGCM(key).encrypt(iv, plain, MAGIC))
    print(f"{out.relative_to(ROOT)}: {', '.join(bundle)}; {len(plain) / 1024:.0f} KiB gzip -> "
          f"{out.stat().st_size / 1024:.0f} KiB")


if __name__ == "__main__":
    main()
