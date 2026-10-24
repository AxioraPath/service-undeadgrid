# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Undead Grid: imagen única que sirve el frontend (Vite) y el backend (NestJS +
# Socket.IO) bajo el MISMO dominio. Así el WebSocket va al mismo origen, sin
# CORS ni saltos extra (óptimo para el ping).
# ---------------------------------------------------------------------------

# 1) Build del FRONTEND. Se clona el repo del front en tiempo de build.
#    FRONTEND_REF permite fijar una rama/commit; por defecto main.
#    GIT_TOKEN (build arg) permite clonar repos privados sin dejar credenciales
#    en la imagen final (esta etapa se descarta; solo se copia /front/dist).
FROM node:22-alpine AS frontend
ARG FRONTEND_REF=main
ARG GIT_TOKEN=""
RUN apk add --no-cache git
WORKDIR /front
RUN if [ -n "$GIT_TOKEN" ]; then \
      git clone --depth 1 --branch "${FRONTEND_REF}" \
        "https://x-access-token:${GIT_TOKEN}@github.com/AxioraPath/undeadgrid-web-app.git" . ; \
    else \
      git clone --depth 1 --branch "${FRONTEND_REF}" \
        "https://github.com/AxioraPath/undeadgrid-web-app.git" . ; \
    fi
RUN npm ci
# Mismo dominio: el front habla con el back por rutas relativas (/socket.io, /api).
ENV VITE_API_URL=""
RUN npm run build

# 2) Build del BACKEND (este repo).
FROM node:22-alpine AS backend
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig*.json nest-cli.json ./
COPY src ./src
RUN npm run build
# Dependencias solo de producción para la imagen final.
RUN npm prune --omit=dev

# 3) Imagen final mínima.
FROM node:22-alpine AS runtime
ENV NODE_ENV=production
ENV PORT=3000
WORKDIR /app
COPY --from=backend /app/node_modules ./node_modules
COPY --from=backend /app/dist ./dist
COPY --from=backend /app/package.json ./package.json
# El build del front se sirve desde <raíz>/public (ver app.module.ts).
COPY --from=frontend /front/dist ./public
EXPOSE 3000
CMD ["node", "dist/main.js"]
