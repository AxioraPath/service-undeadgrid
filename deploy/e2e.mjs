// Prueba E2E: dos clientes se conectan al backend en producción, crean/unen
// sala, marcan ready, y validamos que el servidor orquesta el 1v1.
// Uso: node e2e.mjs
import { io } from 'socket.io-client';

const URL = 'https://api.undeadgrid.axiorapath.com.mx';
const emit = (s, ev, payload) =>
  new Promise((res, rej) => {
    const cb = (r) => (r && r.ok ? res(r.data) : rej(r?.error || 'no-ack'));
    payload === undefined ? s.emit(ev, cb) : s.emit(ev, payload, cb);
    setTimeout(() => rej(new Error('timeout ' + ev)), 8000);
  });

const mk = () => io(URL, { transports: ['websocket'], forceNew: true });

const run = async () => {
  const host = mk();
  await new Promise((r) => host.on('connect', r));
  console.log('host conectado', host.id);

  const created = await emit(host, 'lobby:create', { name: 'Ana', survivor: 'explorador' });
  console.log('sala creada code=%s slot=%s host=%s', created.room.code, created.slot, created.isHost);

  const guest = mk();
  await new Promise((r) => guest.on('connect', r));
  const joined = await emit(guest, 'lobby:join', { code: created.room.code, name: 'Bob', survivor: 'mecanica' });
  console.log('invitado unido slot=%s playerCount=%d', joined.slot, joined.room.players.length);

  // Escuchar snapshots del host
  let lastStatus = '';
  host.on('lobby:state', (r) => { lastStatus = r.status; });

  await emit(host, 'lobby:ready', { ready: true });
  await emit(guest, 'lobby:ready', { ready: true });
  console.log('ambos ready');

  const afterStart = await emit(host, 'lobby:start');
  console.log('start -> status=%s', afterStart.status);

  await emit(host, 'lobby:confirmSurvivor');
  const afterConfirm = await emit(guest, 'lobby:confirmSurvivor');
  console.log('ambos confirmaron -> status=%s', afterConfirm.status);

  // chat
  const msg = await emit(guest, 'chat:send', { text: 'listo vamos' });
  console.log('chat ok id=%d text=%s', msg.id, msg.text);

  await new Promise((r) => setTimeout(r, 500));
  console.log('ultimo status visto por host=%s', lastStatus);

  host.close(); guest.close();
  console.log('E2E_OK');
  process.exit(0);
};

run().catch((e) => { console.error('E2E_FAIL', e); process.exit(1); });
