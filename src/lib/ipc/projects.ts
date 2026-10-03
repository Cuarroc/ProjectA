import { invoke } from "@tauri-apps/api/core";

import type { Project } from "../../types";
import { nonEmpty } from "./shared";

// -- projects (Phase 2) ------------------------------------------------------

/** A project as it comes off the wire, before the test gate is settled. */
type RawProject = Omit<Project, "githubRemote" | "testCommand" | "maxWorkers"> & {
  githubRemote?: boolean | null;
  testCommand?: string | null;
  maxWorkers?: number | null;
};

/**
 * A project from a core that predates GitHub linking has no remote, and a core
 * that knows nothing about test gates simply has none — the board must not
 * grow a Tests button on a guess. A missing worker cap is read the same way:
 * absent means "no project-owned limit", never zero.
 */
function toProject(raw: RawProject): Project {
  return {
    ...raw,
    githubRemote: raw.githubRemote === true,
    maxWorkers: raw.maxWorkers ?? null,
    testCommand: nonEmpty(raw.testCommand),
  };
}

export async function createProject(name: string, repoPath: string): Promise<Project> {
  return toProject(await invoke<RawProject>("create_project", { name, repoPath }));
}

export async function listProjects(): Promise<Project[]> {
  const raw = await invoke<RawProject[]>("list_projects");
  return Array.isArray(raw) ? raw.map(toProject) : [];
}

/** Forgets the project and archives its workers; nothing is deleted from disk. */
export function removeProject(id: string): Promise<void> {
  return invoke<void>("remove_project", { id });
}

// -- github (Phase GH) --------------------------------------------------------

/**
 * Creates a new GitHub repository for the project and links it as `origin`.
 * Resolves with the repository URL; failures come back as plain error strings.
 */
export function createGithubRepo(args: {
  projectId: string;
  name: string;
  private: boolean;
}): Promise<string> {
  return invoke<string>("create_github_repo", {
    projectId: args.projectId,
    name: args.name,
    private: args.private,
  });
}

/** Links an existing GitHub repository as the project's remote. */
export function linkGithubRemote(projectId: string, url: string): Promise<void> {
  return invoke<void>("link_github_remote", { projectId, url });
}
