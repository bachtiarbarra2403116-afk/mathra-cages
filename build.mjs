// =====================================================================
// Mathra-Cages: pembuat versi berlisensi (tanpa server)
//
// Pakai:
//   node build.mjs tambah 20 "Batch 1"     -> buat 20 kode baru + bangun index.html
//   node build.mjs cabut MC-XXXX-XXXX-XXXX -> nonaktifkan satu kode + bangun ulang
//   node build.mjs daftar                  -> lihat semua kode dan statusnya
//   node build.mjs                         -> bangun ulang saja
//
// Sumber kebenaran = file  daftar-kode.csv  (kode asli, catatan, tanggal, status).
// SIMPAN & JANGAN UNGGAH file itu. Yang diunggah hanya  dist/index.html.
// =====================================================================
import { randomBytes, randomInt, pbkdf2Sync, createCipheriv } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const DIR = dirname(fileURLToPath(import.meta.url));
const LEDGER = join(DIR, "daftar-kode.csv");
const ITER = 150000; // makin besar = makin sulit ditebak, makin lama dibuka (+-0,1 detik)
const ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"; // tanpa 0/O/1/I agar tidak membingungkan

// ---------- daftar kode (CSV sederhana) ----------
function bacaDaftar() {
  if (!existsSync(LEDGER)) return [];
  return readFileSync(LEDGER, "utf8").split(/\r?\n/).slice(1).filter(Boolean).map((l) => {
    const [kode, catatan, tanggal, status] = l.split(",");
    return { kode, catatan, tanggal, status };
  });
}
function simpanDaftar(rows) {
  const isi = ["kode,catatan,tanggal,status", ...rows.map((r) => [r.kode, r.catatan, r.tanggal, r.status].join(","))];
  writeFileSync(LEDGER, isi.join("\n") + "\n");
}

const blok = () => Array.from({ length: 4 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
const buatKode = () => `MC-${blok()}-${blok()}-${blok()}`;

// ---------- kripto ----------
const gcm = (key, iv, data) => {
  const c = createCipheriv("aes-256-gcm", key, iv);
  return Buffer.concat([c.update(data), c.final(), c.getAuthTag()]); // format sama dengan WebCrypto di browser
};

function bangun(rows) {
  const aktif = rows.filter((r) => r.status === "aktif");
  if (!aktif.length) {
    console.error('Belum ada kode aktif. Jalankan dulu:  node build.mjs tambah 20 "Batch 1"');
    process.exit(1);
  }
  const deck = readFileSync(join(DIR, "deck.json"));
  const kunciUtama = randomBytes(32);  // dibuat baru setiap build
  const salt = randomBytes(16);
  const ivDeck = randomBytes(12);

  const keys = {};
  for (const r of aktif) {
    const bits = pbkdf2Sync(r.kode, salt, ITER, 48, "sha256"); // 16 byte pertama = ID, 32 sisanya = kunci
    const iv = randomBytes(12);
    keys[bits.subarray(0, 16).toString("hex")] = {
      iv: iv.toString("base64"),
      ct: gcm(bits.subarray(16), iv, kunciUtama).toString("base64"),
    };
  }
  const vault = {
    iter: ITER,
    salt: salt.toString("base64"),
    iv: ivDeck.toString("base64"),
    ct: gcm(kunciUtama, ivDeck, deck).toString("base64"),
    keys,
  };

  const tpl = readFileSync(join(DIR, "template.html"), "utf8");
  if (!tpl.includes("__VAULT_JSON__")) throw new Error("template.html tidak punya penanda __VAULT_JSON__");
  const html = tpl.replace("__VAULT_JSON__", () => JSON.stringify(vault));
  mkdirSync(join(DIR, "dist"), { recursive: true });
  writeFileSync(join(DIR, "dist", "index.html"), html);
  console.log(`Selesai. ${aktif.length} kode aktif -> dist/index.html (${Math.round(html.length / 1024)} KB)`);
}

// ---------- perintah ----------
const [cmd, arg1, arg2] = process.argv.slice(2);
let rows = bacaDaftar();

if (cmd === "tambah") {
  const n = Number(arg1);
  if (!Number.isInteger(n) || n < 1 || n > 2000) { console.error('Pakai: node build.mjs tambah 20 "Batch 1"'); process.exit(1); }
  const catatan = String(arg2 || "").replace(/[,\r\n]/g, ";");
  const tanggal = new Date().toISOString().slice(0, 10);
  const baru = [];
  while (baru.length < n) {
    const kode = buatKode();
    if (!rows.some((r) => r.kode === kode) && !baru.some((r) => r.kode === kode)) baru.push({ kode, catatan, tanggal, status: "aktif" });
  }
  rows = rows.concat(baru);
  simpanDaftar(rows);
  console.log(`Kode baru (${n}):\n` + baru.map((r) => "  " + r.kode).join("\n") + "\n");
  bangun(rows);
} else if (cmd === "cabut") {
  const kode = String(arg1 || "").trim().toUpperCase();
  const r = rows.find((x) => x.kode === kode);
  if (!r) { console.error("Kode tidak ditemukan di daftar-kode.csv"); process.exit(1); }
  r.status = "dicabut";
  simpanDaftar(rows);
  console.log(`${kode} dicabut. Unggah ulang dist/index.html agar berlaku.`);
  bangun(rows);
} else if (cmd === "daftar") {
  if (!rows.length) console.log("Belum ada kode.");
  for (const r of rows) console.log(`${r.kode}  ${r.status.padEnd(8)}  ${r.tanggal}  ${r.catatan}`);
} else if (!cmd) {
  bangun(rows);
} else {
  console.error('Perintah tidak dikenal. Pilihan: tambah | cabut | daftar');
  process.exit(1);
}
