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

## Modos de juego: 1v1 y 2v2

Toda sala tiene `mode: '1v1' | '2v2'` (por defecto `'1v1'`) y `capacity` (2 o 4); ambos viajan en
`RoomSnapshot`. El **host** cambia el modo en el lobby con `lobby:setMode`.

- **Slots y equipos.** `Slot = 1|2|3|4`, `Team = 1|2`. Equipo 1 (azul) = slots **1 y 3**; equipo 2 (rojo) =
  slots **2 y 4**. En 1v1 solo existen los slots 1 y 2 y `team == slot` (todo lo que iba por slot 1/2 sigue igual).
  Cada `PlayerSnapshot` y cada `GamePlayerDto` trae `slot` **y** `team`. El slot se **deriva** de equipo + asiento:
  `slot = team + 2 * seat` (seat 0 o 1).
- **Una base, un núcleo y una caja por equipo.** Los dos compañeros comparten la base, el núcleo, la zona de
  construcción y el stock de la caja. Por eso todo lo que antes iba "por slot" y era del lado/base va ahora **por
  equipo** (claves `1|2`): `map.bases`, `map.cores`, `map.crates`, `game:state.cores`, `game:state.crates`,
  `CombatSnapshot.cores`, `MatchResult.cores`. En 1v1 son idénticos a lo de siempre.
- **Inventarios.** Siguen siendo **por jugador** (madera, metal, botiquines, cartuchos, arma pesada, torretas).
  Lo único compartido es el **stock de la caja** del equipo (`crates[team]`): lo que saca uno ya no está para el
  otro. La caja de armamento del centro la abre cada jugador por separado (progreso por slot).
- **Aparición.** Se reutilizan los mismos mapas. Cada equipo aparece dentro de su base junto al núcleo: el primer
  asiento (slot 1 / 2) en la casilla de siempre y el segundo (slot 3 / 4) en la casilla contigua dentro de la misma base.
- **Fuego amigo desactivado.** Las balas, cohetes, trampas y torretas de un equipo no dañan a sus compañeros ni a
  sus estructuras, y las paredes propias/del compañero no frenan las balas del equipo. Los zombis atacan a ambos equipos.
  Cada estructura conserva `owner` (slot que la construyó, para estadísticas) y pertenece al equipo `teamOf(owner)`.
- **Victoria.** Un equipo pierde cuando su núcleo compartido está destruido **y** ninguno de sus jugadores puede
  reaparecer (si el núcleo cae, los que mueren ya no reaparecen). Por tiempo (240 s): gana el núcleo con más vida;
  si empatan, el equipo con más `kills + zombieKills` sumados; si no, empate.
- **Abandono en 2v2.** Si se va un jugador y su compañero sigue en la sala, la partida **continúa** (su personaje
  queda inmóvil). Solo cuando se va **todo** su equipo gana el rival con `reason: 'opponent_left'`.

---

## Máquina de estados de la sala

