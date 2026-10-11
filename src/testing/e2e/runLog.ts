import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface RunStep {
  route: string;
  status: "passed" | "failed";
  errors: string[];
}

export async function createRunLog(root: string) {
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(join(root, "run-"));
  const steps: (RunStep & { step: number; screenshot: string })[] = [];
  const save = () => writeFile(join(directory, "steps.json"), JSON.stringify(steps, null, 2) + "\n");
  await save();
  return {
    directory,
    // The caller awaits each record so the step order matches the browser run.
    async record(entry: RunStep, capture: (path: string) => Promise<unknown>) {
      const step = steps.length + 1;
      const screenshot = `${String(step).padStart(3, "0")}.png`;
      await capture(join(directory, screenshot));
      steps.push({
        ...entry, status: entry.errors.length ? "failed" : entry.status,
        errors: [...entry.errors], step, screenshot,
      });
      await save();
    },
  };
}
