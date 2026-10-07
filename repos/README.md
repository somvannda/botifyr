# Connected code checkouts

This directory is the **default** mount point for code the engineering agents
may read (see [`docs/codebase-access.md`](../docs/codebase-access.md), #6).

`docker-compose.yml` mounts `${BOTIFYR_REPOS_HOST:-./repos}` read-only at
`/repos` inside the `cloud` container. To let the dev team read a real repo:

1. Set the host directory in a root `.env` (gitignored), e.g.

   ```
   BOTIFYR_REPOS_HOST=G:/Developments/botifyr.xyz
   ```

   (Use forward slashes on Windows.)

2. Recreate the cloud: `docker compose up -d --force-recreate cloud`.
3. In the app: **Company HQ → Office → Code repositories**, connect a repo whose
   **path is `/repos`** (or `/repos/<subdir>`).

The mount is **read-only**; the `code.*` tools can browse, search and read, but
never write. Engineering agents can also **clone a repo by URL** (with an
optional token from the shared vault) into `/managed` — see the HQ Office tab →
*Clone from URL*. `code.apply` stages proposed edits under `/work` and the HQ
**Changes** tab shows the diff.

Connected repo paths must live under `BOTIFYR_REPOS_DIR` (`/repos`) or
`BOTIFYR_MANAGED_DIR` (`/managed`); the API rejects anything else. For
single-tenant self-host, set `BOTIFYR_ALLOW_LOCAL_REPO_PATHS=1` to allow
arbitrary local paths.