```
lobby ──► selection ──► preparation ──► combat ──► results
  │           │                            
  └───────────┴──────────────────────────────────► results (abandono/limpieza)

results ──► preparation   (revancha: ambos piden `match:rematchRequest`)
results ──► lobby         (`lobby:backToLobby`)
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
| `ROOM_FULL`        | La sala está llena (2 en 1v1, 4 en 2v2). Un 5º jugador se rechaza con este código. |
| `TEAM_FULL`        | `room:setTeam` a un equipo que ya tiene 2 jugadores.      |
| `TOO_MANY_PLAYERS` | `lobby:setMode` a un modo con menos capacidad que los jugadores actuales (2v2 → 1v1 con más de 2). |
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
Crea una sala (modo `1v1`) y entra como **host** en el slot 1 (equipo 1, base azul).

- **Payload:** `{ name: string; survivor?: string }`
- **Ack:** `Ack<JoinedData>` → `{ sessionId, slot, isHost, room }`

Guarda `sessionId` en el cliente: permite **reconectar** al mismo asiento.

### `lobby:join`
Se une a una sala por código, o **reconecta** si se envía un `sessionId` válido
de un asiento desconectado.

- **Payload:** `{ code: string; name: string; survivor?: string; sessionId?: string }`
- **Ack:** `Ack<JoinedData>`
- **Errores:** `ROOM_NOT_FOUND`, `ROOM_FULL` (también el 5º jugador en 2v2), `BAD_STATE` (partida ya iniciada), `ALREADY_IN_ROOM`.
- **Slot asignado:** 1v1 → primer slot libre de 1, 2. 2v2 → entra al equipo con menos jugadores (empate → equipo 1)
  en su primer asiento libre; con 4 jugadores el orden de llegada da slots 1, 2, 3, 4 (equipos 1, 2, 1, 2).
  La reconexión con `sessionId` devuelve el mismo slot/equipo.
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

### `lobby:setMode` (nuevo)
Solo el **host** y solo en `lobby`. Cambia entre 1v1 y 2v2.

- **Payload:** `{ mode: '1v1' | '2v2' }` · **Ack:** `Ack<RoomSnapshot>` · **Push:** `lobby:state`
- **Errores:** `NOT_HOST`, `BAD_STATE` (fuera del lobby), `VALIDATION` (modo desconocido),
  `TOO_MANY_PLAYERS` (2v2 → 1v1 con más de 2 jugadores; el host debe esperar a que salgan).
- Mismo modo que el actual: no-op (devuelve el snapshot).
- **Efectos:** `capacity` pasa a 2 o 4 y se **limpian los `ready`** de todos. De 1v1 a 2v2 los jugadores conservan
  slot (1 y 2). De 2v2 a 1v1 (≤ 2 jugadores) se **reasientan en los slots 1 y 2** conservando el orden, y `hostSlot`
  se actualiza: el cliente debe **releer su propio `slot`/`team` del snapshot buscándose por `id`** (= `sessionId`).

### `room:setTeam` (nuevo)
Un jugador elige equipo. Solo en `lobby` y solo en modo `2v2`.

- **Payload:** `{ team: 1 | 2 }` · **Ack:** `Ack<RoomSnapshot>` · **Push:** `lobby:state`
- **Errores:** `BAD_STATE` (fuera del lobby o sala en 1v1), `TEAM_FULL` (el equipo ya tiene 2), `VALIDATION`.
- Pedir el equipo en el que ya estás es un no-op. Si cambias, tu **slot cambia** (equipo 1 → slot 1 o 3; equipo 2 →
  slot 2 o 4, el primer asiento libre) y, si eres host, `hostSlot` te sigue. Se conservan `ready` y superviviente.
  Relee tu slot del snapshot (por `id`).

### `lobby:setMap` / `lobby:setDifficulty`
Solo el **host** y solo en `lobby`.

- **Payload:** `{ mapId: string }` / `{ difficulty: string }`
- **Ack:** `Ack<RoomSnapshot>` · **Push:** `lobby:state`
- **Errores:** `NOT_HOST`, `BAD_STATE`.

### `lobby:start`
El **host** inicia la partida. Requiere sala llena (`capacity`: 2 en 1v1, **4 en 2v2 con 2 jugadores por equipo**),
todos conectados y listos (si no: `BAD_STATE` "Faltan jugadores para empezar" / "No todos los jugadores están listos").
El superviviente ya se eligió en el lobby (`lobby:selectSurvivor`), así que pasa
directo a `preparation` (lobby → selection → preparation en el mismo paso) y el combate
arranca tras la cuenta regresiva. Si alguien sale mientras la sala está en `selection`,
la sala vuelve a `lobby` y se quitan los "listo".

La dificultad escala los zombis: `Estándar` ×1; `Difícil` ×1.5 cantidad, ×1.3 vida,
×1.25 daño. Cada superviviente tiene una ventaja pequeña: Explorador camina 15 % más
rápido y empieza con +8 cartuchos; Mecánica empieza con +12 madera y +4 metal y repara
el doble.

- **Payload:** *(ninguno)* · **Ack:** `Ack<RoomSnapshot>` · **Push:** `lobby:state`
- **Errores:** `NOT_HOST`, `BAD_STATE`.

### `lobby:backToLobby`
Vuelve al lobby **para todos los jugadores** (2 o 4; conserva modo y equipos). Solo en `results`. Limpia la partida,
el resultado, los flags de listo/confirmación y las peticiones de revancha;
conserva mapa, dificultad y jugadores. Salir de la sala por completo sigue siendo `lobby:leave`.

- **Payload:** *(ninguno)* · **Ack:** `Ack<RoomSnapshot>`
- **Push:** `match:rematchState { requested: [] }` + `lobby:state`
- **Errores:** `BAD_STATE` (fuera de `results`).

### `match:rematchRequest`
Pide revancha. Solo en `results` y con la sala completa y conectada (2 en 1v1, 4 en 2v2). Cuando **todos**
(2 o 4) la piden, la sala pasa a `preparation` con el mismo mapa, dificultad y supervivientes
(confirmados), **semilla nueva**, y tras 3 s arranca el combate por el camino normal
(`combat:phase`, `game:state`...). La partida anterior ya fue persistida: no se cuenta dos veces.

- **Payload:** *(ninguno)* · **Ack:** `Ack<void>`
- **Push:** `match:rematchState` siempre; si ambos pidieron: `match:rematchState { requested: [] }` + `lobby:state` (status `preparation`). `requested` contiene slots (1-4).
- **Errores:** `BAD_STATE` (fuera de `results`, o "Tu rival ya no está en la sala").

### `match:rematchCancel`
Retira la petición de revancha del que llama. Solo en `results`.

- **Payload:** *(ninguno)* · **Ack:** `Ack<void>` · **Push:** `match:rematchState`
- **Errores:** `BAD_STATE`.

### `chat:send`
Envía un mensaje de chat (se recorta a 120 caracteres).

- **Payload:** `{ text: string }` · **Ack:** `Ack<ChatMessageSnapshot>`
- **Push asociado:** `chat:message` a toda la sala.

### `game:input`
Estado de los controles del jugador durante el combate. El servidor guarda el
**último** recibido y lo aplica en cada tick (30/s). El cliente lo manda al
cambiar y como latido (~15/s). Un toque de acción entre dos ticks no se pierde.

- **Payload:** `{ seq: number; up: boolean; down: boolean; left: boolean; right: boolean; action: boolean; aim?: { x: number; y: number } }`
- **`aim`** (optional): direction vector from the player to the mouse in world space (any length;
  the server normalizes). Invalid values (non-finite, ~zero magnitude <= 1e-3) are ignored as if absent;
  components are clamped to +-1000. While a valid aim is present, shots (pistol and shotgun, pellets
  centered on it) are fired along it, and `dirX/dirY` follow it quantized to 8 directions (movement keys
  no longer change facing; wall orientation / build target follow the mouse). Send `aim` on every input
  while aiming; omit it to return to movement-based facing. The snapshot player gets optional
  `aimX/aimY` (unit vector, only present while aiming) for smooth sprite rendering.
- **Ack:** opcional, `Ack<void>` · **Errores:** `BAD_STATE` (sin combate), `VALIDATION`.

### `game:command`
Acciones discretas.

- **Payload:**
  - `{ type: 'hotbar'; slot: 1..7 }`: 1 pistola, 2 escopeta, 3 botiquín, 4 pared, 5 trampa,
    6 metralleta (si tienes balas), 7 torreta (si tienes una).
  - `{ type: 'crateTake'; item: 'wood'|'metal'|'medkits'|'shells' }` (solo parado sobre **tu** caja).
  - `{ type: 'build'; x; y }`: construir en esa casilla (clic derecho / tocar la casilla). Debe estar
    en tu base y a ≤ 4.5 casillas de ti; repara, refuerza o coloca lo seleccionado (pared, trampa o torreta).
- **Ack:** opcional, `Ack<void>`.

`game:input` acepta además `fire?: boolean`: dispara siempre (clic izquierdo / stick de apuntar),
también dentro de tu base. `action` (Espacio) sigue siendo contextual: en tu base construye enfrente.

**Caja de armamento** (centro del mapa, `map.armory`): se rellena al empezar cada oleada; quien se
queda 5 s junto a ella sin recibir daño obtiene metralleta (120 balas), 1 torreta y 1 botiquín.
`game:state.armory` trae `{ available, openedBy, progress }` y eventos `armoryReady` / `armoryOpened`.

**Torretas** (`structures` tipo 3 y `game:state.turrets`): 120 de vida, alcance 6, 1 disparo cada 0.9 s,
cargador de 8 y 4 s de recarga. Disparan al zombi (o rival, en combate) más cercano.

### `game:sync`
Mapa completo + estado actual. Se pide al entrar a la pantalla de partida o al
recargar (válido en `combat` y `results`).

- **Payload:** *(ninguno)* · **Ack:** `Ack<GameSyncData>` → `{ map: GameMapDto, state: GameStateDto }`

### `ping`
Medición de latencia una vez conectado el socket.

- **Payload:** `{ t?: number }` *(opcional)* · **Ack:** `Ack<{ t: number }>`

---

## Eventos SERVIDOR → CLIENTE (push, sin ack)

| Evento                     | Payload                                             | Cuándo                                   |
|----------------------------|-----------------------------------------------------|------------------------------------------|
| `lobby:state`              | `RoomSnapshot`                                      | Ante cualquier cambio relevante de sala. |
| `lobby:playerJoined`       | `{ slot, name }`                                    | Entra un jugador nuevo (`slot` 1-4).     |
| `lobby:playerLeft`         | `{ slot, name, reason: 'left' \| 'disconnected' }`  | Un jugador sale o se desconecta.         |
| `lobby:playerReconnected`  | `{ slot, name }`                                    | Un jugador reconecta en la ventana de gracia. |
| `lobby:closed`             | `{ reason }`                                        | El servidor cerró la sala.               |
| `chat:message`             | `ChatMessageSnapshot`                               | Nuevo mensaje de chat.                   |
| `combat:phase`             | `CombatSnapshot`                                    | Cambio de fase de combate.               |
| `combat:tick`              | `CombatSnapshot`                                    | Tick de reloj de combate (1 Hz).         |
| `match:over`               | `MatchOverPayload` (ver abajo)                      | Fin de la partida.                       |
| `match:rematchState`       | `{ requested: number[] }`                           | Cambió el conjunto de slots que piden revancha (también `[]` al limpiarse: rival se va, revancha iniciada, volver al lobby). |
| `game:state`               | `GameStateDto`                                      | Estado de la simulación, 30 veces por segundo en combate. |

---

## Snapshots

### `RoomSnapshot`
```ts
{
  code: string
  status: 'lobby' | 'selection' | 'preparation' | 'combat' | 'results'
  seed: number            // semilla del mapa (el servidor lo genera; el cliente lo recibe en game:sync)
  mapId: string
  difficulty: string
  mode: '1v1' | '2v2'     // NUEVO (por defecto '1v1')
  capacity: number        // NUEVO: 2 (1v1) o 4 (2v2)
  hostSlot: 1 | 2 | 3 | 4
  players: PlayerSnapshot[]   // ordenados por slot
  combat: CombatSnapshot | null   // presente solo en 'combat'
  result: MatchResult | null      // presente solo en 'results'
  version: number         // monotónica; usar para descartar snapshots viejos
  at: number              // epoch ms del servidor
}
```

### `PlayerSnapshot`
```ts
{ id: string; name: string; slot: 1 | 2 | 3 | 4; team: 1 | 2; isHost: boolean;   // team NUEVO
  ready: boolean; survivor: string; survivorConfirmed: boolean; connected: boolean }
