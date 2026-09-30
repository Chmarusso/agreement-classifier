# Build context: repository root.
FROM oven/bun:1.2.19-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json bun.lock ./
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY apps/web/package.json apps/web/
COPY apps/claude-bridge/package.json apps/claude-bridge/
COPY packages/domain/package.json packages/domain/
COPY packages/db/package.json packages/db/
COPY packages/contracts/package.json packages/contracts/
COPY packages/test-utils/package.json packages/test-utils/
COPY packages/llm/package.json packages/llm/
COPY packages/extraction/package.json packages/extraction/
COPY evals/package.json evals/
COPY seeds/package.json seeds/
RUN bun install --frozen-lockfile --production --ignore-scripts
COPY tsconfig.base.json ./
COPY packages packages
COPY seeds seeds
COPY apps/worker apps/worker
RUN mkdir -p /data/uploads && chown -R bun:bun /data
USER bun
CMD ["bun", "apps/worker/src/index.ts"]
