/** Minimal ZIP read/write for Office documents (a .docx is a ZIP of XML).
 * Uses the platform's DecompressionStream / CompressionStream, which browsers
 * and Node both have, so the extension and its tests run the same code. */

export interface ZipEntry {
  readonly name: string;
  readonly data: Uint8Array;
}

const STORED = 0;
const DEFLATED = 8;

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data.slice()]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function deflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data.slice()]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Read every file in a ZIP archive, via its central directory. */
export async function readZip(bytes: Uint8Array): Promise<ZipEntry[]> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error("not a ZIP file");
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const names = new TextDecoder();
  const entries: ZipEntry[] = [];
  for (let n = 0; n < count; n++) {
    if (view.getUint32(at, true) !== 0x02014b50) throw new Error("damaged ZIP directory");
    const flags = view.getUint16(at + 8, true);
    const method = view.getUint16(at + 10, true);
    const size = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true);
    const extra = view.getUint16(at + 30, true);
    const comment = view.getUint16(at + 32, true);
    const local = view.getUint32(at + 42, true);
    const name = names.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    if (flags & 1) throw new Error("encrypted ZIP");
    const dataStart = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const raw = bytes.subarray(dataStart, dataStart + size);
    if (method !== STORED && method !== DEFLATED) throw new Error(`ZIP method ${method}`);
    entries.push({ name, data: method === STORED ? raw.slice() : await inflate(raw) });
    at += 46 + nameLength + extra + comment;
  }
  return entries;
}

/** Write a ZIP archive, deflating every file. */
export async function writeZip(entries: readonly ZipEntry[]): Promise<Uint8Array<ArrayBuffer>> {
  const encoder = new TextEncoder();
  const locals: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const packed = await deflate(entry.data);
    const crc = crc32(entry.data);
    const header = new Uint8Array(30 + name.length);
    const h = new DataView(header.buffer);
    h.setUint32(0, 0x04034b50, true);
    h.setUint16(4, 20, true);
    h.setUint16(6, 0x0800, true); // names are UTF-8
    h.setUint16(8, DEFLATED, true);
    h.setUint16(12, 0x21, true); // 1980-01-01, so the same input gives the same file
    h.setUint32(14, crc, true);
    h.setUint32(18, packed.length, true);
    h.setUint32(22, entry.data.length, true);
    h.setUint16(26, name.length, true);
    header.set(name, 30);

    const dir = new Uint8Array(46 + name.length);
    const d = new DataView(dir.buffer);
    d.setUint32(0, 0x02014b50, true);
    d.setUint16(4, 20, true);
    d.setUint16(6, 20, true);
    d.setUint16(8, 0x0800, true);
    d.setUint16(10, DEFLATED, true);
    d.setUint16(14, 0x21, true);
    d.setUint32(16, crc, true);
    d.setUint32(20, packed.length, true);
    d.setUint32(24, entry.data.length, true);
    d.setUint16(28, name.length, true);
    d.setUint32(42, offset, true);
    dir.set(name, 46);

    locals.push(header, packed);
    central.push(dir);
    offset += header.length + packed.length;
  }
  const dirSize = central.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22);
  const e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true);
  e.setUint16(8, entries.length, true);
  e.setUint16(10, entries.length, true);
  e.setUint32(12, dirSize, true);
  e.setUint32(16, offset, true);
  const parts = [...locals, ...central, end];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

const TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of data) c = TABLE[(c ^ b) & 255]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