```
`id` es igual al `sessionId` (identidad pública estable dentro de la sala).

### `CombatSnapshot`
```ts
{ elapsed: number; phase: 'prep'|'wave1'|'wave2'|'horde'; wave: number; cores: { 1: number; 2: number } }
```
`cores` está indexado por **equipo** (en 1v1 equipo == slot, así que no cambia nada). En 2v2 hay un núcleo
compartido por equipo: `cores[1]` es el del equipo 1 (slots 1 y 3) y `cores[2]` el del equipo 2 (slots 2 y 4).

### `GameStateDto` (ver `src/contracts/game.ts`)
```ts
{ tick, time, phase: { id, label, start, end, wave }, maxWave,
  players: GamePlayerDto[],          // + slot (1-4) y team (1|2); posición, vida, arma, inventario, kills, buildHint…
  zombies: [id, x, y, hp, maxHp, kind, attackAt, hurtAt][],   // kind 0 normal · 1 rápido · 2 tanque
  bullets: [id, x, y, vx, vy][],
  structures: [casilla, tipo, hp, maxHp, dueño, orient][],    // tipo 0 madera · 1 reforzada · 2 trampa · 3 torreta
                                                              // dueño = SLOT (1-4); su equipo es teamOf(slot)
  cores: { 1, 2 }, crates: { 1: Stock, 2: Stock },             // indexados por EQUIPO
  events: GameEventDto[],            // disparos, golpes, muertes… (efectos visuales)
  result: { winner: 0|1|2, reason, durationS, byTime } | null }   // winner = EQUIPO (1v1: = slot); 0 = empate
