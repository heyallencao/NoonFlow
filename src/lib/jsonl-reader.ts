import fs from 'fs';
import { StringDecoder } from 'string_decoder';

const READ_BUFFER_BYTES = 256 * 1024;

/** Iterate a JSONL file without retaining the complete source text in memory. */
export function* iterateJsonlLines(filePath: string): Generator<string> {
  const descriptor = fs.openSync(filePath, 'r');
  const buffer = Buffer.allocUnsafe(READ_BUFFER_BYTES);
  const decoder = new StringDecoder('utf8');
  let pending = '';

  try {
    while (true) {
      const bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      pending += decoder.write(buffer.subarray(0, bytesRead));

      let newlineIndex = pending.indexOf('\n');
      while (newlineIndex >= 0) {
        const line = pending.slice(0, newlineIndex).trim();
        if (line) yield line;
        pending = pending.slice(newlineIndex + 1);
        newlineIndex = pending.indexOf('\n');
      }
    }

    pending += decoder.end();
    const finalLine = pending.trim();
    if (finalLine) yield finalLine;
  } finally {
    fs.closeSync(descriptor);
  }
}
