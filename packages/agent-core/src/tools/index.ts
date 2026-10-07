import type { BrowserBackend } from "./browser.js";
import { createLocalBrowserBackend, type LocalBrowserOptions } from "./browser-local.js";
import { createDockerBrowserBackend, type DockerBrowserOptions } from "./browser-docker.js";
import { createDockerShellBackend, type DockerShellOptions } from "./shell-docker.js";

export { createBrowserTools } from "./browser.js";
export type { BrowserBackend, BrowserTools } from "./browser.js";
export { createLocalBrowserBackend } from "./browser-local.js";
export type { LocalBrowserOptions } from "./browser-local.js";
export { createDockerBrowserBackend } from "./browser-docker.js";
export type { DockerBrowserOptions } from "./browser-docker.js";

export { createComputerTools } from "./computer.js";
export type { ComputerBackend, ComputerTools } from "./computer.js";
export { createDockerComputerBackend } from "./computer-docker.js";
export type { DockerComputerOptions } from "./computer-docker.js";

export { createShellTools } from "./shell.js";
export type { ShellBackend, ShellTools } from "./shell.js";
export { createMediaTools } from "./media.js";
export type { MediaTools } from "./media.js";
export { createDockerShellBackend } from "./shell-docker.js";
export type { DockerShellOptions } from "./shell-docker.js";

export interface BrowserBackendOptions {
  /** "local" runs in-process; "docker" isolates each task in a container. */
  mode?: "local" | "docker";
  local?: LocalBrowserOptions;
  docker?: DockerBrowserOptions;
}

/** Choose a browser backend from configuration. */
export function createBrowserBackend(options: BrowserBackendOptions = {}): BrowserBackend {
  if ((options.mode ?? "local") === "docker") {
    return createDockerBrowserBackend(options.docker);
  }
  return createLocalBrowserBackend(options.local);
}

/** Code/shell backends are always container-isolated. */
export function createShellBackend(options: DockerShellOptions = {}) {
  return createDockerShellBackend(options);
}

// Keep the computer backend factory reachable from one place too.
export { createDockerComputerBackend as createComputerBackend } from "./computer-docker.js";
export type { ComputerBackend as AnyComputerBackend } from "./computer.js";
export { removeOrphanedSandboxes } from "../sandbox/docker.js";
