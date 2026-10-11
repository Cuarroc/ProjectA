export interface RunStep {
  route: string;
  status: "passed" | "failed";
  errors: string[];
}

export async function createRunLog(root: string) {
  return {
    directory: root,
    async record(_step: RunStep, _capture: (path: string) => Promise<unknown>) {
      throw new Error("Run log is not implemented");
    },
  };
}
