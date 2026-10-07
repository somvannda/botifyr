import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";

/**
 * A throwaway Docker container with a published HTTP port, used as an isolated
 * execution sandbox. Shared by the browser and desktop computer backends so the
 * container lifecycle (start, discover port, wait healthy, remove) lives in one
 * place.
 */

const exec = promisify(execFile);

export interface ContainerSpec {
  image: string;
  /** Port the service inside the container listens on. */
  containerPort: number;
  /** Prefix for the generated container name. */
  namePrefix: string;
  /** Extra `-v` mounts, e.g. "botifyr-downloads:/downloads". */
  volumes?: string[];
  startupTimeoutMs?: number;
}

export interface ContainerHandle {
  /** Start the container if needed and return its host base URL. */
  ensureStarted(): Promise<string>;
  /** Stop and remove the container. Safe to call more than once. */
  close(): Promise<void>;
}

async function waitForHealth(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${url}/health`);
      if (response.ok) return;
    } catch {
      // not ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`sandbox did not become healthy within ${timeoutMs}ms`);
}

export function createContainerHandle(spec: ContainerSpec): ContainerHandle {
  const name = `${spec.namePrefix}-${randomUUID().slice(0, 8)}`;
  let baseUrl: string | null = null;

  return {
    async ensureStarted(): Promise<string> {
      if (baseUrl) return baseUrl;

      const network = process.env.BOTIFYR_SANDBOX_NETWORK;
      const args = ["run", "-d", "--rm", "--name", name];
      if (network) {
        args.push("--network", network);
      } else {
        args.push("-p", `127.0.0.1::${spec.containerPort}`);
      }
      for (const volume of spec.volumes ?? []) {
        args.push("-v", volume);
      }
      args.push(spec.image);
      await exec("docker", args);

      if (network) {
        // Shared Docker network: address the sandbox by container name.
        baseUrl = `http://${name}:${spec.containerPort}`;
      } else {
        const { stdout } = await exec("docker", ["port", name, String(spec.containerPort)]);
        const match = stdout.match(/:(\d+)\s*$/m);
        if (!match) {
          throw new Error(`could not resolve a host port for ${name}: ${stdout.trim()}`);
        }
        baseUrl = `http://127.0.0.1:${match[1]}`;
      }

      await waitForHealth(baseUrl, spec.startupTimeoutMs ?? 60_000);
      return baseUrl;
    },

    async close(): Promise<void> {
      try {
        await exec("docker", ["rm", "-f", name]);
      } catch {
        // already gone
      }
      baseUrl = null;
    },
  };
}

/**
 * Remove leftover per-task sandbox containers. A cloud crash can leave them
 * running (they can't be resumed), so the next boot sweeps them up. Returns the
 * number of containers removed. Best-effort: never throws.
 */
export async function removeOrphanedSandboxes(
  prefixes: string[] = ["botifyr-sbx", "botifyr-code", "botifyr-desk"],
): Promise<number> {
  let removed = 0;
  for (const prefix of prefixes) {
    try {
      const { stdout } = await exec("docker", ["ps", "-aq", "--filter", `name=${prefix}`]);
      for (const id of stdout.split(/\s+/).filter(Boolean)) {
        try {
          await exec("docker", ["rm", "-f", id]);
          removed += 1;
        } catch {
          // already gone
        }
      }
    } catch {
      // Docker unavailable — nothing to sweep.
    }
  }
  return removed;
}
