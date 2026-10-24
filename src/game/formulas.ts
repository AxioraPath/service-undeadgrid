import { MEDKIT_HEAL, PLAYER, ZOMBIE } from './constants'

export const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))

/** Interpolación lineal; t se limita entre 0 y 1. */
export const lerp = (a: number, b: number, t: number) => a + (b - a) * clamp(t, 0, 1)

/** vida(n) = 40 · 1.25^(n-1), redondeada hacia abajo. */
export const zombieHp = (wave: number) => Math.floor(ZOMBIE.baseHp * 1.25 ** (wave - 1))

/** daño(n) = 10 · 1.15^(n-1) */
export const zombieDamage = (wave: number) => ZOMBIE.baseDamage * 1.15 ** (wave - 1)

/** cantidad(n) = 8 + 8 · (n-1) */
export const zombieCount = (wave: number) => 8 + 8 * (wave - 1)

/** vida_nueva = max(0, vida - ⌊daño⌋) */
export const applyDamage = (hp: number, damage: number) => Math.max(0, hp - Math.floor(damage))

/** El botiquín cura 50 sin pasar de 100. */
export const heal = (hp: number, amount = MEDKIT_HEAL, max = PLAYER.maxHp) => Math.min(max, hp + amount)
