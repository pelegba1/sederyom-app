# Multi-stage build. Bundling with tsup keeps the runtime image free of the
# TypeScript toolchain; Prisma's generated client is the one thing kept external.
FROM node:22-alpine AS build
WORKDIR /repo

# Prisma's engines are linked against OpenSSL; without it on Alpine, `generate`
# picks the wrong binary target and `migrate deploy` dies on an unparseable
# engine response.
RUN apk add --no-cache openssl

COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
RUN npm ci

COPY shared/ shared/
COPY server/ server/
RUN npm run prisma:generate -w @sederyom/server \
 && npm run build -w @sederyom/server

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production TZ=Asia/Jerusalem

RUN apk add --no-cache tzdata openssl

# npm workspaces hoist everything to the repo root, so there is no
# server/node_modules to copy — the root tree carries @prisma/client and the
# generated .prisma client, and npx finds the prisma CLI by walking up from
# /app/server.
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/package.json ./package.json
COPY --from=build /repo/server/package.json ./server/package.json
COPY --from=build /repo/server/dist ./server/dist
COPY --from=build /repo/server/prisma ./server/prisma

WORKDIR /app/server
EXPOSE 3000
# Migrations run on boot so a `docker compose up -d --build` is the whole deploy.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]
