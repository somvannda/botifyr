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
COPY apps/web/index.html apps/web/help.html apps/web/admin.html apps/web/skills.html apps/web/styles.css apps/web/favicon.svg /usr/share/nginx/html/
COPY --from=portal /repo/apps/portal/dist /usr/share/nginx/html/portal

RUN printf '%s\n' \
  'server {' \
  '  listen 80;' \
  '  root /usr/share/nginx/html;' \
  '  index index.html;' \
  '  location /portal {' \
  '    try_files $uri $uri/ /portal/index.html;' \
  '  }' \
  '  location / {' \
  '    try_files $uri $uri.html $uri/ =404;' \
  '  }' \
  '}' > /etc/nginx/conf.d/default.conf

EXPOSE 80
