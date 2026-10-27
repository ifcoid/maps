// Membuka data/secure/weberek.bin (dibuat tools/encrypt_data.py): AES-256-GCM dengan
// kunci PBKDF2-SHA256 dari password. Isi = gzip JSON {nama berkas: FeatureCollection}.
const MAGIC = new TextEncoder().encode("WBK1");
const ITERATIONS = 600000;   // sama dengan tools/encrypt_data.py

export async function unlock(url, password) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!MAGIC.every((b, i) => bytes[i] === b)) throw new Error("Unknown data format");
    const salt = bytes.slice(4, 20);
    const iv = bytes.slice(20, 32);
    const material = await crypto.subtle.importKey(
        "raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
    const key = await crypto.subtle.deriveKey(
        { name: "PBKDF2", hash: "SHA-256", salt, iterations: ITERATIONS },
        material, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
    let plain;
    try {
        plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv, additionalData: MAGIC }, key, bytes.slice(32));
    } catch {
        throw new Error("Wrong password");
    }
    const stream = new Blob([plain]).stream().pipeThrough(new DecompressionStream("gzip"));
    return JSON.parse(await new Response(stream).text());
}
