# ChitBridge web — the static site in a small unprivileged nginx (HX0; the same rewrite as vercel.json, deploy/nginx.conf).
#   docker build -t chitbridge-web .   ·   docker run -p 8080:8080 -e CB_API_BASE=https://api.example.com chitbridge-web
# CB_API_BASE (optional): the api this site calls — written into /config.js at start by deploy/40-cb-api-base.sh (HX1). No secret lives here.
FROM nginxinc/nginx-unprivileged:1.27-alpine
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --chmod=755 deploy/40-cb-api-base.sh /docker-entrypoint.d/40-cb-api-base.sh
COPY --chown=101:101 public/ /usr/share/nginx/html/
COPY --chown=101:101 index.html /usr/share/nginx/html/index.html
# the site folder itself belongs to nginx too, so the start script can rewrite a page in place (sed -i makes its temp file here)
USER root
RUN chown 101:101 /usr/share/nginx/html
USER 101
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --retries=3 CMD wget -qO- http://127.0.0.1:8080/healthz >/dev/null || exit 1
