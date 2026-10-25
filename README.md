<div align="center">

# 🧟 UndeadGrid · Backend

**CyberGrid: Breach & Sync** — servidor autoritativo de partidas 1v1 y 2v2 en tiempo real.

![NestJS](https://img.shields.io/badge/NestJS-10-e0234e?logo=nestjs&logoColor=white)
![Socket.IO](https://img.shields.io/badge/Socket.IO-4-010101?logo=socketdotio&logoColor=white)
![Prisma](https://img.shields.io/badge/Prisma-5-2d3748?logo=prisma&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-4169e1?logo=postgresql&logoColor=white)
![Jest](https://img.shields.io/badge/tests-138%20Jest-c21325?logo=jest&logoColor=white)

[Juego en vivo](https://undeadgrid.axiorapath.com.mx) · [API](https://api.undeadgrid.axiorapath.com.mx/health) · [Contrato de eventos](./EVENTS.md) · [Frontend](https://github.com/AxioraPath/undeadgrid-web-app)

</div>

---

## ¿Qué es?

Juego web multijugador de supervivencia: construye tu base, resiste oleadas de zombis y destruye el núcleo rival.
Este servicio es la **única fuente de verdad**: el cliente solo envía entradas (`game:input`, `game:command`) y dibuja lo
que recibe en `game:state`. Modificar valores en el navegador no cambia nada en la partida.

## Características

- **Simulación server-authoritative** a 30 ticks/s: movimiento con colisiones, disparos, zombis, oleadas, construcción,
  trampas, torretas, armas pesadas, caja de suministros y reaparición.
- **Modos 1v1 y 2v2.** En 2v2 cada equipo comparte base y núcleo, sin fuego amigo.
- **Salas por código** con máquina de estados `lobby → selection → preparation → combat → results`, reconexión,
  revancha y volver al lobby.
- **Cuentas y progresión:** registro/login con JWT + cookie de refresco, XP, niveles y misiones diarias/permanentes.
- **Historial y estadísticas** de partidas en PostgreSQL.
- **Validación con Zod** en cada evento, *acks* tipados y *rate limiting* por socket.
- **Endpoints de auditoría** para el curso: telemetría y generación de datos de prueba.

## Arquitectura

```
Cliente (React + Canvas)  ──Socket.IO──►  RoomGateway ──► RoomService ──► GameEngine (30 Hz)
        ▲                                      │                              │
        └────────── game:state ◄───────────────┘                              ▼
                                                                    MatchStatsService ──► PostgreSQL (Prisma)
```

| Carpeta | Contenido |
|---|---|
| `src/game` | Motor de simulación, generador de mapas, snapshots |
| `src/room` | Gateway Socket.IO, salas, orquestador de fases |
| `src/contracts` | Esquemas Zod y tipos compartidos con el cliente |
| `src/auth`, `src/users` | Registro, login, sesión |
| `src/progression`, `src/stats` | XP, misiones, historial |
| `src/testing` | `GET /api/test/telemetry`, `POST /api/test/seed` |
| `prisma/` | Esquema y migraciones |

## Puesta en marcha

Requisitos: **Node.js 22**, **PostgreSQL 14+**.

```bash
npm ci
cp .env.example .env        # completa DATABASE_URL y los secretos JWT
npx prisma migrate deploy
npm run start:dev           # http://localhost:3000
```

### Variables de entorno

| Variable | Descripción |
|---|---|
| `DATABASE_URL` | Cadena de conexión de PostgreSQL |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | Secretos de sesión. **Obligatorios en producción** |
| `CORS_ORIGINS` | Orígenes permitidos, separados por coma |
| `APP_WEB_URL` | URL pública del frontend |
| `ENABLE_TEST_ENDPOINTS` | `true` habilita `/api/test/*` aun en producción |
| `PORT`, `LOG_LEVELS` | Puerto y niveles de log |

## Pruebas

```bash
npm test        # 138 pruebas en 9 suites
npm run build
```

Cubren generación de mapas, motor (daño, escalado, colisiones, fuego amigo), salas 1v1/2v2, validación Zod,
progresión y endpoints de prueba.

## Endpoints

| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/health` | Estado del servicio |
| `GET` | `/api/test/telemetry` | Win rate, KDR y supervivencia agregados |
| `POST` | `/api/test/seed` | Inserta de 100 a 1000 partidas sintéticas `{ "matches": 100 }` |
| `DELETE` | `/api/test/seed` | Borra las partidas sintéticas |
| `POST` | `/api/auth/register` · `/login` · `/refresh` · `/logout` | Sesión |
| `GET` | `/api/me` · `/api/me/missions` | Perfil, XP y misiones |

El protocolo de Socket.IO completo está en [`EVENTS.md`](./EVENTS.md).

## CI/CD

- **CI:** [`.github/workflows/ci.yml`](.github/workflows/ci.yml) corre `prisma generate`, `build` y `test` en cada PR y push a `main`.
- **Despliegue:** Docker en un VPS con [Dokploy](https://dokploy.com), con HTTPS de Let's Encrypt. Cada push a `main` despliega
  automáticamente y `docker-entrypoint.sh` aplica las migraciones al arrancar.

## Equipo

Josseph Peralta · Sylvanna Cisneros · Angel Anaya