```
`game:sync` → `map.bases`, `map.cores`, `map.crates` también van por **equipo** (`{1, 2}`); no hay claves 3/4.
Para pintar a un jugador usa `player.team` (color de base) y `player.slot` (identidad). `armory.openedBy` y
`armory.progress` van por **slot** (1-4). Evento `coreHit`: `{ type, slot, team }` — `slot` es el nombre antiguo y
vale lo mismo que `team` (el equipo cuyo núcleo recibió el golpe). Eventos `shot`/`knife`/`playerDied`/`rejected`
siguen llevando el **slot** del jugador (1-4).
Las posiciones están en casillas (1 casilla = 32 px lógicos). El cliente interpola
entre los dos últimos estados y nunca decide posición, vida, daño ni inventario.

### `ChatMessageSnapshot`
```ts
{ id: number; slot: 1 | 2 | 3 | 4; author: string; text: string; at: number }
```

### `match:over` payload
`RoomSnapshot & MatchOverPayload`:
```ts
{
  ...RoomSnapshot,        // result, mapId, code, players (con survivor)...
  xp?: { [slot]: number },          // por slot: 1-2 en 1v1, 1-4 en 2v2
  stats: { [slot: number]: {        // por slot: 1-2 en 1v1, 1-4 en 2v2
    team: 1 | 2                 // NUEVO
    zombieKills: number
    structuresBuilt: number
    coreDamageDealt: number   // HP del núcleo ENEMIGO quitado por las balas de ese jugador
    coreHpPct: number         // % (0-100) de vida restante del núcleo de SU equipo
  } },
  durationS: number,
  winner: 1 | 2 | null,     // EQUIPO ganador (1v1: igual al slot ganador). Ganan los 2 jugadores del equipo en 2v2
  reason: 'core_destroyed' | 'time_out' | 'opponent_left',
  mapName: string           // nombre en español, p. ej. "Ciudad abandonada"
}
```
`mode` y `capacity` vienen del `RoomSnapshot` que se esparce en el payload. Un jugador gana si
`winner === player.team` (en 1v1 equivale a `winner === player.slot`). En 2v2 `stats` trae los 4 slots y `xp` los jugadores
que siguen en la sala al terminar (quien se fue a media partida no recibe XP ni fila de historial). El XP, las misiones y el
historial (`MatchHistory`/`MatchPlayer`, una fila por jugador con su `slot` 1-4; sin cambios de esquema) se calculan
con la misma regla de victoria por equipo: los dos jugadores del equipo ganador cuentan como ganadores.
Si la partida acaba por abandono el payload se re-emite con los mismos campos.

### `MatchResult`
```ts
{ winner: 1 | 2 | null /* equipo */; reason: 'core_destroyed'|'opponent_left'|'time_out'; cores: { 1:number; 2:number } /* por equipo */ }
```

---

## Reconexión y limpieza

- **Reconexión:** al desconectarse durante `preparation`/`combat`, el asiento se
  **reserva** `reconnectGraceMs` (30 s). El cliente reconecta con `lobby:join`
  pasando su `sessionId`.
- **Abandono en lobby/selección:** libera el asiento; si la sala queda vacía se
  elimina; si quedaba un jugador, se le reasigna el host.
- **Abandono en combate:** en 1v1 el rival gana (`reason: 'opponent_left'`). En 2v2 solo si se va todo el equipo
  (ver "Modos de juego"); si queda un compañero, la partida sigue y solo llega `lobby:playerLeft` + `lobby:state`.
- **Reconexión en 2v2:** cualquiera de los 4 asientos se reserva y recupera con su `sessionId` (mismo slot y equipo).
- **Barrido periódico** (`sweepIntervalMs`, 15 s): expira asientos fuera de la
  ventana de gracia, elimina salas vacías (`emptyRoomTtlMs`) y salas huérfanas/
  antiguas (`lobbyMaxAgeMs`).

Todos estos valores están centralizados y documentados en `src/config/game.config.ts`.


## Armas, caja de armamento y mapas (expansión)

- **Cuchillo automático:** al atacar (`fire` o `action` fuera de la base) con un zombi a ≤ 0.95 casillas se usa el
  cuchillo: 25 de daño, sin gastar munición, un solo golpe 0.1 s después (se vuelve a comprobar la distancia).
  Evento `knife`; el jugador lleva `knifeAt`, `knifeDirX`, `knifeDirY`.
- **Caja del centro:** da un arma pesada según la oleada (`smg` 120 balas, `sniper` 10, `rocket` 5), una torreta y un
  botiquín. `armoryReady` / `armoryOpened` incluyen `weapon`. El jugador lleva `heavy` y `heavyAmmo`; la ranura 6 la equipa.
- **Sniper:** 70 de daño, atraviesa hasta 3 zombis. **Cohete:** explota (radio 1.6, 55 de daño) contra zombis y, en
  combate, rival, sus estructuras y su núcleo. Evento `explosion`.
- `bullets`: `[id, x, y, vx, vy, tipo(0 bala | 1 sniper | 2 cohete)]`. `turrets`: se agrega `disparando (0/1)`.
- **Mapas:** `game:sync` incluye `map.theme` (`ciudad` | `industrial`). `distrito-industrial` genera canales, tren
  (`train`, suelo `RAIL = 8`), estructuras industriales y un helicóptero derribado.
- **Supervivientes:** explorador, mecánica, militar (+15 % daño), médica (+2 botiquines, curan 50 % más) y obrero
  (+8 madera, paredes con 50 % más de vida).
