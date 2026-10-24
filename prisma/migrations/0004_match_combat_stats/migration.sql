-- Estadísticas de combate tomadas del motor de la partida.
-- AlterTable
ALTER TABLE "player_stats" ADD COLUMN "playerKills" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "deaths" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "match_history" ADD COLUMN "maxWave" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "match_players" ADD COLUMN "kills" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "zombieKills" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "deaths" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "structuresBuilt" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "timeAliveS" INTEGER NOT NULL DEFAULT 0;
