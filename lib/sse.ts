/**
 * Incremental parser for `text/event-stream` bodies. Feed it decoded chunks;
 * it returns the `data:` payload of every complete event and keeps partial
 * frames buffered until the rest arrives.
 */
export function createSseParser() {
  let buffer = '';
  return {
    push(chunk: string) {
      buffer += chunk;
      const frames = buffer.split(/\r?\n\r?\n/);
      buffer = frames.pop() ?? '';
      const payloads: string[] = [];
      for (const frame of frames) {
        const data = frame
          .split(/\r?\n/)
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(line.startsWith('data: ') ? 6 : 5));
        if (data.length > 0) payloads.push(data.join('\n'));
      }
      return payloads;
    },
  };
}
