// scripts/lib/hq-security.test.mjs — regression tests for the live HQ proxy's
// static-file serving and DNS-rebinding defenses (scripts/hq-live.mjs).
// Talks to a real spawned instance over plain HTTP; no browser required, so
// this stays fast enough to run on every red-first check.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { request } from "node:http";

let hqProcess;
let hqPort;
let agentsDir;

function get(path, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = request(
      { hostname: "127.0.0.1", port: hqPort, path, method: "GET", headers },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString("utf8") }));
      },
    );
    req.on("error", reject);
    req.end();
  });
}

function startHq() {
  return new Promise((resolve, reject) => {
    agentsDir = mkdtempSync(join(tmpdir(), "hq-security-"));
    hqProcess = spawn(process.execPath, [join("scripts", "hq-live.mjs")], {
      env: {
        ...process.env,
        HQ_PORT: "0",
        // Ohne das regeneriert hq-live docs/dev-hq/data.json und data.js im
        // ECHTEN Baum — ein Test, der getrackte Dateien anfasst, macht den
        // Arbeitsbaum bei jedem `prepush` dreckig. Geprueft werden hier
        // Routen bzw. Absicherung, nicht die Erzeugung des Snapshots.
        HQ_SKIP_SNAPSHOT: "1",
        PROJECTA_API_DESCRIPTOR: join(agentsDir, "descriptor.json"),
        PROJECTA_AGENTS_FILE: join(agentsDir, "agents.json"),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    writeFileSync(join(agentsDir, "descriptor.json"), JSON.stringify({ port: 1, token: "unused" }));
    let stderr = "";
    hqProcess.stderr.on("data", (chunk) => { stderr += chunk; });
    hqProcess.stdout.on("data", (chunk) => {
      const match = /127\.0\.0\.1:(\d+)\/live\.html/.exec(chunk.toString());
      if (match) resolve(Number(match[1]));
    });
    hqProcess.on("exit", () => reject(new Error(`hq-live exited: ${stderr}`)));
  });
}

before(async () => { hqPort = await startHq(); });
after(async () => {
  hqProcess?.kill();
  if (agentsDir) rmSync(agentsDir, { recursive: true, force: true });
});

// Regression for the Windows-only `normalize(docs + "\\")` boundary check,
// which made every static asset 404 on Linux/macOS checkouts (and thus in
// CI): live.html itself must be served, not just fail closed safely.
test("static files are served on every platform (live.html, not a 404)", async () => {
  const response = await get("/live.html");
  assert.equal(response.status, 200);
  assert.match(response.body, /<html/i);
});

test("static file responses embed a per-process HQ session token", async () => {
  const response = await get("/live.html");
  assert.match(response.body, /<meta name="hq-session" content="[0-9a-f]{20,}">/);
});

// DNS rebinding: a page from an attacker-controlled hostname that some victim
// browser resolved to 127.0.0.1 still sends that hostname as the Host header
// (browsers do not rewrite it), so requests with an unexpected Host must be
// rejected before the Control API token is ever attached.
test("/__hq/* rejects requests with an unexpected Host header", async () => {
  const response = await get("/__hq/analysis", { host: "evil.example:1", "x-hq-session": "irrelevant" });
  assert.equal(response.status, 403);
  assert.match(JSON.parse(response.body).code, /forbidden_host/);
});

test("/__hq/* rejects requests without the session token handed out in the HTML", async () => {
  const response = await get("/__hq/analysis", { host: `127.0.0.1:${hqPort}` });
  assert.equal(response.status, 403);
  assert.match(JSON.parse(response.body).code, /forbidden_session/);
});

test("/__hq/* accepts requests carrying the real session token on the right host", async () => {
  const page = await get("/live.html", { host: `127.0.0.1:${hqPort}` });
  const token = /<meta name="hq-session" content="([0-9a-f]+)">/.exec(page.body)[1];
  const response = await get("/__hq/analysis", { host: `127.0.0.1:${hqPort}`, "x-hq-session": token });
  assert.equal(response.status, 200);
});
