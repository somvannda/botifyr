# Botifyr website + user portal.
#
# One image serves the marketing/help/skills pages at `/` and the React portal
# (built with Vite) under `/portal`, so "website + portal" ships as a single
# platform.
FROM node:20-alpine AS portal
WORKDIR /repo

COPY package.json ./
COPY tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/client/package.json packages/client/
COPY packages/ui/package.json packages/ui/
COPY apps/portal/package.json apps/portal/
RUN npm install --no-audit --no-fund

COPY packages/shared ./packages/shared
COPY packages/client ./packages/client
COPY packages/ui ./packages/ui
COPY apps/portal ./apps/portal

# Baked into the bundle at build time.
ARG VITE_CLOUD_URL=http://localhost:8787
ENV VITE_CLOUD_URL=$VITE_CLOUD_URL
RUN npm run build -w @botifyr/portal -- --base=/portal/

FROM nginx:1.27-alpine
COPY apps/web/index.html apps/web/help.html apps/web/skills.html apps/web/developers.html apps/web/styles.css apps/web/favicon.svg /usr/share/nginx/html/
# The shared UI's @font-face uses absolute /fonts/… paths; serve them at the root
# so the portal (which lives under /portal) loads the same fonts as the desktop.
COPY apps/portal/public/fonts /usr/share/nginx/html/fonts
COPY --from=portal /repo/apps/portal/dist /usr/share/nginx/html/portal

ARG ADMIN_URL=http://localhost:4324
RUN printf '%s\n' \
  'server {' \
  '  listen 80;' \
  '  root /usr/share/nginx/html;' \
  '  index index.html;' \
  "  location = /admin { return 302 ${ADMIN_URL}; }" \
  "  location = /admin.html { return 302 ${ADMIN_URL}; }" \
  '  location /portal {' \
  '    add_header Cache-Control "no-cache";' \
  '    try_files $uri $uri/ /portal/index.html;' \
  '  }' \
  '  location / {' \
  '    try_files $uri $uri.html $uri/ =404;' \
  '  }' \
  '}' > /etc/nginx/conf.d/default.conf

EXPOSE 80
