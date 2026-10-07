/**
 * Garden weather and the login streak.
 *
 * ## What used to be here
 *
 * A pool of daily-goal templates and a list of twenty-four discovery milestones, each with its
 * own draw rules, cooldowns and claim path. They are gone: both were replaced by the quest
 * shelf in `quests/`, which owns daily work and long-term marks with one state, one event
 * stream and one claim path.
 *
 * What is left is what was never a checklist: the weather (which is flavour and a small bonus)
 * and the streak (which is about coming back, not about doing a task).
 */

import type { GardenWeather } from "../core/store";

export interface WeatherInfo {
  id: GardenWeather;
  name: string;
  icon: string;
  note: string;
}

export const WEATHER_INFO: Record<GardenWeather, WeatherInfo> = {
  mist: { id: "mist", name: "Sương", icon: "🌫️", note: "Sương đầy: chăm cây thuận tay, cây dễ hồi phục và tăng HP." },
  sun: { id: "sun", name: "Nắng", icon: "☀️", note: "Nắng gắt: cây tăng trưởng nhanh hơn, nhưng nắng quá tay sẽ cháy lá." },
  storm: { id: "storm", name: "Bão", icon: "⛈️", note: "Bão sấm: hôm nay cây hoang dã bị kích thích, ra chiêu mạnh hơn bình thường." },
  moon: { id: "moon", name: "Trăng", icon: "🌙", note: "Đêm trăng: đêm nay mỗi lần lai tạo có thêm tỉ lệ biến dị cao hơn một chút." },
};

/**
 * Reward multiplier for a login streak.
 *
 * Flat for the first two days, because a multiplier that starts at day one rewards logging in
 * rather than playing. Capped at 2x so a streak never substitutes for a session.
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
