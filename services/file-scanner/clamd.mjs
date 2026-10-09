import net from "node:net";

export class ScannerUnavailable extends Error {
  constructor() { super("Scanner unavailable"); }
}

/** One bounded socket, one NUL-framed command. No paths or filenames. */
async function exchange(endpoint, timeoutMs, writeInput, signal) {
  if (signal?.aborted || timeoutMs <= 0) throw new ScannerUnavailable();
  const socket = net.createConnection(endpoint);
  let completeInput = false;
  let settled = false;
  let data = Buffer.alloc(0);
  let resolveReply;
  let rejectReply;
  const reply = new Promise((resolve, reject) => { resolveReply = resolve; rejectReply = reject; });
  // Always observe errors, including ones received while awaiting write/backpressure.
  void reply.catch(() => {});
  const fail = () => {
    if (!settled) { settled = true; rejectReply(new ScannerUnavailable()); }
    socket.destroy();
  };
  const timer = setTimeout(fail, timeoutMs);
  signal?.addEventListener("abort", fail, { once: true });
  socket.on("error", fail);
  socket.on("close", () => { if (!settled) fail(); });
  socket.on("data", chunk => {
    if (settled) return;
    if (data.length + chunk.length > 1024) return fail();
    data = Buffer.concat([data, chunk]);
    const end = data.indexOf(0);
    if (end < 0) return;
    // An early OK is not evidence that the complete request was scanned.
    if (!completeInput || end !== data.length - 1 || data.subarray(0, end).some(byte => byte < 32 || byte > 126)) return fail();
    settled = true;
    resolveReply(data.subarray(0, end).toString("ascii"));
  });
  const write = bytes => new Promise((resolve, reject) => {
    if (socket.destroyed || settled) return reject(new ScannerUnavailable());
    socket.write(bytes, error => error ? reject(new ScannerUnavailable()) : resolve());
  });
  try {
    await new Promise((resolve, reject) => {
      socket.once("connect", resolve);
      socket.once("error", () => reject(new ScannerUnavailable()));
      socket.once("close", () => reject(new ScannerUnavailable()));
    });
    await Promise.race([
      writeInput(write, () => { completeInput = true; }),
      reply.then(() => { if (!completeInput) throw new ScannerUnavailable(); }),
    ]);
    return await reply;
  } catch {
    fail();
    throw new ScannerUnavailable();
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", fail);
    socket.destroy();
  }
}

export async function clamdCommand(endpoint, command, timeoutMs = 2000, signal) {
  if (!new Set(["PING", "VERSION"]).has(command)) throw new ScannerUnavailable();
  return exchange(endpoint, timeoutMs, async (write, complete) => {
    complete();
    await write(Buffer.from(`z${command}\0`, "ascii"));
  }, signal);
}

export function verifyLoadedDatabase(version, { engineVersion = "1.4.6", maxDatabaseAgeMs = 86_400_000, now = Date.now() } = {}) {
  const match = /^ClamAV (\d+\.\d+\.\d+)\/([1-9]\d*)\/(Sun|Mon|Tue|Wed|Thu|Fri|Sat) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) +(\d{1,2}) (\d{2}):(\d{2}):(\d{2}) (\d{4})$/.exec(version);
  if (!match || match[1] !== engineVersion || !Number.isSafeInteger(Number(match[2]))) throw new ScannerUnavailable();
  const month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"].indexOf(match[4]);
  const date = new Date(Date.UTC(Number(match[9]), month, Number(match[5]), Number(match[6]), Number(match[7]), Number(match[8])));
  if (date.getUTCFullYear() !== Number(match[9]) || date.getUTCMonth() !== month || date.getUTCDate() !== Number(match[5])
    || date.getUTCHours() !== Number(match[6]) || date.getUTCMinutes() !== Number(match[7]) || date.getUTCSeconds() !== Number(match[8])
    || ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][date.getUTCDay()] !== match[3]
    || now - date.valueOf() > maxDatabaseAgeMs || date.valueOf() > now + 300_000) throw new ScannerUnavailable();
}

export async function scanClamdStream(endpoint, stream, { maxBytes = 20 * 1024 * 1024, timeoutMs = 8000, expectedBytes, signal } = {}) {
  let total = 0;
  const result = await exchange(endpoint, timeoutMs, async (write, complete) => {
    await write(Buffer.from("zINSTREAM\0", "ascii"));
    for await (const raw of stream) {
      const chunk = Buffer.from(raw);
      total += chunk.length;
      if (total > maxBytes || (expectedBytes !== undefined && total > expectedBytes)) throw new ScannerUnavailable();
      for (let offset = 0; offset < chunk.length; offset += 64 * 1024) {
        const part = chunk.subarray(offset, offset + 64 * 1024);
        const length = Buffer.alloc(4);
        length.writeUInt32BE(part.length);
        await write(length);
        await write(part);
      }
    }
    // ClamAV 1.4.6 deliberately skips inputs <= 5 bytes as CL_CLEAN.
    if (total <= 5 || (expectedBytes !== undefined && total !== expectedBytes)) throw new ScannerUnavailable();
    complete();
    await write(Buffer.alloc(4));
  }, signal);
  if (result === "stream: OK") return "clean";
  if (/^stream: [A-Za-z0-9_.() -]{1,200} FOUND$/.test(result)) {
    // Unsupported content or exceeded coverage is not an antivirus finding.
    if (/Heuristics\.(Limits\.Exceeded|Encrypted)/.test(result)) throw new ScannerUnavailable();
    return "infected";
  }
  throw new ScannerUnavailable();
}
