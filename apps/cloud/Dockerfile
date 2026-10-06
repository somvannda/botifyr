# Botifyr cloud service.
#
# Includes the Docker CLI so it can spawn per-task sandboxes through the host's
# Docker socket (mounted in docker-compose), and runs the TypeScript sources
# directly with tsx.

FROM node:22-bookworm-slim

# Do not download Playwright browsers: browsers run in the sandbox containers.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    NODE_ENV=development

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates docker.io \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies first (better layer caching).
COPY package.json package-lock.json* tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/agent-core/package.json packages/agent-core/
COPY packages/channels/package.json packages/channels/
COPY apps/cloud/package.json apps/cloud/
COPY apps/desktop/package.json apps/desktop/
RUN npm install --no-audit --no-fund

# Application sources.
COPY packages ./packages
COPY apps/cloud ./apps/cloud

EXPOSE 8787
CMD ["npm", "run", "start", "-w", "@botifyr/cloud"]
