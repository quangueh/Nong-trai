export type Screen = "garden" | "collection" | "breeding" | "arena" | "ascent" | "lab";

export type Navigate = (screen: Screen, params?: unknown) => void;
