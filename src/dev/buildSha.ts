export function buildSha(envSha: string | undefined, gitSha: string | undefined) {
  return envSha || gitSha || "lokal";
}
