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
never write. Managed checkouts (clone/pull) and write tools are later phases.
