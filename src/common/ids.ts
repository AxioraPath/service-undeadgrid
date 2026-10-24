import { randomBytes, randomUUID } from 'crypto';
import { ROOM_CODE } from '../config/game.config';

/** Genera un código de sala con el alfabeto del juego (espeja catalog.ts). */
export function randomRoomCode(): string {
  const { alphabet, length } = ROOM_CODE;
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) {
    out += alphabet[bytes[i] % alphabet.length];
  }
  return out;
}

/** Token de sesión opaco para identificar un asiento y permitir reconexión. */
export function newSessionId(): string {
  return randomUUID();
}

/** Semilla determinista para el mapa (entero sin signo de 32 bits). */
export function randomSeed(): number {
  return randomBytes(4).readUInt32BE(0);
}
