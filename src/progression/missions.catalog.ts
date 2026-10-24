export type MissionType = 'daily' | 'milestone';
export type MissionMetric =
  | 'matches_played'
  | 'matches_won'
  | 'zombie_kills'
  | 'player_kills'
  | 'structures_built'
  | 'level_reached';

export interface MissionDef {
  key: string;
  type: MissionType;
  title: string;
  description: string;
  goal: number;
  /** XP granted on claim. */
  reward: number;
  metric: MissionMetric;
}

const d = (key: string, title: string, description: string, goal: number, reward: number, metric: MissionMetric): MissionDef => ({
  key, type: 'daily', title, description, goal, reward, metric,
});
const m = (key: string, title: string, description: string, goal: number, reward: number, metric: MissionMetric): MissionDef => ({
  key, type: 'milestone', title, description, goal, reward, metric,
});

export const DAILY_MISSIONS: readonly MissionDef[] = [
  d('daily_play_2', 'Calentamiento', 'Juega 2 partidas.', 2, 60, 'matches_played'),
  d('daily_play_4', 'Sin descanso', 'Juega 4 partidas.', 4, 110, 'matches_played'),
  d('daily_win_1', 'Victoria del día', 'Gana 1 partida.', 1, 90, 'matches_won'),
  d('daily_win_2', 'Doble victoria', 'Gana 2 partidas.', 2, 150, 'matches_won'),
  d('daily_zombies_25', 'Cazazombis', 'Elimina 25 zombis.', 25, 70, 'zombie_kills'),
  d('daily_zombies_60', 'Masacre', 'Elimina 60 zombis.', 60, 120, 'zombie_kills'),
  d('daily_pk_2', 'Cazador de supervivientes', 'Elimina 2 jugadores rivales.', 2, 100, 'player_kills'),
  d('daily_build_10', 'Constructor', 'Construye 10 estructuras.', 10, 80, 'structures_built'),
];

export const MILESTONE_MISSIONS: readonly MissionDef[] = [
  m('ms_play_1', 'Primer contacto', 'Juega tu primera partida.', 1, 100, 'matches_played'),
  m('ms_play_10', 'Superviviente habitual', 'Juega 10 partidas.', 10, 250, 'matches_played'),
  m('ms_play_50', 'Veterano', 'Juega 50 partidas.', 50, 600, 'matches_played'),
  m('ms_win_1', 'Primera sangre', 'Gana 1 partida.', 1, 100, 'matches_won'),
  m('ms_win_5', 'Racha de victorias', 'Gana 5 partidas.', 5, 300, 'matches_won'),
  m('ms_win_25', 'Imparable', 'Gana 25 partidas.', 25, 800, 'matches_won'),
  m('ms_zombies_100', 'Exterminador', 'Elimina 100 zombis.', 100, 200, 'zombie_kills'),
  m('ms_zombies_500', 'Plaga controlada', 'Elimina 500 zombis.', 500, 500, 'zombie_kills'),
  m('ms_zombies_2000', 'Apocalipsis personal', 'Elimina 2000 zombis.', 2000, 1000, 'zombie_kills'),
  m('ms_build_50', 'Ingeniero', 'Construye 50 estructuras.', 50, 300, 'structures_built'),
  m('ms_level_5', 'Nivel 5', 'Alcanza el nivel 5.', 5, 150, 'level_reached'),
  m('ms_level_10', 'Nivel 10', 'Alcanza el nivel 10.', 10, 400, 'level_reached'),
  m('ms_level_20', 'Nivel 20', 'Alcanza el nivel 20.', 20, 1000, 'level_reached'),
];

export const ALL_MISSIONS: readonly MissionDef[] = [...DAILY_MISSIONS, ...MILESTONE_MISSIONS];

export const MISSION_BY_KEY: ReadonlyMap<string, MissionDef> = new Map(ALL_MISSIONS.map((x) => [x.key, x]));
