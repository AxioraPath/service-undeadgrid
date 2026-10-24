# syntax=docker/dockerfile:1
# ---------------------------------------------------------------------------
# Undead Grid — BACKEND (NestJS + Socket.IO + Prisma/PostgreSQL).
# App independiente en Dokploy. El frontend se despliega como su propia app.
# Las migraciones de Prisma se aplican al arrancar el contenedor.
# ---------------------------------------------------------------------------

FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY prisma ./prisma
COPY tsconfig*.json nest-cli.json ./
COPY src ./src
# build ya ejecuta `prisma generate` (ver package.json).
RUN npm run build
RUN npm prune --omit=dev

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
ENV PORT=3000
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./package.json
# Prisma: schema + migraciones + cliente generado (necesarios en runtime).
COPY --from=build /app/prisma ./prisma
COPY docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh
EXPOSE 3000
# El entrypoint aplica migraciones y luego arranca el servidor.
ENTRYPOINT ["./docker-entrypoint.sh"]
