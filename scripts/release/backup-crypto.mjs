import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { appendFile, open, readFile, unlink, writeFile } from "node:fs/promises";
import { pipeline } from "node:stream/promises";

const magic = Buffer.from("ASSESSLY-BKP-v1!");
const [command, ...args] = process.argv.slice(2);

async function readKey(path) {
  const key = await readFile(path);
  if (key.length !== 32) throw new Error("Backup key must contain exactly 32 bytes");
  return key;
}

if (command === "generate-key" && args.length === 1) {
  await writeFile(args[0], randomBytes(32), { flag: "wx", mode: 0o600 });
  process.stdout.write("Recovery key created. Store a separate off-site copy.\n");
} else if (command === "encrypt" && args.length === 3) {
  const [source, target, keyPath] = args;
  const key = await readKey(keyPath);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  await writeFile(target, Buffer.concat([magic, iv]), { flag: "wx", mode: 0o600 });
  try {
    await pipeline(createReadStream(source), cipher, createWriteStream(target, { flags: "a" }));
    await appendFile(target, cipher.getAuthTag());
  } catch (error) {
    await unlink(target);
    throw error;
  }
  process.stdout.write("Encrypted backup created.\n");
} else if (command === "decrypt" && args.length === 3) {
  const [source, target, keyPath] = args;
  const key = await readKey(keyPath);
  const input = await open(source, "r");
  let size;
  let header;
  let tag;
  try {
    size = (await input.stat()).size;
    if (size < magic.length + 12 + 16) throw new Error("Backup file is incomplete");
    header = Buffer.alloc(magic.length + 12);
    tag = Buffer.alloc(16);
    await input.read(header, 0, header.length, 0);
    await input.read(tag, 0, tag.length, size - tag.length);
  } finally {
    await input.close();
  }
  if (!header.subarray(0, magic.length).equals(magic)) throw new Error("Unknown backup format");
  const decipher = createDecipheriv("aes-256-gcm", key, header.subarray(magic.length));
  decipher.setAuthTag(tag);
  try {
    await pipeline(
      createReadStream(source, { start: header.length, end: size - tag.length - 1 }),
      decipher,
      createWriteStream(target, { flags: "wx", mode: 0o600 }),
    );
  } catch (error) {
    await unlink(target).catch(() => {});
    throw error;
  }
  process.stdout.write("Encrypted backup authenticated and decrypted.\n");
} else {
  throw new Error("Usage: backup-crypto.mjs generate-key <key-file> | encrypt <input> <output> <key-file> | decrypt <input> <output> <key-file>");
}
