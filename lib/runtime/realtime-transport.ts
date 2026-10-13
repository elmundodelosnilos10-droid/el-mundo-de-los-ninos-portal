/** Node server transport. Workers resolve the separate native module at build time. */
import WebSocket from "ws";
import type { WebSocketLikeConstructor } from "@supabase/realtime-js";

// closeTimeout is supported by ws 8.21.3; its separate DefinitelyTyped client
// options do not declare it yet. Node's agent:false requests one own connection.
const socketOptions = Object.freeze({
  agent: false as const,
  followRedirects: false,
  handshakeTimeout: 10_000,
  closeTimeout: 1_000,
  perMessageDeflate: false,
});

class SchoolNodeWebSocket extends WebSocket {
  constructor(address: string | URL, protocols?: string | string[]) {
    // A dedicated HTTP Upgrade connection never shares fetch's Undici pool.
    super(address, protocols, socketOptions);
  }
}

// ws supplies the SDK's browser-compatible events; its declarations use its own
// event classes instead of DOM event classes for listener callback signatures.
// Keep this compatibility boundary here rather than casting SDK/client options.
export const schoolRealtimeTransport = SchoolNodeWebSocket as unknown as WebSocketLikeConstructor;
