import { gameInputSchema } from '../contracts/game';
import { MAP_H, MAP_W, PLAYER, STRUCTURES, WEAPONS } from './constants';
import { createMatch, previewBuild, step } from './engine';
import { applyDamage, clamp, heal, lerp, zombieCount, zombieDamage, zombieHp } from './formulas';
import { generateMap, isMapReachable, Tile } from './mapgen';

/** Pruebas unitarias de las reglas del juego (matriz del PDF: mapa, daño, Zod, interpolación). */
describe('Generador de mapas', () => {
  it('la cuadrícula mide 32 × 24 y tiene borde de muros', () => {
    const map = generateMap(1234);
    expect(map.w).toBe(MAP_W);
    expect(map.h).toBe(MAP_H);
    expect(map.tiles).toHaveLength(32 * 24);
    for (let x = 0; x < MAP_W; x++) {
      expect(map.tiles[x]).toBe(Tile.BORDER);
      expect(map.tiles[(MAP_H - 1) * MAP_W + x]).toBe(Tile.BORDER);
    }
    for (let y = 0; y < MAP_H; y++) {
      expect(map.tiles[y * MAP_W]).toBe(Tile.BORDER);
      expect(map.tiles[y * MAP_W + MAP_W - 1]).toBe(Tile.BORDER);
    }
  });

  it('la misma semilla produce el mismo mapa', () => {
    const a = generateMap(42);
    const b = generateMap(42);
    expect(Array.from(a.tiles)).toEqual(Array.from(b.tiles));
    expect(a.objects).toEqual(b.objects);
  });

  it('las bases y los puntos de zombis son alcanzables (BFS)', () => {
    for (const seed of [1, 7, 99, 2024, 31337]) expect(isMapReachable(generateMap(seed))).toBe(true);
  });
});

describe('Daño y escalado', () => {
  it('cada arma hace el daño de la tabla', () => {
    expect(WEAPONS.pistol.damage).toBe(15);
    expect(WEAPONS.shotgun.damage * WEAPONS.shotgun.pellets).toBe(50);
  });

  it('la vida y el daño de los zombis escalan por oleada', () => {
    expect(zombieHp(1)).toBe(40);
    expect(zombieHp(2)).toBe(50);
    expect(zombieDamage(2)).toBeCloseTo(11.5);
    expect(zombieCount(1)).toBe(8);
    expect(zombieCount(3)).toBe(24);
  });

  it('la vida nunca baja de 0, el botiquín no pasa de 100 y construir sin material se rechaza', () => {
    expect(applyDamage(10, 15.9)).toBe(0);
    expect(heal(80)).toBe(PLAYER.maxHp);
    const s = createMatch({ seed: 5, players: [{ id: 'a', slot: 1, name: 'A', survivor: 'explorador' }] });
    const p = s.players[0];
    p.wood = STRUCTURES.woodWall.wood - 1;
    expect(previewBuild(s, p).ok).toBe(false);
  });
});

describe('Esquemas Zod', () => {
  it('un input válido pasa y uno malformado se rechaza', () => {
    expect(gameInputSchema.safeParse({ seq: 1, up: true, down: false, left: false, right: false, action: false }).success).toBe(true);
    expect(gameInputSchema.safeParse({ seq: -1, up: 'sí' }).success).toBe(false);
  });
});

describe('Interpolación', () => {
  it('con t = 0.5 da el punto medio entre dos posiciones', () => {
    expect(lerp(2, 6, 0.5)).toBe(4);
  });

  it('t se limita entre 0 y 1', () => {
    expect(lerp(2, 6, -1)).toBe(2);
    expect(lerp(2, 6, 3)).toBe(6);
    expect(clamp(5, 0, 1)).toBe(1);
  });
});

describe('Simulación', () => {
  it('editar el cliente no cambia la velocidad: el servidor aplica 4 casillas/s', () => {
    const s = createMatch({ seed: 9, players: [{ id: 'a', slot: 1, name: 'A', survivor: 'explorador' }] });
    const p = s.players[0];
    const y0 = p.y;
    for (let i = 0; i < 6; i++) step(s, { a: { up: false, down: true, left: false, right: false, action: false } }, [], 1 / 30);
    expect(p.y - y0).toBeCloseTo((PLAYER.speed * 6) / 30, 5);
  });
});
