/* ==========================================================================
   lib/zip.mjs  -  a store-only zip, by hand, with no dependency
   --------------------------------------------------------------------------
   An EPUB is a zip whose FIRST entry is the literal string "mimetype", STORED
   (not compressed). "Store-only" means no deflate, which means this writer is
   about eighty lines and needs no library, and the mimetype rule is satisfied
   for free. The files in a book are CSS, XHTML, SVG and JPEG — already compact
   — so the size cost of not compressing is real but small, and the trade is
   worth owning the format completely.

   Deterministic: a fixed timestamp goes into every entry, so the same book
   zips to the same bytes (which is what lets the test hash it).

   zipStore([{ name, data }]) -> Buffer
   unzipStore(buffer) -> Map(name -> Buffer)   (for tests and readers)
   ========================================================================== */
import { inflateRawSync } from 'node:zlib';

/* ---- crc32 ------------------------------------------------------------- */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

/* A fixed DOS date/time (2020-01-01 00:00:00) so the archive is reproducible. */
const DOS_TIME = 0;
const DOS_DATE = ((2020 - 1980) << 9) | (1 << 5) | 1;

const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16LE(n & 0xFFFF, 0); return b; };
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0, 0); return b; };
const nameBytes = (name) => Buffer.from(name, 'utf8');

/**
 * Build a zip. Every entry is stored (method 0). `mimetype`, when present, is
 * forced to the front so the EPUB spec is satisfied without the caller knowing.
 */
export function zipStore(files) {
  const ordered = [...files].sort((a, b) => (a.name === 'mimetype' ? -1 : b.name === 'mimetype' ? 1 : 0));
  const locals = [];
  const central = [];
  let offset = 0;

  for (const f of ordered) {
    const data = Buffer.isBuffer(f.data) ? f.data : Buffer.from(String(f.data), 'utf8');
    const name = nameBytes(f.name);
    const crc = crc32(data);
    const local = Buffer.concat([
      u32(0x04034b50), u16(20), u16(0), u16(0), u16(DOS_TIME), u16(DOS_DATE),
      u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0),
      name, data,
    ]);
    locals.push(local);
    central.push(Buffer.concat([
      u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(DOS_TIME), u16(DOS_DATE),
      u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), u16(0),
      u16(0), u16(0), u32(0), u32(offset), name,
    ]));
    offset += local.length;
  }

  const centralDir = Buffer.concat(central);
  const eocd = Buffer.concat([
    u32(0x06054b50), u16(0), u16(0), u16(ordered.length), u16(ordered.length),
    u32(centralDir.length), u32(offset), u16(0),
  ]);
  return Buffer.concat([...locals, centralDir, eocd]);
}

/** Read a store- or deflate-compressed zip back into a name -> Buffer map. */
export function unzipStore(buffer) {
  const out = new Map();
  /* Find the End Of Central Directory: scan back for its signature. */
  let eocd = -1;
  for (let i = buffer.length - 22; i >= 0; i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd === -1) throw new Error('not a zip: no end-of-central-directory record');
  const count = buffer.readUInt16LE(eocd + 10);
  let p = buffer.readUInt32LE(eocd + 16);

  for (let i = 0; i < count; i++) {
    if (buffer.readUInt32LE(p) !== 0x02014b50) throw new Error('not a zip: bad central directory');
    const method = buffer.readUInt16LE(p + 10);
    const compSize = buffer.readUInt32LE(p + 20);
    const nameLen = buffer.readUInt16LE(p + 28);
    const extraLen = buffer.readUInt16LE(p + 30);
    const commentLen = buffer.readUInt16LE(p + 32);
    const localOff = buffer.readUInt32LE(p + 42);
    const name = buffer.toString('utf8', p + 46, p + 46 + nameLen);

    const lNameLen = buffer.readUInt16LE(localOff + 26);
    const lExtraLen = buffer.readUInt16LE(localOff + 28);
    const dataStart = localOff + 30 + lNameLen + lExtraLen;
    const raw = buffer.subarray(dataStart, dataStart + compSize);
    out.set(name, method === 0 ? Buffer.from(raw) : inflateRawSync(raw));

    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}
