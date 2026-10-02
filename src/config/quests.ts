/**
 * quests.ts — goals that cannot be mistaken for one another.
 *
 * The pool had 10 templates across 4 kinds, and the draw only deduplicated by
 * `id`. Three goals a day from ten templates meant the same day could hand out
 * "Gieo một hạt mới" and "Gieo ba hạt" side by side — two rows that differ by a
 * digit and read as one quest twice.
 *
 * Two changes, either of which would have helped, both of which are needed:
 *
 *   one goal per kind per day. Three goals drawn from distinct activities cannot
 *     resemble each other no matter how many templates exist. With four kinds
 *     that was already true; the kinds are now eight, so it stays true.
 *
 *   a much larger, much more varied pool. Goals are now about *different things*
 *     — sell, awaken, open a plot, buy a gated species, care with a specific
 *     action — rather than four activities with three different numbers each.
 *
 *   and nothing repeats from the two previous days, so a player who checks in
 *     daily never sees the same row twice in a row.
 */

import type { DailyGoalKind, GardenWeather } from "../core/store";

export interface WeatherInfo {
  id: GardenWeather;
  name: string;
  icon: string;
  /** Multiplies the reward of goals matching these kinds. */
  favours: DailyGoalKind[];
  note: string;
}

export const WEATHER_INFO: Record<GardenWeather, WeatherInfo> = {
  mist: { id: "mist", name: "Sương", icon: "🌫️", favours: ["care"], note: "Sương đầy: chăm cây thuận tay, cây dễ hồi phục và tăng HP." },
  sun: { id: "sun", name: "Nắng", icon: "☀️", favours: ["care"], note: "Nắng gắt: cây tăng trưởng nhanh hơn, nhưng nắng quá tay sẽ cháy lá." },
  storm: { id: "storm", name: "Bão", icon: "⛈️", favours: ["battle"], note: "Bão sấm: hôm nay cây hoang dã bị kích thích, ra chiêu mạnh hơn bình thường." },
  moon: { id: "moon", name: "Trăng", icon: "🌙", favours: ["breed"], note: "Đêm trăng: đêm nay mỗi lần lai tạo có thêm tỉ lệ biến dị cao hơn một chút." },
};

/** A single drawable quest. `weight` controls how often it appears. */
export interface GoalTemplate {
  id: string;
  kind: DailyGoalKind;
  label: string;
  target: number;
  /** Minimum breeder level before this can appear. */
  minLevel: number;
  weight: number;
  reward: { leafCoin?: number; geneCrystal?: number; items?: number };
  /** Short nudge shown when the player taps the goal. */
  hint: string;
}

