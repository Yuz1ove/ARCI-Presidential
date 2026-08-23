import { closeSync, fstatSync, openSync, readSync } from "node:fs";

export const PERSISTENCE_MAX_FILE_BYTES = 16 * 1024 * 1024;
export const PERSISTENCE_MAX_RECORDS = 10_000;

export function readBoundedUtf8FileSync(filePath: string, maximumBytes = PERSISTENCE_MAX_FILE_BYTES): string {
  const descriptor = openSync(filePath, "r");
  try {
    const status = fstatSync(descriptor);
    if (!status.isFile() || status.size > maximumBytes) throw new Error("PERSISTENCE_FILE_LIMIT_EXCEEDED");
    const chunks: Buffer[] = [];
    const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, maximumBytes + 1));
    let total = 0;
    while (true) {
      const bytesRead = readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      total += bytesRead;
      if (total > maximumBytes) throw new Error("PERSISTENCE_FILE_LIMIT_EXCEEDED");
      chunks.push(Buffer.from(buffer.subarray(0, bytesRead)));
    }
    return Buffer.concat(chunks, total).toString("utf8");
  } finally {
    closeSync(descriptor);
  }
}
