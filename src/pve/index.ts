/**
 * Vượt ải: the PvE ladder.
 *
 * One entry point, because the two modules are two halves of one thing and every caller wants
 * both: `ascent.ts` is the ladder's *math* - which stage, how strong, what affixes, what it
 * pays - and `monster.ts` is the ladder's *body* - a stage turned into an actual plant the
 * battle engine already understands.
 *
 * Re-exported rather than imported from two places so a screen cannot accidentally use a
 * stage's target power with a monster built from a different stage's curve.
 */

export {
  AFFIXES,
  BAND_LABEL,
  CONSOLATION,
  LOOKAHEAD,
  STAT_LADDER_END,
  describeStage,
  gateCheck,
  gateLabel,
  isBossStage,
  stageAffixes,
  stageGate,
  stageBand,
  stageExtraDrop,
  stageIsOpen,
  stageMutation,
  stageRarity,
  stageReward,
  stageTargetPower,
  stageTier,
  type AscentAffix,
  type AscentBand,
  type StageBrief,
  type StageConsolation,
  type StageGate,
  type StageReward,
} from "./ascent";

export { monsterFor, type MonsterSpec } from "./monster";