# service-undeadgrid

Servidor autoritativo de salas **1 vs 1** para Undead Grid, construido con
**NestJS + TypeScript + Socket.IO**. Gestiona creación/unión de salas por código,
selección de personaje, la máquina de estados de la partida y la limpieza de
salas. Es el *backend* del frontend `undeadgrid-web-app`.

## Alcance

El servidor es autoritativo sobre:

- **Salas y asientos:** crear/unir por código, capacidad 1v1, slots (1 = base
  azul, 2 = base roja), sesiones y reconexión.
- **Selección:** elección y confirmación de superviviente.
- **Máquina de estados:** `lobby → selection → preparation → combat → results`.
  **Solo el servidor** cambia de fase.
- **Reloj de combate:** fases por tiempo (`prep/wave1/wave2/horde`) y fin por
  tiempo o por destrucción de núcleo.
- **Ciclo de vida:** desconexión, reconexión, abandono y limpieza de salas
  vacías/huérfanas.

La **simulación de combate** (movimiento, zombis, balas, construcción) sigue
viviendo en el cliente (`undeadgrid-web-app/src/game/engine.ts`). El mapa se
genera de forma determinista a partir de una **semilla** (`seed`) que el servidor
asigna a la sala y el cliente expande con `mapgen.ts`. El daño al núcleo se
reporta al servidor, que lo aplica de forma autoritativa.

> No hay base de datos ni autenticación: el juego es efímero y el estado vive en
> memoria. No se añaden por no existir una necesidad actual.

## Requisitos

- Node.js ≥ 18 (probado con v24).

## Puesta en marcha

```bash
npm install
cp .env.example .env     # ajusta CORS_ORIGINS si hace falta
npm run start:dev        # desarrollo con recarga
# o
npm run build && npm run start:prod
```

Por defecto escucha en `http://localhost:3000`. El dev server de Vite del
frontend hace proxy de `/api`, `/health` y `/socket.io` a este puerto.

## Variables de entorno

| Variable       | Por defecto           | Descripción                                             |
|----------------|-----------------------|---------------------------------------------------------|
| `PORT`         | `3000`                | Puerto HTTP/WebSocket.                                   |
| `CORS_ORIGINS` | *(vacío = mismo origen)* | Orígenes permitidos, separados por comas.            |
| `LOG_LEVELS`   | `log,error,warn`      | Niveles de log de Nest.                                 |

## Scripts

| Script              | Descripción                          |
|---------------------|--------------------------------------|
| `npm run build`     | Compila a `dist/`.                   |
| `npm run start:dev` | Arranca en modo watch.               |
| `npm run start:prod`| Ejecuta el build (`node dist/main.js`). |
| `npm test`          | Tests (Jest).                        |
| `npm run lint`      | Lint (ESLint).                       |

## Endpoints y eventos

- **HTTP:** `GET /health` → `{ status, uptime, rooms, at }`.
- **Socket.IO:** ver el contrato completo en [`EVENTS.md`](./EVENTS.md).

## Estructura

```
src/
  main.ts                      Bootstrap (CORS, puerto, logs)
  app.module.ts                Módulo raíz
  config/
    game.config.ts             Config PROVISIONAL centralizada (espeja el frontend)
  contracts/                   Contratos tipados (fuente de verdad)
    common.ts                  Estados, errores, Ack<T>
    snapshots.ts               RoomSnapshot, PlayerSnapshot, CombatSnapshot...
    payloads.ts                Esquemas Zod de validación de entrada
    events.ts                  Mapas de eventos Socket.IO cliente↔servidor
  domain/
    player.ts                  Entidad Player
    room.ts                    Entidad Room + máquina de estados + reloj
  room/
    room.service.ts            Lógica de negocio autoritativa
    room.gateway.ts            Gateway Socket.IO (validación, acks, rate limit)
    phase-orchestrator.service.ts  Timers 1 Hz: avance de fases y barrido
    room.module.ts
    room.service.spec.ts       Test de humo del flujo 1v1
  common/
    domain-error.ts            Error de dominio → ApiError
    ids.ts                     Códigos de sala, sessionId, seed
    rate-limiter.service.ts    Rate limiting por (socket, evento)
  health/
    health.controller.ts       GET /health
```

## Diseño

- **Autoritativo:** el cliente propone, el servidor dispone. Toda transición de
  estado y todo cambio de núcleo pasa por `RoomService`.
- **Contratos tipados de punta a punta:** los tipos de `contracts/` describen
  exactamente lo que viaja por el socket; Zod los valida en runtime.
- **Acks uniformes:** todo handler responde `Ack<T>`; los errores nunca filtran
  stack traces (se normalizan a `ApiError` con un código estable).
- **Sin estado compartido externo:** todo en memoria y en un solo nodo. Para
  escalar a varios nodos habría que mover salas y rate limiting a un store
  compartido (p. ej. Redis + adaptador de Socket.IO).

## Valores provisionales

Todos los números de balance/flujo (fases, duración, vida de núcleo, límites,
TTLs, rate limits) están **centralizados y comentados** en
`src/config/game.config.ts`, espejando `undeadgrid-web-app/src/game/constants.ts`
y `.../Lobby/data/catalog.ts`. No se inventan reglas de balance aquí: cuando el
equipo las defina, se actualizan en ambos lados.

## Pendiente / próximos pasos

- Reemplazar en el frontend el mock `useLobbyRoom` por un cliente Socket.IO real
  que consuma estos eventos (los contratos ya están alineados con ese hook).
- Simulación de combate del lado servidor si se quiere anti-cheat completo
  (hoy el núcleo es autoritativo pero el resto del combate es cliente).
- Store compartido (Redis) y adaptador de Socket.IO para escalado multi-nodo.
- Persistencia opcional de estadísticas (requiere introducir una base de datos).
