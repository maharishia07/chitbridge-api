# ChitBridge api — one image for any host (HX0, docs/HOSTING.md is the configuration contract).
#   docker build -t chitbridge-api .                    the api (default target)
#   docker build --target migrate -t chitbridge-migrate .   the one-shot schema job deploy/compose.yml runs (tools/migrate.cjs, HX1 ledger)
# No secret is baked in: every key arrives as an environment variable at run time. Runs as the image's `node` user; the code
# is owned by root and only read (the api writes no file at run time — uploads go to the database or the object store).
FROM node:22-alpine AS base
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY . .

# the migrate job: the repo's own schema path with its ledger (tools/migrate.cjs → schema_migrations) — needs psql, the api image does not
FROM base AS migrate
RUN apk add --no-cache postgresql16-client
USER node
# this job starts no api; it runs each pending migrations/ file once and records it (an existing database with an empty ledger: nothing)
ENTRYPOINT ["sh", "-c", "exec node tools/migrate.cjs --db \"$DATABASE_URL\""]

FROM base AS api
ENV NODE_ENV=production PORT=3000
USER node
EXPOSE 3000
# /health answers 200 while the process serves (its `db` field says how the database is — it does not take the api out of rotation)
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "server.js"]
