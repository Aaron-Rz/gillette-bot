// Presenter version: serves the bot and lets Claude handle unclear turns – on the owner's own Claude subscription,
// for the owner's own use only. Bind to localhost and publish only inside the owner's tailnet (tailscale serve),
// never on the public internet (no Funnel).
//
//   node server/sam-ai.mjs            → http://127.0.0.1:8117
//   PORT=8117 MODEL=haiku node server/sam-ai.mjs
import http from "node:http";
import { spawn } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.PORT || 8117);
const HOST = process.env.HOST || "127.0.0.1";
const MODEL = process.env.MODEL || "haiku";
const CLAUDE = process.env.CLAUDE_BIN || "claude";
const MAX_BODY = 80_000, TIMEOUT_MS = 45_000, MAX_PARALLEL = 2, PER_MINUTE = 30;

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".json": "application/json", ".ico": "image/x-icon", ".pdf": "application/pdf" };
const SCHEMA = JSON.stringify({ type: "object", properties: { reply: { type: "string" }, actions: { type: "array", items: { type: "object", properties: { tool: { type: "string" }, input: { type: "object" } }, required: ["tool"] } } }, required: ["reply", "actions"] });

let running = 0;
const recent = [];

function runClaude(system, prompt) {
  return new Promise((resolve, reject) => {
    const args = ["-p", "--model", MODEL, "--tools", "", "--output-format", "json", "--no-session-persistence", "--setting-sources", "", "--strict-mcp-config", "--system-prompt", system, "--json-schema", SCHEMA];
    const child = spawn(CLAUDE, args, { cwd: "/tmp", stdio: ["pipe", "pipe", "pipe"] });
    let out = "", err = "";
    const timer = setTimeout(() => { child.kill("SIGTERM"); reject(new Error("timeout")); }, TIMEOUT_MS);
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { err += d; });
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
    child.on("close", (code) => {
      clearTimeout(timer);
      try {
        const j = JSON.parse(out);
        if (j.is_error) return reject(new Error("claude error"));
        const r = j.structured_output || JSON.parse(j.result);
        resolve({ reply: String(r.reply || ""), actions: Array.isArray(r.actions) ? r.actions.slice(0, 4) : [], ms: j.duration_ms });
      } catch { reject(new Error(`bad output (exit ${code})${err ? ": " + err.slice(0, 200) : ""}`)); }
    });
    child.stdin.end(prompt);
  });
}

function send(res, status, body, type = "application/json") {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

async function api(req, res) {
  if (req.url === "/api/health") return send(res, 200, { ok: true, model: MODEL });
  if (req.url !== "/api/turn" || req.method !== "POST") return send(res, 404, { error: "not found" });
  const now = Date.now();
  while (recent.length && now - recent[0] > 60_000) recent.shift();
  if (running >= MAX_PARALLEL || recent.length >= PER_MINUTE) return send(res, 429, { error: "busy" });
  let body = "";
  for await (const chunk of req) { body += chunk; if (body.length > MAX_BODY) return send(res, 413, { error: "too large" }); }
  let data;
  try { data = JSON.parse(body); } catch { return send(res, 400, { error: "bad json" }); }
  const system = String(data.system || "").slice(0, 60_000);
  const msgs = Array.isArray(data.messages) ? data.messages.slice(-12) : [];
  if (!system || !msgs.length) return send(res, 400, { error: "missing system/messages" });
  const transcript = msgs.map((m) => `${m.role === "assistant" ? "Sam" : "Shopper"}: ${String(m.content).slice(0, 2000)}`).join("\n");
  running++; recent.push(now);
  try {
    const r = await runClaude(system, `Conversation so far:\n${transcript}\n\nDecide Sam's next actions and reply to the shopper's last message.`);
    console.log(new Date().toISOString(), "turn ok", r.ms + "ms", r.actions.map((a) => a.tool).join(","));
    send(res, 200, r);
  } catch (e) {
    console.warn(new Date().toISOString(), "turn failed", e.message);
    send(res, 502, { error: "ai unavailable" });
  } finally { running--; }
}

async function files(req, res) {
  let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (p.endsWith("/")) p += "index.html";
  const full = path.resolve(ROOT, "." + p);
  const rel = "/" + path.relative(ROOT, full) + "/";
  if (!full.startsWith(ROOT + path.sep) || /\/\.|\/(server|test|node_modules)\//.test(rel)) return send(res, 404, "not found", "text/plain");
  try {
    if (!(await stat(full)).isFile()) throw new Error();
    send(res, 200, await readFile(full), MIME[path.extname(full)] || "application/octet-stream");
  } catch { send(res, 404, "not found", "text/plain"); }
}

http.createServer((req, res) => (req.url.startsWith("/api/") ? api(req, res) : files(req, res)).catch(() => send(res, 500, { error: "server" })))
  .listen(PORT, HOST, () => console.log(`Sam presenter version on http://${HOST}:${PORT} (model ${MODEL})`));
