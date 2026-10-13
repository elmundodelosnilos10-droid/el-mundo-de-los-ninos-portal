/** Worker server transport. No Node HTTP/TCP, ws or Undici dependency. */
import type { WebSocketLikeConstructor } from "@supabase/realtime-js";

export const schoolRealtimeTransport: WebSocketLikeConstructor = globalThis.WebSocket;
