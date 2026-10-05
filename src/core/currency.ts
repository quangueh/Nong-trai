/**
 * Four currencies, each earned by a different thing.
 *
 * One currency means every activity funnels into the same number. Tending, breeding and
 * fighting all paid LeafCoin, so the shop never asked which of them a player had been
 * doing - it only asked how much. Choosing "breed some" over "go fight" was a decision
 * about time, never about what the game wanted.
 *
 * So each currency belongs to one activity:
 *
 *   - **LeafCoin** from winning and from selling. The everyday one.
 *   - **Nectar** from tending. Every single care action pays some, without exception, so
 *     this can never be the currency a player is stuck short of.
 *   - **Pollen** from breeding, and from an uncommon battle drop. Breeding needs two
 *     mature plants, so the drop exists to keep the top shelf reachable for someone who
 *     has not bred yet rather than walling it off.
 *   - **Ember** from a rare battle drop only, and it buys only the highest tier.
 *
 * That last one is the point of the set. Ember has exactly one source and one use, both
 * on the same screen, so it reads as a prize rather than as a fourth number to watch.
 *
 * Every currency's price is **shown on the card before the purchase**, and the same
 * number is taken. A card that says one currency and charges another is the failure mode
 * a multi-currency shop actually has.
 */

/** The currencies, in the order the top bar shows them. */
export const CURRENCIES = [
  {
    id: "leafCoin",
    name: "Xu lá",
    icon: "🪙",
    /** Shown where the number comes from, so the shop can say why you are short. */
    source: "Thắng trận và bán cây",
  },
  {
    id: "nectar",
    name: "Mật ong",
    icon: "🍯",
    source: "Chăm cây",
  },
  {
    id: "pollen",
    name: "Phấn hoa",
    icon: "🌼",
    source: "Lai tạo và rớt hiếm khi đấu",
  },
  {
    id: "ember",
    name: "Mảnh lửa",
    icon: "🔥",
    source: "Rớt hiếm khi đấu",
  },
] as const;

export type CurrencyId = (typeof CURRENCIES)[number]["id"];

export const CURRENCY_IDS: CurrencyId[] = CURRENCIES.map((c) => c.id);

const BY_ID: Record<string, (typeof CURRENCIES)[number]> = Object.fromEntries(CURRENCIES.map((c) => [c.id, c]));

/**
 * A currency's label, or the raw id if it is not one of ours.
 *
 * Total rather than a non-null assertion: a save or a Worker payload can carry a field
 * this build has never heard of, and a crash on startup over a label is a worse outcome
 * than showing the id.
 */
export function currencyInfo(id: string): { id: CurrencyId; name: string; icon: string; source: string } {
  return BY_ID[id] ?? { id: id as CurrencyId, name: id, icon: "❔", source: "" };
}

export function currencyName(id: string): string {
  return currencyInfo(id).name;
}

/** `🪙 Xu lá` — for a price on a card. */
export function currencyLabel(id: string, amount: number): string {
  const c = currencyInfo(id);
  return `${c.icon} ${Math.round(amount).toLocaleString("vi-VN")} ${c.name}`;
}

/** `🪙` alone — for a balance pill, where the name is already on screen. */
export function currencyIcon(id: string): string {
  return currencyInfo(id).icon;
}

/** Nectar paid per care action. See `CURRENCIES`: this is the floor of the economy. */
export const NECTAR_PER_CARE = 3;

/** Pollen paid per completed breeding. */
export const POLLEN_PER_BREED = 4;

/**
 * A balance, short enough to sit in a HUD.
 *
 * The top bar has a fixed width and the numbers in it do not. At the end of a season a
 * pollen balance is six digits, and printing it in full pushed the settings button off a
 * phone entirely - the bar simply could not hold the information, so something had to go.
 *
 * Abbreviated rather than dropped, because the exact figure is still available wherever it
 * is spent: the shop's cards print prices in full, and the pair pill's tooltip spells both
 * currencies out. What the bar needs is "am I in the thousands or the millions", which is
 * what this answers.
 *
 * `k` and `Tr` rather than `K` and `M`, because a Vietnamese player reads "12,4k" and
 * "2,4Tr" without a second thought and reads "12.4K" as something out of a spreadsheet.
 */
export function compactNumber(n: number): string {
  const v = Math.round(n);
  if (Math.abs(v) < 1000) return v.toLocaleString("vi-VN");
  if (Math.abs(v) < 1_000_000) {
    const k = v / 1000;
    // One decimal below 100k, none above: "98,8k" is useful, "847,3k" is noise.
    return (Math.abs(k) < 100 ? k.toFixed(1).replace(/\.0$/, "") : Math.round(k).toString()) + "k";
  }
  const tr = v / 1_000_000;
  return (Math.abs(tr) < 100 ? tr.toFixed(1).replace(/\.0$/, "") : Math.round(tr).toString()) + "Tr";
}

/**
 * How a player phrases "I do not have enough of this".
 */
export function shortOf(id: string): string {
  return `Không đủ ${currencyInfo(id).name.toLowerCase()}`;
}

/**
 * Which currency a species of a given shop tier is sold in.
 *
 * By tier, so it is learnable: the shelf tells you what a tier costs before you look at
 * any individual card. Drawn from `rarityHint` inside a tier as well, so a tier is not
 * one flat price - there is still a reason to compare two cards in the same row.
 *
 * Tier 0 and 1 stay on LeafCoin. Those are the species a new player meets first, and
 * making them cost a currency they have never earned would be a bad first minute.
 */
export function currencyForTier(tier: number, rarityHint: number): CurrencyId {
  if (tier <= 1) return "leafCoin";
  if (tier === 2) return rarityHint < 0.5 ? "nectar" : "leafCoin";
  if (tier === 3) return "pollen";
  // Tier 4 is Ember, and only Ember. The top of the registry is bought with the one
  // currency that only a lucky fight provides.
  return "ember";
}

/**
 * How many of a currency a balance should be read as worth in the top bar.
 *
 * Not a conversion - nothing is exchangeable, and pretending otherwise would let a
 * player wonder why the shop would not take it. This only orders the pills, so the rare
 * one is not sitting between two large numbers where it disappears.
 */
export function currencyRank(id: CurrencyId): number {
  return CURRENCIES.findIndex((c) => c.id === id);
}