export const GOAL_POOL: readonly GoalTemplate[] = [
  // --- planting ----------------------------------------------------------
  { id: "plant-first", kind: "plant", label: "Gieo một hạt mới", target: 1, minLevel: 1, weight: 10, reward: { items: 5 }, hint: "Bấm ô đất trống rồi chọn một hạt trong túi." },
  { id: "plant-three", kind: "plant", label: "Gieo ba cây", target: 3, minLevel: 3, weight: 7, reward: { leafCoin: 140, items: 4 }, hint: "Làm vài vườn càng nhanh càng tốt." },
  { id: "plant-variety", kind: "plant", label: "Gieo ba loài khác nhau", target: 3, minLevel: 6, weight: 6, reward: { leafCoin: 260, items: 6 }, hint: "Ba ô trống, ba hạt khác dòng." },
  { id: "plant-fill", kind: "plant", label: "Lấp đầy mọi ô trống", target: 4, minLevel: 10, weight: 4, reward: { leafCoin: 420, geneCrystal: 1 }, hint: "Mở thêm ô vườn nếu số ô trống không đủ." },

  // --- care --------------------------------------------------------------
  { id: "care-three", kind: "care", label: "Chăm cây ba lần", target: 3, minLevel: 1, weight: 10, reward: { leafCoin: 110, items: 3 }, hint: "Mở một cây rồi bấm Chăm cây." },
  { id: "care-variety", kind: "care", label: "Chăm bốn kiểu khác nhau", target: 4, minLevel: 5, weight: 7, reward: { geneCrystal: 1, items: 6 }, hint: "Đổi qua đủ bốn loại chăm trên một cây." },
  { id: "care-wide", kind: "care", label: "Chăm bốn cây khác nhau", target: 4, minLevel: 8, weight: 6, reward: { leafCoin: 300, items: 8 }, hint: "Chăm rải ra nhiều cây sẽ hiệu quả hơn chăm dồn." },
  { id: "care-nine", kind: "care", label: "Chăm cây chín lần", target: 9, minLevel: 12, weight: 5, reward: { leafCoin: 460, items: 10 }, hint: "Làm theo chu kỳ chăm cây để giữ nhịp." },

  // --- battle ------------------------------------------------------------
  { id: "battle-two", kind: "battle", label: "Đấu hai trận", target: 2, minLevel: 1, weight: 10, reward: { leafCoin: 190 }, hint: "Vào Đài chiến chọn một cây trưởng thành." },
  { id: "battle-room", kind: "battle", label: "Tham gia một phòng đấu", target: 1, minLevel: 4, weight: 6, reward: { geneCrystal: 1, leafCoin: 120 }, hint: "Tạo phòng rồi mời bạn bè đấu, bàn cần ít nhất 6 k." },
  { id: "battle-four", kind: "battle", label: "Đấu bốn trận", target: 4, minLevel: 6, weight: 6, reward: { leafCoin: 360, items: 4 }, hint: "Thua vẫn nên đấu, các đấu đi lên." },
  { id: "battle-win", kind: "win", label: "Thắng hai trận", target: 2, minLevel: 3, weight: 7, reward: { leafCoin: 280, items: 5 }, hint: "Chọn cây có thuộc tính khắc đối thủ." },

  // --- breeding ----------------------------------------------------------
  { id: "breed-one", kind: "breed", label: "Lai tạo một cây con", target: 1, minLevel: 3, weight: 9, reward: { geneCrystal: 1, leafCoin: 90 }, hint: "Cần hai cây trưởng thành ở Lai tạo." },
  { id: "breed-two", kind: "breed", label: "Lai tạo hai cây con", target: 2, minLevel: 8, weight: 5, reward: { geneCrystal: 2, leafCoin: 260 }, hint: "Lai cặp khác để cây ra biến dị khác hơn." },
  { id: "breed-tier", kind: "breed", label: "Lai tạo một cây từ hai dòng khác nhau", target: 1, minLevel: 12, weight: 4, reward: { geneCrystal: 2, leafCoin: 340 }, hint: "Hai cây khác hệ sẽ ra đột biến rõ hơn." },

  // --- selling -----------------------------------------------------------
  { id: "sell-one", kind: "sell", label: "Bán một cây", target: 1, minLevel: 2, weight: 7, reward: { leafCoin: 150 }, hint: "Vào Sưu tầm để bán cây không còn dùng." },
  { id: "sell-three", kind: "sell", label: "Bán ba cây", target: 3, minLevel: 7, weight: 5, reward: { leafCoin: 380, items: 5 }, hint: "Bán cây trùng chủng để lấy chỗ trồng." },

  // --- awakening ---------------------------------------------------------
  { id: "awaken-one", kind: "awaken", label: "Thức tỉnh một cây", target: 1, minLevel: 14, weight: 5, reward: { geneCrystal: 3, leafCoin: 500 }, hint: "Cây đủ cấp và tối đa 5 ngôi sao rồi mới thức tỉnh được." },

  // --- the garden itself -------------------------------------------------
  { id: "plot-open", kind: "openPlot", label: "Mở thêm một ô vườn", target: 1, minLevel: 4, weight: 6, reward: { items: 12 }, hint: "Ô khoá ở cuối vườn, bấm để xem điều kiện." },
  { id: "plot-two", kind: "openPlot", label: "Mở thêm hai ô vườn", target: 2, minLevel: 16, weight: 4, reward: { leafCoin: 600, items: 20 }, hint: "Chú ý điều kiện mở ở từng ô." },

  // --- collection --------------------------------------------------------
  { id: "unlock-species", kind: "unlock", label: "Mua hạt của một loài đang khoá", target: 1, minLevel: 5, weight: 7, reward: { leafCoin: 200, items: 4 }, hint: "Trong Cửa hàng, xem điều kiện ngay trên thẻ loài." },
  { id: "unlock-three", kind: "unlock", label: "Mở khoá ba loài cây", target: 3, minLevel: 18, weight: 4, reward: { geneCrystal: 2, leafCoin: 480 }, hint: "Điều kiện thường có nhiều đường, chọn đường gần nhất." },
];

