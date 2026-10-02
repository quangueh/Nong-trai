export type Screen = "garden" | "collection" | "breeding" | "arena" | "lab";

export type Navigate = (screen: Screen, params?: unknown) => void;
