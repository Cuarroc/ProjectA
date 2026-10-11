export function buildInfo() {
  return {
    sha: typeof __BUILD_SHA__ === "string" ? __BUILD_SHA__ : "local",
    time: typeof __BUILD_TIME__ === "string" ? __BUILD_TIME__ : "",
  };
}
