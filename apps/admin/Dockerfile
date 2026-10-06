# Botifyr admin console — Vite build served by nginx.
FROM node:20-alpine AS build
WORKDIR /repo

COPY package.json ./
COPY tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/client/package.json packages/client/
COPY packages/ui/package.json packages/ui/
COPY apps/admin/package.json apps/admin/
RUN npm install --no-audit --no-fund

COPY packages/shared ./packages/shared
COPY packages/client ./packages/client
COPY packages/ui ./packages/ui
COPY apps/admin ./apps/admin

ARG VITE_CLOUD_URL=http://localhost:8787
ENV VITE_CLOUD_URL=$VITE_CLOUD_URL
RUN npm run build -w @botifyr/admin

FROM nginx:1.27-alpine
COPY --from=build /repo/apps/admin/dist /usr/share/nginx/html
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
