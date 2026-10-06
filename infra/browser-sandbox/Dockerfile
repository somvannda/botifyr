# Botifyr browser sandbox
#
# A throwaway container that runs a headless Chromium and exposes a tiny HTTP
# action API on port 8788. The cloud spawns one per task and removes it when the
# task ends, so nothing the agent does touches the host.
#
# Build from the repo root:
#   docker build -t botifyr/browser-sandbox:1.63.0 infra/browser-sandbox
#
# The base image is version-matched to the `playwright` dependency so the
# bundled browsers are used without an extra download.

FROM mcr.microsoft.com/playwright:v1.63.0-noble

WORKDIR /app

RUN npm init -y >/dev/null 2>&1 \
  && npm install playwright@1.63.0 --no-audit --no-fund

COPY server.mjs ./

ENV PORT=8788
EXPOSE 8788

CMD ["node", "server.mjs"]