/** How many daily goals a player gets. */
export const DAILY_GOAL_COUNT = 3;

/**
 * How many days a goal is barred from repeating.
 *
 * Two, not one: with a pool this size, barring only yesterday's picks still lets a
 * quest come back the day after next often enough to be noticed.
 */
export const GOAL_COOLDOWN_DAYS = 2;

/* ==========================================================================
   Long-term milestones
   ========================================================================== */

/**
 * What a milestone counts.
 *
 * Mirrors the switch in `store.metricProgress` exactly. Adding one here without
 * one there is a type error rather than a silent zero, which is the reason this
 * list is a union type rather than a plain string.
 */
export type MilestoneMetric =
  | "species"
  | "elements"
  | "traits"
  | "careActions"
  | "battles"
  | "breeds"
  | "wins"
  | "plantsOwned"
  | "highestGeneration"
  | "highestRarity";

export interface MilestoneTemplate {
  id: string;
  metric: MilestoneMetric;
  label: string;
  target: number;
  hint: string;
  reward: { leafCoin?: number; geneCrystal?: number; items?: number };
}

/**
 * The collection-and-mastery track.
 *
 * Twenty-four steps across ten metrics. The early ones are cheap so the first
 * session always produces one, and the later ones need real play rather than a
 * timer: rarity and generation cannot be reached by leaving the game open.
 */
