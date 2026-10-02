// Regression tests for static-file path containment in the live HQ proxy.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { request } from "node:http";

const script = join(import.meta.dirname, "..", "hq-live.mjs");
let fixture;
let hqProcess;
let hqPort;

function get(path) {
  return new Promise((resolve, reject) => {
    const req = request({ hostname: "127.0.0.1", port: hqPort, path, method: "GET" }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    req.end();
  });
}

before(async () => {
  fixture = mkdtempSync(join(tmpdir(), "hq-static-paths-"));
  const docs = join(fixture, "docs", "dev-hq");
  mkdirSync(docs, { recursive: true });
  writeFileSync(join(docs, "index.html"), "<h1>safe</h1>");
  writeFileSync(join(fixture, "secret.txt"), "outside static root");
  symlinkSync(join(fixture, "secret.txt"), join(docs, "leak.txt"));
  hqPort = await new Promise((resolve, reject) => {
    hqProcess = spawn(process.execPath, [script], {
      cwd: fixture,
      env: { ...process.env, HQ_PORT: "0", HQ_SKIP_SNAPSHOT: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    hqProcess.stderr.on("data", (chunk) => { stderr += chunk; });
    hqProcess.stdout.on("data", (chunk) => {
      const match = /127\.0\.0\.1:(\d+)\/live\.html/.exec(chunk.toString());
      if (match) resolve(Number(match[1]));
    });
    hqProcess.on("exit", () => reject(new Error(`hq-live exited: ${stderr}`)));
  });
});

after(() => {
  hqProcess?.kill();
  if (fixture) rmSync(fixture, { recursive: true, force: true });
});

async function assertStaticRequestsStayContained() {
  const safe = await get("/");
  assert.equal(safe.status, 200);
  assert.match(safe.body, /safe/);

  for (const path of ["/%2e%2e/secret.txt", "/%2e%2e%2fsecret.txt", "/tmp/secret.txt", "/leak.txt"]) {
    const response = await get(path);
    assert.equal(response.status, 404, `${path} must stay outside the static root`);
    assert.doesNotMatch(response.body, /outside static root/);
  }
}

test("static requests cannot escape encoded traversal absolute-looking paths or symlinks", async () => {
  await assertStaticRequestsStayContained();
});

// Keep the exact name recorded by the red-first test commit. The subsequent
// fix commit accidentally used a shortened spelling in its own trailer.
test("static requests cannot escape through encoded traversal, absolute-looking paths, or symlinks", async () => {
  await assertStaticRequestsStayContained();
});
