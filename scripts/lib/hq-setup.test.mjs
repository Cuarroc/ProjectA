import { test } from "node:test";
import assert from "node:assert/strict";
import { runSetupChecks, CHECKS } from "./hq-setup.mjs";

const healthy = {
  nodeVersion: "v24.0.0", nodeModules: true, gitVersion: "git version 2.43", hooksPath: ".githooks",
  descriptorPath: "/home/x/.local/share/com.projecta.app/projecta-api.json", apiReachable: true, apiStatus: 200,
  agentsFile: "/repo/src-tauri/target/debug/agents.json", exeFound: true, cargoVersion: "cargo 1.89", platform: "linux",
  gtkFound: true, chromium: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", specsGateOk: true, activeSpecs: 19,
};

test("a healthy machine is ready with every check ok", () => {
  const result = runSetupChecks(healthy);
  assert.equal(result.ready, true);
  assert.equal(result.counts.fail, 0);
  assert.equal(result.checks.length, CHECKS.length);
  assert.ok(result.checks.every((c) => c.state === "ok"), JSON.stringify(result.checks.filter((c) => c.state !== "ok")));
});

test("a missing app is a warning with the start hint, not a blocker", () => {
  const result = runSetupChecks({ ...healthy, descriptorPath: null, apiReachable: false });
  assert.equal(result.ready, true);
  const descriptor = result.checks.find((c) => c.id === "descriptor");
  assert.equal(descriptor.state, "warn");
  assert.match(descriptor.fix, /tauri dev|PROJECTA_API_DESCRIPTOR/);
  assert.equal(result.checks.find((c) => c.id === "api").state, "warn");
});

test("a stale descriptor with a dead API blocks and names the restart", () => {
  const result = runSetupChecks({ ...healthy, apiReachable: false, apiStatus: null });
  assert.equal(result.ready, false);
  assert.match(result.checks.find((c) => c.id === "api").fix, /Restart ProjectA/);
});

test("missing GTK libs on linux produce a copyable apt line; other platforms skip", () => {
  const linux = runSetupChecks({ ...healthy, gtkFound: false });
  assert.match(linux.checks.find((c) => c.id === "gtk").fix, /apt-get install/);
  assert.ok(linux.fixScript.some((line) => line.startsWith("apt-get")), "shell-ready fixes are collected");
  const win = runSetupChecks({ ...healthy, platform: "win32", gtkFound: false });
  assert.equal(win.checks.find((c) => c.id === "gtk").state, "ok");
});

test("old node and missing node_modules fail with the fix command", () => {
  const result = runSetupChecks({ ...healthy, nodeVersion: "v18.0.0", nodeModules: false });
  assert.equal(result.ready, false);
  assert.equal(result.counts.fail, 2);
  assert.ok(result.fixScript.includes("npm ci"));
});
