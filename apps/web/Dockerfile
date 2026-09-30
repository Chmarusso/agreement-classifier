# Build context: repository root.
FROM oven/bun:1.2.19-slim AS build
WORKDIR /app
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
RUN bun install --frozen-lockfile --ignore-scripts
COPY tsconfig.base.json ./
COPY packages/contracts packages/contracts
COPY apps/web apps/web
RUN cd apps/web && bunx vite build

FROM nginx:1.29-alpine
COPY apps/web/docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 8080
