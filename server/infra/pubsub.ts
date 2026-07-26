import { Server as IOServer } from "socket.io";
import type { Server as HttpServer } from "node:http";

// Minimal socket.io pub/sub, modeled on mulmoclaude's server/events/pub-sub.
// Channel names are socket.io rooms — subscribe/unsubscribe map to
// socket.join / socket.leave, and publish broadcasts to the room.
// socket.io handles reconnect / heartbeat / transport for us.
// What a module that only ANNOUNCES needs. Depending on the whole createPubSub return type
// instead means every such module — and every test fake — has to grow a method it never
// calls each time this file gains one.
export interface Publisher {
  publish(channel: string, data: unknown): void;
}

export function createPubSub(server: HttpServer, isAllowedOrigin: (origin?: string) => boolean = () => true) {
  const io = new IOServer(server, {
    path: "/ws/pubsub",
    transports: ["websocket"],
    // Reject cross-origin connections so an untrusted website can't subscribe to
    // session activity. allowRequest covers the websocket handshake; cors covers
    // any polling/preflight.
    allowRequest: (req, cb) => cb(null, isAllowedOrigin(req.headers.origin)),
    cors: {
      origin: (origin, cb) => cb(null, isAllowedOrigin(origin)),
      credentials: true,
    },
  });

  io.on("connection", (socket) => {
    socket.on("subscribe", (channel) => {
      if (typeof channel === "string") socket.join(channel);
    });
    socket.on("unsubscribe", (channel) => {
      if (typeof channel === "string") socket.leave(channel);
    });
  });

  return {
    publish(channel: string, data: unknown) {
      io.to(channel).emit("data", { channel, data });
    },
    // How many sockets are in the room. A publish is fire-and-forget, so a caller that
    // NEEDS someone to act on the message (the phone asking the grid to open a terminal,
    // #831) has to check first — otherwise "no browser is open" is indistinguishable from
    // success, and the phone reports a launch that never happened.
    subscriberCount(channel: string): number {
      return io.sockets.adapter.rooms.get(channel)?.size ?? 0;
    },
  };
}
