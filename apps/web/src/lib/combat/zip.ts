import { crc32 } from "node:zlib";

// Stored entries keep this small, fixed audio download independent of system zip programs.
export function recordingsZip(files: { name: string; data: Buffer }[]): Buffer {
  if (files.length > 100 || files.reduce((sum, file) => sum + file.data.length, 0) > 32 * 1024 * 1024) {
    throw new Error("Recording download is too large");
  }
  const chunks: Buffer[] = [];
  const directory: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name, "utf8");
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x800, 6);
    header.writeUInt16LE(0x21, 12);
    header.writeUInt32LE(crc32(file.data), 14);
    header.writeUInt32LE(file.data.length, 18);
    header.writeUInt32LE(file.data.length, 22);
    header.writeUInt16LE(name.length, 26);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    header.copy(entry, 6, 4, 28);
    entry.writeUInt32LE(offset, 42);
    directory.push(entry, name);
    chunks.push(header, name, file.data);
    offset += header.length + name.length + file.data.length;
  }
  const central = Buffer.concat(directory);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, central, end]);
}
