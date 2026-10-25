import { z } from 'zod';
import {
  DIFFICULTIES,
  GAME_MODES,
  LIMITS,
  MAP_IDS,
  ROOM_CODE,
  UNLOCKED_SURVIVORS,
} from '../config/game.config';

/**
 * Schemas Zod para validar EN RUNTIME todo payload cliente→servidor.
 * La regla es: nada entra al dominio sin pasar por aquí.
 */

const codeAlphabet = new Set(ROOM_CODE.alphabet.split(''));

/** Código de sala: longitud exacta y alfabeto permitido (se normaliza a mayúsculas). */
export const roomCodeSchema = z
  .string()
  .trim()
  .transform((s) => s.toUpperCase())
  .refine((s) => s.length === ROOM_CODE.length, {
    message: `El código debe tener ${ROOM_CODE.length} caracteres`,
  })
  .refine((s) => s.split('').every((c) => codeAlphabet.has(c)), {
    message: 'El código contiene caracteres no válidos',
  });

/** Nombre de jugador: se recorta y limita igual que el frontend. */
export const playerNameSchema = z
  .string()
  .transform((s) => s.trim().slice(0, LIMITS.nameMaxLength))
  .refine((s) => s.length >= LIMITS.nameMinLength, {
    message: 'El nombre no puede estar vacío',
  });

export const survivorIdSchema = z.enum(
  UNLOCKED_SURVIVORS as unknown as [string, ...string[]],
);

export const mapIdSchema = z.enum(MAP_IDS as unknown as [string, ...string[]]);

export const difficultySchema = z.enum(
  DIFFICULTIES as unknown as [string, ...string[]],
);

// ---- Payloads cliente → servidor ----

export const createRoomSchema = z.object({
  name: playerNameSchema,
  /** Opcional: superviviente inicial elegido ya en el menú. */
  survivor: survivorIdSchema.optional(),
});
export type CreateRoomPayload = z.infer<typeof createRoomSchema>;

export const joinRoomSchema = z.object({
  code: roomCodeSchema,
  name: playerNameSchema,
  survivor: survivorIdSchema.optional(),
  /**
   * Token de sesión previo para intentar RECONECTAR a un asiento existente
   * (p. ej. tras recargar la página). Opcional.
   */
  sessionId: z.string().min(1).max(100).optional(),
});
export type JoinRoomPayload = z.infer<typeof joinRoomSchema>;

export const renameSchema = z.object({ name: playerNameSchema });
export type RenamePayload = z.infer<typeof renameSchema>;

export const readySchema = z.object({ ready: z.boolean() });
export type ReadyPayload = z.infer<typeof readySchema>;

export const selectSurvivorSchema = z.object({ survivor: survivorIdSchema });
export type SelectSurvivorPayload = z.infer<typeof selectSurvivorSchema>;

export const setMapSchema = z.object({ mapId: mapIdSchema });
export type SetMapPayload = z.infer<typeof setMapSchema>;

export const setDifficultySchema = z.object({ difficulty: difficultySchema });
export type SetDifficultyPayload = z.infer<typeof setDifficultySchema>;

export const setModeSchema = z.object({ mode: z.enum(GAME_MODES) });
export type SetModePayload = z.infer<typeof setModeSchema>;

export const setTeamSchema = z.object({ team: z.union([z.literal(1), z.literal(2)]) });
export type SetTeamPayload = z.infer<typeof setTeamSchema>;

export const chatSendSchema = z.object({
  text: z
    .string()
    .transform((s) => s.trim().slice(0, LIMITS.chatMaxLength))
    .refine((s) => s.length > 0, { message: 'El mensaje está vacío' }),
});
export type ChatSendPayload = z.infer<typeof chatSendSchema>;

export const pingSchema = z.object({ t: z.number().optional() }).optional();
