# Botifyr marketing + help site.
#
# Static files served by nginx. `/help` maps to `help.html`, so the app's
# Support link (https://botifyr.xyz/help) works once this is deployed.
FROM nginx:1.27-alpine

COPY index.html help.html admin.html skills.html styles.css favicon.svg /usr/share/nginx/html/

RUN printf '%s\n' \
  'server {' \
  '  listen 80;' \
  '  root /usr/share/nginx/html;' \
  '  index index.html;' \
  '  location / {' \
  '    try_files $uri $uri.html $uri/ =404;' \
  '  }' \
  '}' > /etc/nginx/conf.d/default.conf

EXPOSE 80
