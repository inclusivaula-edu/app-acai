const zlib = require('zlib');
const fs   = require('fs');
const path = require('path');

// CRC32 table
const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[i] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf  = Buffer.alloc(4); lenBuf.writeUInt32BE(data.length);
  const crcBuf  = Buffer.alloc(4); crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function makePNG(size) {
  // IHDR
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB

  // Pixel rows: filter(0) + RGB per pixel
  // Gradient purple: top-left #667eea → bottom-right #764ba2
  const rows = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 3);
    row[0] = 0; // filter = None
    for (let x = 0; x < size; x++) {
      const t = (x + y) / (size * 2 - 2);
      row[1 + x * 3]     = Math.round(0x66 + t * (0x76 - 0x66)); // R
      row[1 + x * 3 + 1] = Math.round(0x7e + t * (0x4b - 0x7e)); // G
      row[1 + x * 3 + 2] = Math.round(0xea + t * (0xa2 - 0xea)); // B
    }
    rows.push(row);
  }
  const idat = zlib.deflateSync(Buffer.concat(rows), { level: 9 });

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), // PNG sig
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const outDir = path.join(__dirname, 'frontend', 'public');
for (const size of [192, 512]) {
  const buf = makePNG(size);
  fs.writeFileSync(path.join(outDir, `icon-${size}.png`), buf);
  console.log(`icon-${size}.png — ${buf.length} bytes`);
}
