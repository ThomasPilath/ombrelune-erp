FROM oven/bun:1.3.11-alpine AS builder
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY index.html tsconfig.json vite.config.ts ./
COPY public ./public
COPY src ./src
RUN bun run build

FROM nginx:1.29-alpine
LABEL org.opencontainers.image.title="Ombrelune ERP"
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY docker/config.js.template /etc/ombrelune/config.js.template
COPY docker/40-runtime-config.sh /docker-entrypoint.d/40-runtime-config.sh
RUN chmod +x /docker-entrypoint.d/40-runtime-config.sh
COPY --from=builder /app/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 CMD wget -qO- http://127.0.0.1/health || exit 1
