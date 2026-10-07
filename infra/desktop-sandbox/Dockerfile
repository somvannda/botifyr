# Botifyr desktop sandbox
#
# A throwaway container with a virtual X desktop (Xvfb + openbox + xterm) and a
# tiny HTTP API for computer use: screenshot, move, click, type, key, scroll —
# plus a live MJPEG stream of the framebuffer. One container per task.
#
# Build from the repo root:
#   docker build -t botifyr/desktop-sandbox:1 infra/desktop-sandbox

FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    procps \
    xvfb \
    x11-utils \
    xdotool \
    ffmpeg \
    openbox \
    xterm \
    chromium \
    fonts-dejavu-core \
    libgl1 \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY server.mjs ./

ENV DISPLAY=:99 \
    SCREEN_WIDTH=1280 \
    SCREEN_HEIGHT=800 \
    PORT=8790
EXPOSE 8790

CMD ["node", "server.mjs"]
