# Undead Grid — Contrato de eventos (Socket.IO)

Este documento es el contrato entre el cliente (`undeadgrid-web-app`) y el
servidor autoritativo (`service-undeadgrid`). Todos los tipos viven en
`src/contracts/` y son la fuente de verdad; este archivo es su descripción legible.

- **Transporte:** Socket.IO sobre `/socket.io` (el dev server de Vite hace proxy a `:3000`).
- **Salud HTTP:** `GET /health` → `{ status, uptime, rooms, at }`.
- **Acks:** todo evento cliente→servidor responde con un *acknowledgement* tipado:
  ```ts
  type Ack<T> = { ok: true; data: T } | { ok: false; error: ApiError }
  ```
- **Validación:** cada payload se valida con Zod en el servidor. Un payload
  inválido devuelve `{ ok: false, error: { code: 'VALIDATION', ... } }`.
- **Pertenencia:** salvo `lobby:create`/`lobby:join`, todos los eventos exigen que
  el socket pertenezca a una sala (si no, `NOT_IN_ROOM`).
- **Rate limiting:** por `(socket, evento)` con ventana fija (ver `RATE_LIMITS`).
  Al excederlo: `{ ok: false, error: { code: 'RATE_LIMITED' } }`.

---

## Máquina de estados de la sala

```
lobby ──► selection ──► preparation ──► combat ──► results
  │           │                            
  └───────────┴──────────────────────────────────► results (abandono/limpieza)
```

| Estado        | Qué ocurre                                                            |
|---------------|-----------------------------------------------------------------------|
| `lobby`       | Entran jugadores, el host elige mapa/dificultad, todos marcan "listo". |
| `selection`   | Cada jugador elige y **confirma** su superviviente.                   |
| `preparation` | Ambos confirmaron; cuenta atrás previa al combate (3 s por defecto).  |
| `combat`      | Reloj autoritativo con fases `prep → wave1 → wave2 → horde`.           |
| `results`     | Partida terminada (núcleo destruido, tiempo agotado o abandono).       |

El servidor es el **único** que cambia de estado. El cliente nunca fuerza una fase.

---

## Códigos de error (`ApiError.code`)

| Código             | Significado                                               |
|--------------------|-----------------------------------------------------------|
| `VALIDATION`       | El payload no pasó la validación de esquema.              |
| `ROOM_NOT_FOUND`   | No existe una sala con ese código.                        |
| `ROOM_FULL`        | La sala ya tiene 2 jugadores.                             |
| `ROOM_CLOSED`      | La sala fue cerrada por el servidor.                      |
| `NAME_INVALID`     | Nombre vacío o inválido.                                  |
| `CODE_INVALID`     | Código con formato incorrecto.                            |
| `NOT_IN_ROOM`      | El socket no pertenece a ninguna sala.                    |
| `NOT_HOST`         | La acción requiere ser host.                              |
| `NOT_ALLOWED`      | Acción no permitida (p. ej. dañar tu propio núcleo).      |
| `BAD_STATE`        | La acción no es válida en el estado actual de la sala.    |
| `SURVIVOR_INVALID` | Superviviente desconocido o bloqueado.                    |
| `RATE_LIMITED`     | Demasiadas solicitudes.                                   |
| `ALREADY_IN_ROOM`  | Esa sesión ya está conectada.                             |
| `INTERNAL`         | Error interno inesperado.                                 |

---

## Eventos CLIENTE → SERVIDOR

> Firma general: `socket.emit('evento', payload, (ack) => { ... })`.
> Los eventos sin payload no llevan el argumento `payload`.

### `lobby:create`
Crea una sala y entra como **host** en el slot 1 (base azul).

- **Payload:** `{ name: string; survivor?: string }`
- **Ack:** `Ack<JoinedData>` → `{ sessionId, slot, isHost, room }`

Guarda `sessionId` en el cliente: permite **reconectar** al mismo asiento.

### `lobby:join`
Se une a una sala por código, o **reconecta** si se envía un `sessionId` válido
de un asiento desconectado.

- **Payload:** `{ code: string; name: string; survivor?: string; sessionId?: string }`
- **Ack:** `Ack<JoinedData>`
- **Errores:** `ROOM_NOT_FOUND`, `ROOM_FULL`, `BAD_STATE` (partida ya iniciada), `ALREADY_IN_ROOM`.
- **Push asociado:** `lobby:playerJoined` (o `lobby:playerReconnected`) + `lobby:state` al resto.

### `lobby:leave`
Abandona la sala. Si la partida está en curso, el rival gana por abandono.

- **Payload:** *(ninguno)*
- **Ack:** `Ack<void>`
- **Push asociado:** `lobby:playerLeft` + `lobby:state` (y `match:over` si procede).

### `lobby:rename`
Cambia el nombre (se recorta a 16 caracteres).

- **Payload:** `{ name: string }` · **Ack:** `Ack<RoomSnapshot>` · **Push:** `lobby:state`

### `lobby:ready`
Marca/desmarca "listo". Válido en `lobby` y `selection`.

- **Payload:** `{ ready: boolean }` · **Ack:** `Ack<RoomSnapshot>` · **Push:** `lobby:state`

### `lobby:selectSurvivor`
Elige superviviente (invalida la confirmación previa).

- **Payload:** `{ survivor: string }` · **Ack:** `Ack<RoomSnapshot>` · **Push:** `lobby:state`

