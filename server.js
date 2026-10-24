// NoomiClone multiplayer prototype server
// Node.js 18+
// Install: npm install
// Run: npm start
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const WebSocket = require("ws");

const PORT = Number(process.env.PORT || 8080);
const server = http.createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
  res.end("NoomiClone multiplayer prototype server is running. Open the client on a web host.\n");
});
const wss = new WebSocket.Server({ server, maxPayload: 16 * 1024 });

const rooms = new Map(); // roomCode -> Map(clientId -> player)
const clients = new Map(); // ws -> { id, room, name, player }
const ROOM_TTL_MS = 30 * 60 * 1000;
const now = () => Date.now();

function code() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 5; i++) out += chars[crypto.randomInt(chars.length)];
  return out;
}
function createRoom() {
  let id;
  do { id = code(); } while (rooms.has(id));
  rooms.set(id, new Map());
  return id;
}
function send(ws, data) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
}
function roomPlayers(room) {
  const r = rooms.get(room);
  if (!r) return [];
  return [...r.values()].map(p => ({
    id: p.id, name: p.name, x: p.x, y: p.y, angle: p.angle,
    color: p.color, updatedAt: p.updatedAt
  }));
}
function broadcast(room, data, except = null) {
  for (const [ws, c] of clients) {
    if (c.room === room && ws !== except) send(ws, data);
  }
}
function leave(ws) {
  const c = clients.get(ws);
  if (!c) return;
  if (c.room && rooms.has(c.room)) {
    const r = rooms.get(c.room);
    r.delete(c.id);
    broadcast(c.room, { type: "player-left", id: c.id });
    if (r.size === 0) rooms.delete(c.room);
    else broadcast(c.room, { type: "players", players: roomPlayers(c.room) });
  }
  clients.delete(ws);
}
function join(ws, room, name) {
  room = String(room || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5);
  if (!room || !rooms.has(room)) return send(ws, { type: "error", message: "Комната не найдена. Проверь код или создай новую." });
  const c = clients.get(ws);
  if (!c) return;
  if (c.room) leave(ws);
  const color = ["#ffcc33", "#55c7ff", "#ff6b8a", "#77e08b", "#bd91ff"][rooms.get(room).size % 5];
  c.room = room;
  c.name = String(name || "Игрок").trim().slice(0, 18) || "Игрок";
  c.player = { id: c.id, name: c.name, x: 0, y: 0, angle: 0, color, updatedAt: now() };
  rooms.get(room).set(c.id, c.player);
  send(ws, { type: "joined", room, id: c.id, players: roomPlayers(room) });
  broadcast(room, { type: "players", players: roomPlayers(room) }, ws);
}
wss.on("connection", ws => {
  const id = crypto.randomUUID();
  clients.set(ws, { id, room: null, name: "Игрок", player: null });
  send(ws, { type: "hello", id });
  ws.on("message", raw => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return send(ws, { type: "error", message: "Некорректное сообщение." }); }
    const c = clients.get(ws);
    if (!c) return;
    if (msg.type === "create") {
      const room = createRoom();
      join(ws, room, msg.name);
      return;
    }
    if (msg.type === "join") return join(ws, msg.room, msg.name);
    if (msg.type === "move") {
      if (!c.room || !c.player) return;
      const x = Number(msg.x), y = Number(msg.y), angle = Number(msg.angle);
      if (![x, y, angle].every(Number.isFinite)) return;
      // Bound client values to keep messages sane in this demo.
      c.player.x = Math.max(-1, Math.min(1, x));
      c.player.y = Math.max(-1, Math.min(1, y));
      c.player.angle = Math.max(-Math.PI * 4, Math.min(Math.PI * 4, angle));
      c.player.updatedAt = now();
      broadcast(c.room, { type: "player-moved", player: c.player }, ws);
    }
    if (msg.type === "ping") send(ws, { type: "pong", at: now() });
  });
  ws.on("close", () => leave(ws));
  ws.on("error", () => leave(ws));
});
setInterval(() => {
  // Remove stale empty rooms if a future change leaves any behind.
  for (const [id, r] of rooms) if (!r.size) rooms.delete(id);
}, ROOM_TTL_MS).unref();

server.listen(PORT, "0.0.0.0", () => {
  console.log(`NoomiClone multiplayer prototype listening on :${PORT}`);
});