export const MILESTONES: readonly MilestoneTemplate[] = [
  { id: "plant-1", metric: "plantsOwned", label: "Gieo cây đầu tiên", target: 1, hint: "Một cây trong vườn là đủ để mở mốc này.", reward: { leafCoin: 200 } },
  { id: "species-3", metric: "species", label: "Sở hữu 3 loài khác nhau", target: 3, hint: "Giữ hạt của ba dòng khác nhau trong túi.", reward: { leafCoin: 320, items: 8 } },
  { id: "care-2", metric: "careActions", label: "Thử 2 kiểu chăm", target: 2, hint: "Khác biệt về cách chăm tạo ra cây khác nhau.", reward: { items: 10 } },
  { id: "element-4", metric: "elements", label: "Gặp 4 hệ nguyên tố", target: 4, hint: "Cây lai cấp thấp đã cho ra hệ mới.", reward: { geneCrystal: 1, leafCoin: 400 } },
  { id: "battle-1", metric: "battles", label: "Ra trận đầu tiên", target: 1, hint: "Đấu thua vẫn tính.", reward: { leafCoin: 180 } },
  { id: "breed-1", metric: "breeds", label: "Lai tạo một cây con", target: 1, hint: "Hai cây trưởng thành là đủ.", reward: { geneCrystal: 1 } },
  { id: "trait-4", metric: "traits", label: "Tích lũy 4 đặc tính", target: 4, hint: "Đặc tính quyết định cách cây chơi.", reward: { geneCrystal: 1, leafCoin: 500 } },
  { id: "wins-3", metric: "wins", label: "Thắng 3 trận", target: 3, hint: "Chọn cây khắc hệ đối thủ.", reward: { leafCoin: 600, items: 12 } },
  { id: "care-4", metric: "careActions", label: "Thử đủ 4 kiểu chăm", target: 4, hint: "Mỗi kiểu chăm tăng một chỉ số khác nhau.", reward: { geneCrystal: 2, leafCoin: 700 } },
  { id: "plants-10", metric: "plantsOwned", label: "Vườn có 10 cây", target: 10, hint: "Mở thêm ô vườn để chứa nổi.", reward: { leafCoin: 900, items: 20 } },
  { id: "species-10", metric: "species", label: "Sở hữu 10 loài", target: 10, hint: "Cửa hàng mở dần theo cấp và theo thành tích.", reward: { leafCoin: 1200, geneCrystal: 2 } },
  { id: "elements-8", metric: "elements", label: "Gặp đủ 8 hệ", target: 8, hint: "Cần lai đủ rộng, không chỉ lai cùng hệ.", reward: { geneCrystal: 3, leafCoin: 1600 } },
  { id: "battles-10", metric: "battles", label: "Đấu 10 trận", target: 10, hint: "Không cần thắng, cần chơi.", reward: { leafCoin: 1100 } },
  { id: "traits-8", metric: "traits", label: "Tích lũy 8 đặc tính", target: 8, hint: "Cây đa đặc tính mạnh hơn cây một đặc tính.", reward: { geneCrystal: 2, items: 24 } },
  { id: "gen-3", metric: "highestGeneration", label: "Có cây thế hệ 3", target: 3, hint: "Lai lại cây con với cây cha mẹ.", reward: { geneCrystal: 3, leafCoin: 1800 } },
  { id: "wins-10", metric: "wins", label: "Thắng 10 trận", target: 10, hint: "Thắng cả 3 cấp đấu.", reward: { leafCoin: 2000, items: 30 } },
  { id: "breeds-5", metric: "breeds", label: "Lai tạo 5 cây", target: 5, hint: "Mỗi cặp cho một cây khác nhau.", reward: { geneCrystal: 3, leafCoin: 1500 } },
  { id: "care-6", metric: "careActions", label: "Thử 6 kiểu chăm", target: 6, hint: "Chăm nhiều kiểu để cây chịu được lệch.", reward: { geneCrystal: 2, leafCoin: 1400 } },
  { id: "species-25", metric: "species", label: "Sở hữu 25 loài", target: 25, hint: "Điều kiện mở khoá nhiều đường, chọn đường gần.", reward: { leafCoin: 3200, geneCrystal: 4 } },
  { id: "battles-30", metric: "battles", label: "Đấu 30 trận", target: 30, hint: "Đấu phòng là cách nhanh nhất.", reward: { leafCoin: 2600, items: 40 } },
  { id: "gen-5", metric: "highestGeneration", label: "Có cây thế hệ 5", target: 5, hint: "Cần ổn định cao qua nhiều đời.", reward: { geneCrystal: 5, leafCoin: 4000 } },
  { id: "wins-40", metric: "wins", label: "Thắng 40 trận", target: 40, hint: "Thắng liên tục ở cấp cao.", reward: { leafCoin: 5200, geneCrystal: 4 } },
  { id: "plants-24", metric: "plantsOwned", label: "Mở kín 24 ô vườn", target: 24, hint: "Hết ô để mở là phải bán bớt.", reward: { leafCoin: 6000, geneCrystal: 5, items: 60 } },
  { id: "rarity-4", metric: "highestRarity", label: "Sở hữu cây bậc SS trở lên", target: 4, hint: "Rarity points: C=0 B=1 A=2 S=3 SS=4 SSS=5.", reward: { leafCoin: 9000, geneCrystal: 8 } },
];

/**
 * Reward multiplier for a login streak.
 *
 * Flat for the first two days, because a multiplier that starts at day one
 * rewards logging in rather than playing. Capped at 2x so a streak never
 * substitutes for a session.
 */
export function streakMultiplier(streak: number): number {
  if (streak < 2) return 1;
  return Math.min(2, 1 + (streak - 1) * 0.06);
}

/** How the streak is described in the UI. Never empty, so no branch needs a guard. */
export function streakLabel(streak: number): string {
  if (streak <= 0) return "Hôm nay là ngày đầu";
  if (streak === 1) return "Chuỗi 1 ngày";
  if (streak < 7) return `Chuỗi ${streak} ngày · +${Math.round((streakMultiplier(streak) - 1) * 100)}%`;
  if (streak < 30) return `Chuỗi ${streak} ngày · thưởng +${Math.round((streakMultiplier(streak) - 1) * 100)}%`;
  return `Chuỗi ${streak} ngày · thưởng tối đa`;
}
