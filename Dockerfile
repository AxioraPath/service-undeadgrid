# syntax=docker/dockerfile:1
# ---------------------------------------------------------------------------
# Undead Grid — BACKEND (NestJS + Socket.IO). App independiente en Dokploy.
# El frontend se despliega como su propia app (repo undeadgrid-web-app).
# Si existe una carpeta ./public con un build del front, también se sirve
# (ver app.module.ts), pero en producción el front vive en su propia app.
# ---------------------------------------------------------------------------

FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig*.json nest-cli.json ./
COPY src ./src
RUN npm run build
RUN npm prune --omit=dev

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
ENV PORT=3000
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./package.json
EXPOSE 3000
CMD ["node", "dist/main.js"]
