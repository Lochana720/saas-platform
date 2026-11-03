# ---- build ----
FROM node:22-bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# prisma generate needs a datasource URL in config, but never connects
RUN MIGRATION_DATABASE_URL=postgresql://build:build@localhost:5432/build npm run build

# ---- runtime ----
FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production
# Keep the Prisma CLI + tsx so the container can run migrations and the seed on start
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/src/generated ./src/generated
COPY package.json prisma.config.ts docker-entrypoint.sh ./
COPY prisma ./prisma
RUN chmod +x docker-entrypoint.sh && chown -R node:node /app
USER node
EXPOSE 4000
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s CMD node -e "fetch('http://localhost:4000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["./docker-entrypoint.sh"]
