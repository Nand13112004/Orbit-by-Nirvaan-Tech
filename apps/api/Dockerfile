FROM node:22-bookworm-slim AS build

WORKDIR /workspace
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@10.34.9 --activate

# Prisma Client generation reads this URL but does not connect to it during builds.
ARG MONGODB_URI=mongodb://127.0.0.1:27017/build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/api/prisma/schema.prisma apps/api/prisma/schema.prisma
RUN pnpm install --frozen-lockfile --filter @nirvaan/api...

COPY apps/api apps/api
RUN pnpm --filter @nirvaan/api db:generate \
  && pnpm --filter @nirvaan/api build \
  && pnpm --filter @nirvaan/api deploy --legacy --prod /out/api \
  && pnpm --dir /out/api rebuild \
  && pnpm --filter @nirvaan/api exec prisma generate --schema /out/api/prisma/schema.prisma

FROM node:22-bookworm-slim AS runner

ENV NODE_ENV=production
ENV PORT=4000
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY --from=build --chown=node:node /out/api/ ./

USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 4000) + '/api/health').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "dist/src/main.js"]
