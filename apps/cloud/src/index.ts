import { existsSync, readFileSync } from "node:fs";
import { buildServer } from "./server.js";
import { createStore } from "./store/index.js";
import { resolveVaultKey } from "./vault.js";
import { createChannels } from "./channels/index.js";

// Load apps/cloud/.env, explicitly overriding inherited variables. A host
// process can carry its own DEEPSEEK_API_KEY (e.g. an editor or agent runtime)
// which would otherwise shadow the key configured here.
function loadDotEnv(path: string): void {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed
      .slice(eq + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
    if (key) process.env[key] = value;
  }
}
loadDotEnv(".env");

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? "0.0.0.0";
const storeMode = (process.env.BOTIFYR_STORE ?? "memory").toLowerCase();

const store = createStore();
await store.init();

const { key, ephemeral } = resolveVaultKey();
if (ephemeral) {
  console.warn(
    "[botifyr] BOTIFYR_VAULT_KEY is not set — using an ephemeral key; secrets will not survive a restart.",
  );
}

const { service: channelService, local } = createChannels(store);
const app = await buildServer({ store, vaultKey: key, localChannel: local });

try {
  await app.listen({ port, host });
  app.log.info(`Botifyr Cloud listening on http://localhost:${port} (store: ${storeMode})`);
} catch (error) {
  app.log.error(error);
  process.exit(1);
}

await channelService.start();
