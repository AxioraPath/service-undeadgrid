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

- **Simulación de combate (src/game):** el servidor corre la partida completa a
  30 ticks/s: movimiento con colisiones, disparos, zombis y oleadas, construcción,
  trampas, caja de suministros, recompensas, reaparición y victoria. El mapa se
  genera con la semilla de la sala. El cliente solo manda `game:input` /
  `game:command` y dibuja lo que llega en `game:state`; editar valores en el
  navegador no cambia nada en la partida.

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
  game/                        Reglas y simulación de la partida (TS puro, sin Nest)
    constants.ts               Valores de la sección 5 (vidas, daños, costos, fases)
    formulas.ts                Escalado por oleada, daño, curación, interpolación
    mapgen.ts                  Mapa 32×24 por semilla + validación BFS
    engine.ts                  Tick de la partida (inputs → mundo → victoria)
    snapshot.ts                Mapa y estado que viajan al cliente
    game.spec.ts               Pruebas unitarias de las reglas
  room/
    room.service.ts            Lógica de negocio autoritativa
    room.gateway.ts            Gateway Socket.IO (validación, acks, rate limit)
    phase-orchestrator.service.ts  Bucle de 30 ticks/s (game:state), reloj 1 Hz y barrido
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

- Store compartido (Redis) y adaptador de Socket.IO para escalado multi-nodo.
- Persistencia opcional de estadísticas (requiere introducir una base de datos).
