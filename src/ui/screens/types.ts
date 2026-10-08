export type Screen = "garden" | "collection" | "breeding" | "arena" | "ascent" | "lab" | "leaderboard";

export type Navigate = (screen: Screen, params?: unknown) => void;
