# Botifyr web portal — Vite build served by nginx.
#
# Like the desktop app, the portal is just a client of the cloud API: it holds
# no server state, so a static image is all it needs.
FROM node:20-alpine AS build
WORKDIR /repo

# Workspace manifests first (better layer caching).
COPY package.json ./
COPY tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/client/package.json packages/client/
COPY packages/ui/package.json packages/ui/
COPY apps/portal/package.json apps/portal/
RUN npm install --no-audit --no-fund

# Sources for the packages the portal consumes.
COPY packages/shared ./packages/shared
COPY packages/client ./packages/client
COPY packages/ui ./packages/ui
COPY apps/portal ./apps/portal

# The cloud URL is baked into the bundle at build time.
ARG VITE_CLOUD_URL=http://localhost:8787
ENV VITE_CLOUD_URL=$VITE_CLOUD_URL
RUN npm run build -w @botifyr/portal

FROM nginx:1.27-alpine
COPY --from=build /repo/apps/portal/dist /usr/share/nginx/html
RUN printf '%s\n' \
  'server {' \
  '  listen 80;' \
  '  root /usr/share/nginx/html;' \
  '  index index.html;' \
  '  location / {' \
  '    try_files $uri $uri/ /index.html;' \
  '  }' \
  '}' > /etc/nginx/conf.d/default.conf

EXPOSE 80