### `lobby:confirmSurvivor`
Confirma el superviviente elegido. Cuando **ambos** confirman, el servidor pasa
a `preparation` y programa el inicio del combate.

- **Payload:** *(ninguno)* · **Ack:** `Ack<RoomSnapshot>` · **Push:** `lobby:state`
- **Errores:** `BAD_STATE` si no está en `selection`.

### `lobby:setMap` / `lobby:setDifficulty`
Solo el **host** y solo en `lobby`.

- **Payload:** `{ mapId: string }` / `{ difficulty: string }`
- **Ack:** `Ack<RoomSnapshot>` · **Push:** `lobby:state`
- **Errores:** `NOT_HOST`, `BAD_STATE`.

### `lobby:start`
El **host** inicia la partida. Requiere sala llena (2), ambos conectados y listos.
Transiciona `lobby → selection`.

- **Payload:** *(ninguno)* · **Ack:** `Ack<RoomSnapshot>` · **Push:** `lobby:state`
- **Errores:** `NOT_HOST`, `BAD_STATE`.

### `chat:send`
Envía un mensaje de chat (se recorta a 120 caracteres).

- **Payload:** `{ text: string }` · **Ack:** `Ack<ChatMessageSnapshot>`
- **Push asociado:** `chat:message` a toda la sala.

### `combat:coreDamage`
Reporta daño al núcleo rival durante el combate (autoritativo-lite: el servidor
aplica el daño, valida fase y objetivo, y resuelve la victoria).

- **Payload:** `{ target: 1 | 2; amount: number }`
- **Ack:** `Ack<CombatSnapshot>`
- **Errores:** `BAD_STATE` (sin combate / fase de preparación), `NOT_ALLOWED` (tu propio núcleo).
- **Push asociado:** `combat:tick`, o `match:over` si el núcleo llega a 0.

### `ping`
Medición de latencia una vez conectado el socket.

- **Payload:** `{ t?: number }` *(opcional)* · **Ack:** `Ack<{ t: number }>`

---

## Eventos SERVIDOR → CLIENTE (push, sin ack)

| Evento                     | Payload                                             | Cuándo                                   |
|----------------------------|-----------------------------------------------------|------------------------------------------|
| `lobby:state`              | `RoomSnapshot`                                      | Ante cualquier cambio relevante de sala. |
| `lobby:playerJoined`       | `{ slot, name }`                                    | Entra un jugador nuevo.                  |
| `lobby:playerLeft`         | `{ slot, name, reason: 'left' \| 'disconnected' }`  | Un jugador sale o se desconecta.         |
| `lobby:playerReconnected`  | `{ slot, name }`                                    | Un jugador reconecta en la ventana de gracia. |
| `lobby:closed`             | `{ reason }`                                        | El servidor cerró la sala.               |
| `chat:message`             | `ChatMessageSnapshot`                               | Nuevo mensaje de chat.                   |
| `combat:phase`             | `CombatSnapshot`                                    | Cambio de fase de combate.               |
| `combat:tick`              | `CombatSnapshot`                                    | Tick de reloj de combate (1 Hz).         |
| `match:over`               | `RoomSnapshot`                                      | Fin de la partida.                       |

---

## Snapshots

### `RoomSnapshot`
```ts
{
  code: string
  status: 'lobby' | 'selection' | 'preparation' | 'combat' | 'results'
  seed: number            // semilla del mapa; el cliente genera el mapa con mapgen.ts
  mapId: string
  difficulty: string
  hostSlot: 1 | 2
  players: PlayerSnapshot[]
  combat: CombatSnapshot | null   // presente solo en 'combat'
  result: MatchResult | null      // presente solo en 'results'
  version: number         // monotónica; usar para descartar snapshots viejos
  at: number              // epoch ms del servidor
}
```

### `PlayerSnapshot`
```ts
{ id: string; name: string; slot: 1 | 2; isHost: boolean;
  ready: boolean; survivor: string; survivorConfirmed: boolean; connected: boolean }
```
`id` es igual al `sessionId` (identidad pública estable dentro de la sala).

### `CombatSnapshot`
```ts
{ elapsed: number; phase: 'prep'|'wave1'|'wave2'|'horde'; wave: number; cores: { 1: number; 2: number } }
```

### `ChatMessageSnapshot`
```ts
{ id: number; slot: 1 | 2; author: string; text: string; at: number }
```

### `MatchResult`
```ts
{ winner: 1 | 2 | null; reason: 'core_destroyed'|'opponent_left'|'time_out'; cores: { 1:number; 2:number } }
```

---

## Reconexión y limpieza

- **Reconexión:** al desconectarse durante `preparation`/`combat`, el asiento se
  **reserva** `reconnectGraceMs` (30 s). El cliente reconecta con `lobby:join`
  pasando su `sessionId`.
- **Abandono en lobby/selección:** libera el asiento; si la sala queda vacía se
  elimina; si quedaba un jugador, se le reasigna el host.
- **Abandono en combate:** el rival gana (`reason: 'opponent_left'`).
- **Barrido periódico** (`sweepIntervalMs`, 15 s): expira asientos fuera de la
  ventana de gracia, elimina salas vacías (`emptyRoomTtlMs`) y salas huérfanas/
  antiguas (`lobbyMaxAgeMs`).

Todos estos valores están centralizados y documentados en `src/config/game.config.ts`.
