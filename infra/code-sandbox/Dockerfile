# Botifyr code sandbox
#
# A throwaway container for running code and shell commands, isolated per task.
# Runs as a non-root user with a dedicated /workspace and exposes a tiny HTTP
# action API (exec / read / write / list).
#
# Build from the repo root:
#   docker build -t botifyr/code-sandbox:1 infra/code-sandbox

FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    git \
    jq \
    ripgrep \
    python3 \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY server.mjs ./

RUN mkdir -p /workspace \
  && useradd -m -s /bin/bash runner \
  && chown -R runner:runner /workspace

USER runner

ENV WORKSPACE=/workspace \
    PORT=8792 \
    NODE_ENV=production
EXPOSE 8792

CMD ["node", "server.mjs"]
