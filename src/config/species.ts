/**
 * Species registry (docs/01 §2).
 *
 * The five starters are hand-written because they anchor early progression and
 * the tutorial. Everything beyond them is generated: `SPECIES_TOTAL` species,
 * each with its own element affinity, archetype, stat/body/skill bias, price and
 * Vietnamese name.
 *
 * They are generated from a fixed seed, so species `sp0042` is the same plant
 * for every player, in every session, forever — they are stable content, not
 * random noise. Generation runs once at module load (~3ms) and is then read-only.
 */

import { Rng, clamp, round2 } from "../core/rng";
import type { UnlockReq } from "./unlocks";
import { ELEMENTS, type ElementId } from "./elements";
import { nameKey } from "../genetics/names";

/**
 * Species ids are open, not a closed union. The five starters are named; the
 * rest use `sp0000`…`sp0999`. A branded string keeps type safety on the starters
 * without forcing a 1000-member literal union into every signature.
 */
export type SpeciesId = string;

export type Archetype = "tank" | "burst" | "sustain" | "control" | "tempo" | "counter";

export type StatGeneId = "hp" | "attack" | "defense" | "speed" | "skillPower" | "crit" | "evasion";
export const STAT_GENES: readonly StatGeneId[] = ["hp", "attack", "defense", "speed", "skillPower", "crit", "evasion"];

export type SkillGeneId =
  | "projectile"
  | "melee"
  | "aura"
  | "trap"
  | "dot"
  | "heal"
  | "shield"
  | "control"
  | "chain"
  | "summon";
export const SKILL_GENES: readonly SkillGeneId[] = [
  "projectile",
  "melee",
  "aura",
  "trap",
  "dot",
  "heal",
  "shield",
  "control",
  "chain",
  "summon",
];

export type BodyGeneId =
  | "stem"
  | "leaf"
  | "root"
  | "flower"
  | "fruit"
  | "thorn"
  | "fungus"
  | "aura"
  | "pattern"
  | "size";

export interface SpeciesDef {
  id: SpeciesId;
  name: string;
  seedPrice: number;
  /** Minutes to reach `mature`; the game runs a compressed table. */
  growMinutes: number;
  elements: Partial<Record<ElementId, number>>;
  archetype: Archetype;
  blurb: string;
  /** 0-1: how far this species sits from the five starters. Drives shop placement. */
  rarityHint: number;
  /** Starting tier in the shop rotation; 0 is always available, higher needs more levels. */
  tier: number;
  /**
   * How this species opens.
   *
   * Absent means available from the start. Everything else draws on the shared
   * rule pool so the shop's answer to "why is this locked" is always specific.
   */
  unlock?: UnlockReq;
  statBias: Partial<Record<StatGeneId, number>>;
  bodyBias: Partial<Record<BodyGeneId, string>>;
  skillBias: Partial<Record<SkillGeneId, number>>;
}

// --- the five hand-written starters ---------------------------------------

const STARTERS: readonly SpeciesDef[] = [
  {
    id: "thornroot",
    name: "Rễ Gai",
    seedPrice: 100,
    growMinutes: 20,
    elements: { wood: 0.62, earth: 0.3, poison: 0.08 },
    archetype: "tank",
    blurb: "Thủ, phản đòn. Sống dai và gai sắc.",
    rarityHint: 0,
    tier: 0,
    statBias: { hp: 1.2, defense: 1.25, attack: 0.9, speed: 0.7, evasion: 0.6 },
    bodyBias: { stem: "thick", root: "deep", thorn: "barbed", leaf: "broad" },
    skillBias: { melee: 1.3, trap: 1.2, projectile: 0.6, shield: 0.9 },
  },
  {
    id: "emberleaf",
    name: "Lá Lửa",
    seedPrice: 120,
    growMinutes: 18,
    elements: { wood: 0.45, fire: 0.5, light: 0.05 },
    archetype: "burst",
    blurb: "Sát thương bùng nổ, chết nhanh.",
    rarityHint: 0,
    tier: 0,
    statBias: { attack: 1.3, crit: 1.25, speed: 0.95, hp: 0.8, defense: 0.7 },
    bodyBias: { stem: "lean", leaf: "serrated", flower: "ember_core", aura: "warm_glow" },
    skillBias: { projectile: 1.4, dot: 1.3, aura: 1.1 },
  },
  {
    id: "dewbud",
    name: "Búp Sương",
    seedPrice: 110,
    growMinutes: 22,
    elements: { wood: 0.5, water: 0.45, light: 0.05 },
    archetype: "sustain",
    blurb: "Hồi phục và làm chậm. Kéo dài trận.",
    rarityHint: 0,
    tier: 0,
    statBias: { hp: 1.15, skillPower: 1.15, defense: 1.05, attack: 0.7, crit: 0.6 },
    bodyBias: { stem: "slender", leaf: "round", flower: "dew_bloom", fruit: "pearl" },
    skillBias: { heal: 1.5, shield: 1.3, control: 1.1, aura: 1.2 },
  },
  {
    id: "voltvine",
    name: "Dây Sét",
    seedPrice: 140,
    growMinutes: 16,
    elements: { wood: 0.42, electric: 0.52, light: 0.06 },
    archetype: "tempo",
    blurb: "Tốc độ và chí mạng. Ép nhịp đối thủ.",
    rarityHint: 0,
    tier: 0,
    statBias: { speed: 1.35, crit: 1.2, attack: 1.05, hp: 0.8, defense: 0.7 },
    bodyBias: { stem: "vine", leaf: "arrow", aura: "spark", pattern: "veined" },
    skillBias: { chain: 1.5, projectile: 1.2, control: 1.0 },
  },
  {
    id: "gloomcap",
    name: "Nấm U Ám",
    seedPrice: 130,
    growMinutes: 24,
    elements: { wood: 0.38, poison: 0.5, shadow: 0.12 },
    archetype: "control",
    blurb: "Gây độc và làm suy giảm đối thủ. Thắng bằng kiểm soát nhịp đánh.",
    rarityHint: 0,
    tier: 0,
    statBias: { skillPower: 1.3, hp: 1.05, attack: 0.85, crit: 0.7, evasion: 0.9 },
    bodyBias: { fungus: "cap", flower: "spore_ring", aura: "spore_dust", pattern: "mottled" },
    skillBias: { dot: 1.5, control: 1.3, trap: 1.1, aura: 1.0 },
  },
];

/** How many generated species sit behind the five starters. */
export const GENERATED_SPECIES_COUNT = 6000;

/** Total species in the registry: five starters plus the generated pool. */
export const SPECIES_TOTAL = STARTERS.length + GENERATED_SPECIES_COUNT;

export const STARTER_IDS: readonly SpeciesId[] = STARTERS.map((s) => s.id);

// --- name generation ------------------------------------------------------
//
// Vietnamese botanical naming reads as `<plant part> <descriptor> <qualifier>`.
// The pools below are sized so the cross product is far larger than the number
// of species needed, and names are de-duplicated at generation time, so every
// one of the 1000 species ends up with a distinct name.

const PART = [
  "Rễ", "Lá", "Nụ", "Đóa", "Cành", "Gai", "Nấm", "Mầm", "Thân", "Cụ",
  "Chùm", "Trụ", "Dây", "Lưỡi", "Răng", "Vỏ", "Tán", "Hạt", "Củ", "Lái",
  "Nhụy", "Gốc", "Nhánh", "Kép", "Cuộn", "Đốt", "Mào", "Yên", "Lông", "Rỗng",
];

const ELEMENT_WORD: Record<ElementId, string[]> = {
  wood: ["Gai", "Xanh", "Mộc", "Rừng", "Lá", "Trúc", "Tùng", "Thanh"],
  fire: ["Lửa", "Đỏ", "Nóng", "Tro", "Hỏa", "Diệm", "Nham", "Cui"],
  water: ["Sương", "Mưa", "Nước", "Lầy", "Giọt", "Suối", "Mặt", "Bến"],
  earth: ["Đá", "Cát", "Núi", "Thạch", "Đất", "Gò", "Hang", "Cứng"],
  electric: ["Sét", "Chớp", "Tia", "Điện", "Kiến", "Lạnh", "Tích", "Dây"],
  poison: ["Độc", "Mủ", "Thối", "Nấm", "Rùng", "Tế", "Hơi", "Chướng"],
  light: ["Quang", "Nắng", "Hào", "Kim", "Trăng", "Mai", "Chói", "Gương"],
  shadow: ["Ám", "Tối", "Huyền", "Khuất", "Đêm", "Câm", "Mù", "Tro"],
};

const QUALIFIER = [
  "Bạc", "Đồng", "Sắt", "Vàng", "Ngọc", "Thạch", "Tinh", "Ảnh",
  "Cổ", "Lạ", "Dị", "Hoang", "Sương", "Sương Giá", "Câm Lặng", "Bất Diệt",
  "Thủy Tinh", "Nham", "Đêm Khuya", "Sương Mai", "Gió Lùa", "Mưa Phùn",
];

/**
 * Flavour text, two sentences.
 *
 * Archetype says how it fights, element says what it is. Both are picked per
 * species and de-duplicated, so a 1005-strong registry does not read like the
 * same twelve sentences copied 1000 times.
 */
const BLURB_ARCHETYPE: Record<Archetype, string[]> = {
  tank: [
    "Thủ phòng thủ, chịu đòn tốt.",
    "Bền bỉ, khó lột da.",
    "Đứng vững tới cuối trận.",
    "Gánh đòn thay cả đội.",
    "Vỏ dày, lõi cứng.",
    "Không gục dễ dàng.",
    "Đón đòn như nước vào bê tông.",
    "Sống dai hơn cả đợt hạn hán.",
    "Gốc rễ sâu, khó nhổ.",
    "Chịu đau thành bản năng.",
    "Thân to, đòn không xuyên qua.",
    "Hồi máu nhanh khi còn đứng vững.",
    "Càng đánh càng chắc.",
    "Lá xanh kín từ gốc tới ngọn.",
  ],
  burst: [
    "Sát thương dồn một lúc.",
    "Chớp lên rồi tắt ngúm.",
    "Đòn nhất có thể kết thúc trận.",
    "Mạnh lớn nhưng mong manh.",
    "Nhanh và nóng.",
    "Một đâm trúng đủ quyết định.",
    "Tích lực rồi bung ra một lần.",
    "Chuẩn bị lâu, đánh mới đáng sợ.",
    "Đòn cuối luôn mạnh nhất.",
    "Hạ gục nhanh kẻ yếu.",
    "Mất một chút máu, đổi cả trận.",
    "Tập trung vào một mục tiêu.",
    "Đâm nhanh hơn đối thủ kịp phản ứng.",
    "Sống ngắn, nhưng đòn nặng.",
  ],
  sustain: [
    "Hồi phục kéo dài trận đấu.",
    "Rút dần máu theo thời gian.",
    "Vừa đánh vừa hồi.",
    "Kiên trì, khó chịu với đối thủ.",
    "Thắng bằng nhịp đều đặn dài hạn.",
    "Không bao giờ cạn.",
    "Vết thương tự khép lại.",
    "Càng đánh càng hồi.",
    "Sống dai nhờ đều đặn, không nhờ may mắn.",
    "Chậm bù mà chắc.",
    "Hồi phục tăng theo thời gian chờ.",
    "Đánh không ngừng để không rơi.",
    "Máu tụ lại như suối ngầm.",
    "Đánh lâu, thắng lớn.",
  ],
  control: [
    "Gây độc, làm chậm đối thủ.",
    "Kiềm soát nhịp ra chiêu.",
    "Đối thủ khỏng ra được chiêu nào.",
    "Ràng buộc tầm xa.",
    "Âm thầm làm suy giảm.",
    "Thắng bằng kiềm soát nhịp điệu.",
    "Kéo đối thủ vào tầm bắn.",
    "Chặn đường lui.",
    "Mỗi đòn trì hoãn là một lần thắng.",
    "Làm chậm đủ để đánh hai lần.",
    "Hút cạn nguồn lực đối phương.",
    "Ghim chân đối thủ tại chỗ.",
    "Không cần đánh mạnh, chỉ cần đánh đúng lúc.",
    "Ép đối thủ phải chơi theo nhịp của mình.",
  ],
  tempo: [
    "Nhanh và ép đầu.",
    "Ấp phản trước thế thủ.",
    "Cơ động thuần, thuần trước.",
    "Tấn công lần về.",
    "Không cho đối thủ kịp phản ứng.",
    "Ra chiêu liên tục.",
    "Nhịp đều như metronome.",
    "Không có nhịp nghỉ cho đối thủ.",
    "Tốc độ bù cho sát thương thấp.",
    "Vào trước, thắng trước.",
    "Giữ nhịp hoặc mất trận.",
    "Đánh nhanh hơn đối thủ kịp trở tay.",
    "Nhịp nhanh khiến thời gian đứng yên cũng là lãng phí.",
    "Tốc độ là vũ khí duy nhất.",
  ],
  counter: [
    "Phản đòn rất sắc.",
    "Đọc được đòn của đối thủ.",
    "Càng đánh càng lỗi.",
    "Trừng phạt đúng lúc.",
    "Chờ đòn rồi trả lại gấp đôi.",
    "Phản xạ nhanh nhất trận.",
    "Đòn đánh vào nó đều hại người ra.",
    "Thắng bằng cách đứng yên.",
    "Chỉ cần trúng một lần là xong.",
    "Biết trước đòn kế tiếp.",
    "Học đòn sau mỗi lần trúng đòn.",
    "Càng đánh càng yếu đối thủ.",
    "Biến lỗi của đối thủ thành đòn của mình.",
    "Phản công là cách duy nhất của nó.",
  ],
};

const BLURB_ELEMENT: Record<ElementId, string[]> = {
  wood: [
    "Rễ ăn sâu, sống dai.",
    "Lá xanh dày, gai sắc.",
    "Cành khỏe, hút nước tốt.",
    "Mọc nhanh khi có ánh sáng.",
    "Vỏ xanh chắc nịch.",
    "Nhựa chảy đều như máu.",
    "Gỗ dai, khó chẻ.",
    "Lá xoay theo nắng.",
    "Rễ bám chặt vào bậc đá.",
    "Đâm ra từ cành già cũng sống.",
    "Cành vươn tới chỗ có nắng.",
    "Lá xanh ngắc trước khi rụng.",
    "Gốc đẻ cây con khi bị chặt.",
    "Mùi gỗ tươi ngay khi bị thương.",
  ],
  fire: [
    "Nóng ran, cháy khi trúng đòn.",
    "Hơi nóng bốc lên từ đốt.",
    "Màu đỏ sẫm như tro.",
    "Bùng cháy khi bị kích.",
    "Cần hơi ấm mới nở.",
    "Tro rơi xuống đất và cháy tiếp.",
    "Nứt da ra ánh sáng bên trong.",
    "Cháy theo nhịp thở của nó.",
    "Hơi nóng làm đối thủ khô cháy.",
    "Đốt cháy mọi thứ chạm vào.",
    "Lửa trong tim chưa bao giờ tắt.",
    "Vỏ nứt, lõi vẫn đỏ.",
    "Hơi ấm kéo theo côn trùng.",
    "Càng bị đánh càng nóng.",
  ],
  water: [
    "Mọng nước, linh hoạt.",
    "Mang theo sương mềm.",
    "Rễ nông nhưng dai.",
    "Hút nước liên tục.",
    "Mềm, dễ uốn theo gió.",
    "Dính ướt quanh gốc.",
    "Nổi bọt khi bị kích động.",
    "Lá nhỏ nhiều, tốc độ cao.",
    "Mang theo giọt nước chảy.",
    "Đuối bởi cơn khô dài.",
    "Rễ bám vào bùn phía dưới.",
    "Sương đọng trên đầu ngọn.",
    "Chết khô trong nửa ngày.",
    "Càng ướt càng nhanh nhẹn.",
  ],
  earth: [
    "Rễ ăn vào đá nứt.",
    "Nặng, chậm, khó lay.",
    "Vỏ cứng như đá ong.",
    "Hút dinh dưỡng từ đất.",
    "Chịu khát rất tốt.",
    "Bám chặt, không bao giờ bị nhổ.",
    "Cát bám vào kẽ lá.",
    "Chậm chạp nhưng ít khi gục.",
    "Sẹo đá cũ hiện trên thân.",
    "Ngủ 3 tháng không cần nước.",
    "Đất bám quanh gốc thành bệ.",
    "Nặng trịch khi nước đầy.",
    "Vỏ nứt theo vân đất.",
    "Hút cạn cả tầng đất quanh nó.",
  ],
  electric: [
    "Tích điện trong không khí ẩm.",
    "Gây tê khi chạm.",
    "Phóng tia ngắn liền.",
    "Nhanh như tia chớp.",
    "Mạch dẩn sáng rõ.",
    "Rùng mình khi có sấm gần.",
    "Để lại vệt sáng trên không trung.",
    "Kêu răng rắc khi mọc lá.",
    "Hút tia chớp về phía mình.",
    "Điện chạy dọc theo gân lá.",
    "Tích điện theo độ ẩm không khí.",
    "Lông tĩnh trời đêm vẫn nổ.",
    "Mất điện khi rời khỏi mặt đất.",
    "Tia đi từ tay cành này sang cành kia.",
  ],
  poison: [
    "Mủ độc chảy trong gân.",
    "Mùi thối khi bị thương.",
    "Hạt độc rơi xuống đất.",
    "Gây độc theo thời gian.",
    "Nấm mọc ký sinh.",
    "Mùi tanh lan ra khi chuẩn bị tấn công.",
    "Rỉ độc xuống cả ô đất.",
    "Hoa nở ra là sinh vật khác héo.",
    "Đất quanh gốc mất cỏ.",
    "Bọc lấy kẻ tới gần.",
    "Gây tê từ xa, không cần chạm.",
    "Màu xám bệnh trên lá non.",
    "Càng lâu càng độc.",
    "Hơi độc nặng hơn sau trận.",
  ],
  light: [
    "Hút ánh sáng để lớn.",
    "Phát sáng trong bóng tối.",
    "Bề mặt ánh kim.",
    "Hoa nở vào ban ngày.",
    "Sáng bừng dưới sương.",
    "Đuổi theo bóng đèn.",
    "Cánh hoa trong như thủy tinh.",
    "Để lại vệt sáng khi bay.",
    "Hạt phấn lấp lánh.",
    "Nhiệt độ quanh nó tăng nhẹ.",
    "Càng nắng càng rực.",
    "Mở đúng lúc trời tối dần.",
    "Hút cạn sáng của đối thủ.",
    "Mùa nắng là mùa của nó.",
  ],
  shadow: [
    "Ẩn mình trong bóng tối.",
    "Hút bóng mà không cần sáng.",
    "Nở hoa về đêm.",
    "Lạnh và thối rữa dần.",
    "Mờ nhạt như sương đêm.",
    "Bóng của nó dài hơn của cây khác.",
    "Hút bóng đổ xuống gốc.",
    "Biến mất khi có ánh sáng trắng.",
    "Rễ bám vào vết tối dưới đất.",
    "Hơi lạnh kéo dài sau nó.",
    "Nở hoa khi trăng mờ.",
    "Càng lâu trong tối càng mạnh.",
    "Hút cạn sức sống của cây bên cạnh.",
    "Không để lại bóng khi bước đi.",
  ],
};

/** Third sentence — a quirk, so two species of the same build still read apart. */
const BLURB_QUIRK = [
  "Rất hiếm gặp ngoài tự nhiên.",
  "Chỉ ra hoa khi trời đổi mưa.",
  "Sống được cả trên đá trơn.",
  "Cánh hoa rụng theo đúng nhịp đánh.",
  "Thích bóng tối hơn ánh sáng.",
  "Càng gần nước càng hung dữ.",
  "Rễ bám chặt vào bất cứ thứ gì.",
  "Mùi thơm dị lúc mới nở.",
  "Lá xoay theo hướng gió.",
  "Bám vào vật gần nhất để leo.",
  "Ngủ suốt mùa khô rồi thức dậy.",
  "Trống rỗng bên trong, âm thanh vọng ra.",
  "Mọc từ rễ của một loài khác.",
  "Cây con mọc ra đã mang sẵn đòn đánh.",
  "Chết đi nhưng vẫn để lại gai.",
  "Đổi màu theo giờ trong ngày.",
  "Không chịu nước tước, chỉ chịu mưa.",
  "Toàn bộ cây là một khối rễ dày.",
  "Khi bị chạm vào thì phát ra tiếng.",
  "Thích bị chặt hơn bị nhổ.",
  "Mọc thành bụi chứ không mọc đơn.",
  "Càng chăm nhiều càng yếu đi.",
  "Chỉ sống được ở độ cao nhất định.",
  "Có tuổi thọ hai lần cây thường.",
  "Sẽ cho hoa đúng một lần rồi lụi.",
  "Hút nước của cây bên cạnh.",
  "Rụng lá đúng lúc đối thủ chuẩn bị đánh.",
  "Có khả năng tự tái tạo từ một chiếc lá.",
  "Mọc theo hình bóng của cây bên cạnh.",
  "Rất ghét bị chăm quá nhiều.",
];

const ARCHETYPES: readonly Archetype[] = ["tank", "burst", "sustain", "control", "tempo", "counter"];

const STEMS = ["thin", "slender", "normal", "thick", "vine", "lean", "braided"];
const LEAVES = ["broad", "narrow", "round", "serrated", "arrow", "lobed", "pinnate"];
const ROOTS = ["shallow", "deep", "fibrous", "climbing", "bulbous"];
const FLOWERS = ["none", "bud", "ember_core", "dew_bloom", "spore_ring", "star_flower", "double_bloom"];
const FRUITS = ["none", "pearl", "seedpod", "berry", "lantern"];
const THORNS = ["none", "fine", "barbed", "hooked", "poison_spur"];
const FUNGUS = ["none", "cap", "shelf", "ring", "bloom_mold"];
const AURAS = ["none", "warm_glow", "spark", "spore_dust", "dew", "shadow_haze", "halo"];
const PATTERNS = ["plain", "veined", "mottled", "spotted", "gradient", "rings"];
const SIZES = ["tiny", "small", "normal", "large", "colossal"];

/** Weight each archetype's skills so a generated species has a coherent kit. */
const ARCHETYPE_SKILLS: Record<Archetype, SkillGeneId[]> = {
  tank: ["melee", "trap", "shield", "aura"],
  burst: ["projectile", "dot", "melee", "aura"],
  sustain: ["heal", "shield", "control", "aura"],
  control: ["dot", "control", "trap", "aura"],
  tempo: ["chain", "projectile", "control", "melee"],
  counter: ["summon", "melee", "shield", "chain"],
};

const ARCHETYPE_STATS: Record<Archetype, StatGeneId[]> = {
  tank: ["hp", "defense", "evasion"],
  burst: ["attack", "crit", "speed"],
  sustain: ["hp", "skillPower", "defense"],
  control: ["skillPower", "hp", "evasion"],
  tempo: ["speed", "crit", "attack"],
  counter: ["defense", "crit", "skillPower"],
};

/**
 * The five size bands.
 *
 * Spelled out here rather than imported from the plant module, because the species
 * generator only reads it and importing a visual type into the registry would tie
 * the two together for no benefit.
 */
export type SpeciesSize = "tiny" | "small" | "normal" | "large" | "colossal";

/**
 * The size band a species falls into, read off its own stats.
 *
 * Derived rather than rolled so it cannot contradict the card: a plant with a lot
 * of health *is* a big plant, and if the two disagreed a player would eventually
 * meet a tiny-looking plant that took forty minutes and rightly stop trusting the
 * whole schedule.
 */
function sizeFor(statBias: Partial<Record<StatGeneId, number>>): SpeciesSize {
  const bulk = (statBias.hp ?? 0.5) * 0.6 + (statBias.defense ?? 0.5) * 0.4;
  if (bulk >= 0.82) return "colossal";
  if (bulk >= 0.66) return "large";
  if (bulk >= 0.44) return "normal";
  if (bulk >= 0.3) return "small";
  return "tiny";
}

/**
 * How long a species takes, in minutes, and what its seed costs.
 *
 * Both are pure functions of what the plant is, so a player who has seen a
 * `earth`/tank/colossal plant take half an hour can predict the next one. That is
 * the property that makes the numbers worth learning; a price and a timer drawn
 * from one shared random roll are not learnable at all.
 *
 * `grow` is computed first and `price` is derived from it, so the economy cannot
 * drift into charging a lot for something that grows in two minutes. The jitter is
 * a sixth of the base rather than a flat few minutes, so a slow species is slow by
 * a wide margin and a fast one is only slightly quicker — the spread between
 * archetypes has to survive the noise.
 */
function timingFor(archetype: Archetype, dominant: ElementId, size: SpeciesSize, rng: Rng): { growMinutes: number; seedPrice: number } {
  // Minutes. Deliberately overlapping between archetypes so that the element and
  // the size still decide something, but no archetype is a dead giveaway.
  const byArchetype: Record<Archetype, number> = {
    tank: 1.34,
    sustain: 1.2,
    counter: 1.06,
    control: 1.0,
    burst: 0.82,
    tempo: 0.76,
  };
  const byElement: Record<ElementId, number> = {
    earth: 1.24,
    wood: 1.14,
    water: 1.0,
    light: 0.98,
    poison: 0.94,
    shadow: 0.92,
    fire: 0.84,
    electric: 0.8,
  };
  const bySize: Record<SpeciesSize, number> = {
    colossal: 1.55,
    large: 1.22,
    normal: 1.0,
    small: 0.86,
    tiny: 0.74,
  };

  const base = 22 * byArchetype[archetype] * byElement[dominant] * bySize[size];
  // A sixth of the base, so a 40-minute species varies by nearly seven and a
  // 12-minute one by two. A flat jitter would have made the slow plants identical
  // and the fast ones all over the place.
  const grow = Math.round(base * (1 + rng.float(-0.08, 0.08)));

  // Roughly four coins per waiting minute, rounded to a tidy step so the shop does
  // not show prices like 1,137. The rounding is also what makes two species feel
  // like they belong to the same shelf.
  const raw = grow * 4.2 * rng.float(0.92, 1.1);
  const price = Math.max(60, Math.round(raw / 5) * 5);

  return { growMinutes: grow, seedPrice: price };
}

function generateSpecies(): SpeciesDef[] {
  const rng = new Rng("species-registry-v1");
  const out: SpeciesDef[] = [...STARTERS];
  const used = new Set<string>(STARTERS.map((s) => nameKey(s.name)));
  const usedBlurbs = new Set<string>(STARTERS.map((s) => s.blurb));
  /** How many times each element has been used as a dominant, for even rotation. */
  const secCount = new Map<ElementId, number>();
  /**
   * How many blurbs had to fall back to a numbered form.
   *
   * Zero is the target and it is exported rather than kept local so a test can
   * assert it: a registry of 6005 species with numbered blurbs is 6005 rows of
   * text that says nothing, and it would fail silently.
   */
  let blurbFallbacks = 0;

  for (let i = 0; i < GENERATED_SPECIES_COUNT; i++) {
    // Element and archetype cycle instead of being rolled. A fixed seed with
    // 1005 draws left earth at 96 species and light at 149 — the kind of skew
    // that makes one element feel thin and another feel repetitive.
    const archetype = ARCHETYPES[i % ARCHETYPES.length];
    const dominant = ELEMENTS[i % ELEMENTS.length];
    const others = ELEMENTS.filter((e) => e !== dominant);
    const seen = secCount.get(dominant) ?? 0;
    const secondary = others[seen % others.length];
    secCount.set(dominant, seen + 1);

    // Affinity: a strong primary, a real secondary, a trace of a third.
    // Normalised *after* the third element is added — adding it afterwards used
    // to leave the record summing to 1.05, which quietly skewed every affinity
    // calculation that reads it.
    const primaryShare = round2(rng.float(0.46, 0.72));
    const secondaryShare = round2(rng.float(0.14, 0.34));
    const elements: Partial<Record<ElementId, number>> = { [dominant]: primaryShare, [secondary]: secondaryShare };
    if (rng.bool(0.35)) {
      const third = rng.pick(ELEMENTS.filter((e) => e !== dominant && e !== secondary));
      elements[third] = 0.05;
    }
    const affinityTotal = Object.values(elements).reduce((a, b) => a + b, 0) || 1;
    for (const k of Object.keys(elements) as ElementId[]) elements[k] = round2((elements[k] ?? 0) / affinityTotal);

    // Name. Retried until it is unused, free of a repeated word, and distinct
    // ignoring accents — two names differing only by a diacritic are the same
    // name to a player, and the shelf is where they would sit side by side.
    let name = "";
    for (let attempt = 0; attempt < 60; attempt++) {
      const part = rng.pick(PART);
      const word = rng.pick(ELEMENT_WORD[dominant]);
      const qual = rng.bool(0.35) ? rng.pick(QUALIFIER) : "";
      // Flatten to words first: a multi-word qualifier can smuggle in a repeat —
      // "Đêm Khuya" beside the element word "Đêm" produced "Lưỡi Đêm Khuya Đêm".
      const words = (qual ? [part, qual, word] : [part, word]).flatMap((w) => w.split(" "));
      const keys = words.map((w) => nameKey(w));
      if (new Set(keys).size !== keys.length) continue;
      const candidate = words.join(" ");
      if (!used.has(nameKey(candidate))) {
        name = candidate;
        break;
      }
    }
    if (!name) name = `${rng.pick(PART)} ${rng.pick(ELEMENT_WORD[dominant])} #${i}`;
    used.add(nameKey(name));

    // Stat bias: archetype's own stats high, the rest lower. Every species still
    // has a full bias record so breeding maths never sees a missing gene.
    const statBias: Partial<Record<StatGeneId, number>> = {};
    const primary = ARCHETYPE_STATS[archetype];
    for (const g of STAT_GENES) {
      statBias[g] = round2(g === primary[0] ? rng.float(1.18, 1.4) : g === primary[1] ? rng.float(1.0, 1.2) : rng.float(0.55, 0.95));
    }

    const skillBias: Partial<Record<SkillGeneId, number>> = {};
    const kit = ARCHETYPE_SKILLS[archetype];
    for (const g of SKILL_GENES) skillBias[g] = g === kit[0] ? rng.float(1.3, 1.6) : g === kit[1] ? rng.float(1.0, 1.2) : rng.float(0.5, 0.95);

    const bodyBias: Partial<Record<BodyGeneId, string>> = {
      stem: rng.pick(STEMS),
      leaf: rng.pick(LEAVES),
      root: rng.pick(ROOTS),
      size: archetype === "tank" ? rng.weighted(SIZES, (s) => (s === "large" || s === "colossal" ? 3 : 1)) : rng.pick(SIZES),
    };
    // Trait decoration follows the archetype so a species looks like what it does.
    if (archetype === "tank" || archetype === "counter") bodyBias.thorn = rng.pick(THORNS.slice(1));
    if (archetype === "control" || archetype === "sustain") bodyBias.fungus = rng.bool(0.5) ? rng.pick(FUNGUS.slice(1)) : "none";
    if (archetype === "burst" || archetype === "sustain") bodyBias.flower = rng.pick(FLOWERS.slice(1));
    if (archetype === "sustain" || archetype === "tank") bodyBias.fruit = rng.bool(0.5) ? rng.pick(FRUITS.slice(1)) : "none";
    if (rng.bool(0.6)) bodyBias.aura = rng.pick(AURAS.slice(1));
    if (rng.bool(0.7)) bodyBias.pattern = rng.pick(PATTERNS.slice(1));

    // Rarer species cost more, grow slower, and sit behind a shop tier.
    // Five tiers over 1000 species, 200 each — `TIER_UNLOCK` in the shop has
    // five rungs, so a four-tier registry would leave the last one unreachable.
    // Even fifths, so the shop's tier filter still divides the shelf evenly. An
    // earlier attempt used a power curve for a "less exotic up top" feel and it
    // made the top filter hold 1637 species against the bottom's 608 — the filter
    // stops being a filter when one bucket is three times another.
    const tier = Math.min(4, Math.floor((5 * i) / GENERATED_SPECIES_COUNT));

    // Price follows build strength, so the shelf shows a spread of value
    // instead of 205 tier-0 species all priced 100. Mean stat bias runs about
    // 0.7 (glass) to 1.35 (glass cannon), mapped onto 0.92x-1.3x of base.
    //
    // The tier step (0.46, a 1.58x band) is deliberately a touch wider than the
    // within-tier spread (1.56x), so higher tiers are always dearer on average
    // and the gate reads as a ladder rather than an arbitrary wall.
    const biasMean =
      STAT_GENES.reduce((a, g) => a + (statBias[g] ?? 1), 0) / STAT_GENES.length;
    // The band below is not a guess: primary stat 1.18-1.40, secondary
    // 1.00-1.20, other five 0.55-0.95, averaged over 7 genes, so biasMean
    // lands in [0.68, 1.08]. Mapping from the wider [0.7, 1.35] instead pushed
    // every species into the bottom third and flattened the whole shop.
    const strength = clamp((biasMean - 0.68) / 0.4, 0, 1);
    const priceMul =
      (0.92 + strength * 0.38) * (1 + tier * 0.46) * rng.float(0.95, 1.05);
    const seedPrice = Math.round(clamp(100 * priceMul, 80, 950));

    // Flavour text gets its own stream. Retrying a blurb must not shift every
    // later gene roll, or fixing one duplicated sentence would silently retune
    // the whole registry.
    const blurbRng = new Rng(`blurb:${i}`);
    let blurb = "";
    for (let attempt = 0; attempt < 40; attempt++) {
      // 0, 1 or 2 quirks. Two is what makes the space large enough for 6000
      // species without writing another hundred sentences, and a two-quirk blurb
      // is the most interesting one to read anyway.
      const quirks = blurbRng.bool(0.55) ? blurbRng.pick(BLURB_QUIRK) : "";
      const extra = quirks && blurbRng.bool(0.3) ? blurbRng.pick(BLURB_QUIRK) : "";
      // Two identical quirks would read as a stutter.
      const quirkList = extra && extra !== quirks ? [quirks, extra] : quirks ? [quirks] : [];
      const candidate = [blurbRng.pick(BLURB_ARCHETYPE[archetype]), blurbRng.pick(BLURB_ELEMENT[dominant]), ...quirkList].join(" ");
      if (!usedBlurbs.has(candidate)) {
        blurb = candidate;
        break;
      }
    }
    if (!blurb) {
      // Ran out of distinct combinations. The numbered fallback keeps ids unique,
      // but it is also the signal that the pools need widening, so it is counted
      // rather than hidden.
      blurb = `${blurbRng.pick(BLURB_ARCHETYPE[archetype])} ${blurbRng.pick(BLURB_ELEMENT[dominant])} #${i}.`;
      blurbFallbacks++;
    }
    usedBlurbs.add(blurb);

    out.push({
      id: `sp${i.toString().padStart(4, "0")}`,
      unlock: speciesUnlock(i),
      ...timingFor(archetype, dominant, sizeFor(statBias), rng),
      name,
      seedPrice,
      elements,
      archetype,
      blurb,
      rarityHint: round2(clamp(0.08 + tier * 0.2 + rng.float(0, 0.12), 0, 1)),
      tier,
      statBias,
      bodyBias,
      skillBias,
    });
  }
  blurbFallbackCount = blurbFallbacks;
  return out;
}

/** Blurbs that hit the numbered fallback. Should be 0. */
export let blurbFallbackCount = 0;

/**
 * The unlock ladder for the generated registry.
 *
 * Pure function of the index, so a species keeps the same gate forever and the
 * shop can be reasoned about without replaying the game.
 *
 * Reads as a progression rather than a list:
 *
 *   0-4%      open from the start. A new player is not shown an empty shelf.
 *   4-14%     level 2-4, or a handful of plants in the ground.
 *   14-30%    level 5-9, and either a wider collection or a plant at growth level.
 *   30-52%    level 11-16, and a real collection.
 *   52-74%    level 19-25, and an awakened plant or a high generation.
 *   74-88%    level 28-34, and mastery of some kind.
 *   88-100%   level 38-46, and two of the three mastery milestones at once.
 *
 * Roughly a quarter of every band has no level requirement at all, which is the
 * point: the shop should answer "do something" at least as often as "wait".
 */
function speciesUnlock(i: number): UnlockReq | undefined {
  const r = new Rng(`unlock:${i}`);
  const f = i / GENERATED_SPECIES_COUNT;

  if (f < 0.04) return undefined;

  if (f < 0.14) {
    const level = 2 + Math.floor(f * 50);
    const plants = 3 + Math.floor(f * 12);
    // Two routes, picked per species. An earlier version of this had a
    // placeholder in the else branch that typed as `never`, which `checkUnlock`
    // read as "no requirement" — so half of this band was silently open from the
    // start. Every branch has to be a real requirement.
    return r.bool(0.5) ? { any: [{ k: "level", n: level }, { k: "plants", n: plants }] } : { k: "plants", n: plants };
  }
  if (f < 0.3) {
    const level = 5 + Math.floor((f - 0.14) * 25);
    return { all: [{ k: "level", n: level }], any: [{ k: "species", n: 3 + Math.floor((f - 0.14) * 14) }, { k: "growthLevel", n: 8 + Math.floor((f - 0.14) * 18) }] };
  }
  if (f < 0.52) {
    const level = 11 + Math.floor((f - 0.3) * 23);
    return { all: [{ k: "level", n: level }], any: [{ k: "species", n: 8 + Math.floor((f - 0.3) * 16) }, { k: "plants", n: 6 + Math.floor((f - 0.3) * 14) }] };
  }
  if (f < 0.74) {
    const level = 19 + Math.floor((f - 0.52) * 27);
    return {
      all: [{ k: "level", n: level }],
      any: [{ k: "awakened", n: 1 }, { k: "generation", n: 2 + Math.floor((f - 0.52) * 6) }, { k: "growthLevel", n: 20 + Math.floor((f - 0.52) * 12) }],
    };
  }
  if (f < 0.88) {
    const level = 28 + Math.floor((f - 0.74) * 43);
    return {
      all: [{ k: "level", n: level }],
      any: [{ k: "awakened", n: 1 + Math.floor((f - 0.74) * 8) }, { k: "generation", n: 3 + Math.floor((f - 0.74) * 8) }, { k: "species", n: 14 + Math.floor((f - 0.74) * 20) }],
    };
  }
  return {
    all: [{ k: "level", n: 38 + Math.floor((f - 0.88) * 66) }],
    any: [
      { k: "awakened", n: 2 + Math.floor((f - 0.88) * 20) },
      { k: "generation", n: 4 + Math.floor((f - 0.88) * 24) },
      { k: "species", n: 20 + Math.floor((f - 0.88) * 30) },
    ],
  };
}

/**
 * Fill in every gene a species is missing.
 *
 * The five starters were hand-written with only the genes that mattered for
 * their build, so `statBias.skillPower` came back `undefined`. Breeding maths
 * reads these with `?? 1` in most places, but not all of it, and a missing key
 * is a latent divide-by-undefined waiting for whoever touches it next. Filling
 * the holes once here means every downstream reader can index blindly.
 */
function completeBias<T extends string>(bias: Partial<Record<T, number>>, keys: readonly T[], fill: number): Record<T, number> {
  const out = {} as Record<T, number>;
  for (const k of keys) out[k] = bias[k] ?? fill;
  return out;
}

/** All species, starters first, with every gene present. Frozen: shared content. */
export const SPECIES: readonly SpeciesDef[] = Object.freeze(
  generateSpecies().map((s) => ({
    ...s,
    statBias: completeBias(s.statBias, STAT_GENES, 1),
    skillBias: completeBias(s.skillBias, SKILL_GENES, 1),
  })),
);

const BY_ID = new Map<SpeciesId, SpeciesDef>(SPECIES.map((s) => [s.id, s]));

/** Lookup by id. Falls back to the first starter so a bad save cannot crash. */
export function getSpecies(id: SpeciesId): SpeciesDef {
  return BY_ID.get(id) ?? STARTERS[0];
}

export function hasSpecies(id: SpeciesId): boolean {
  return BY_ID.has(id);
}

/**
 * Map-shaped view over the registry, for the many `SPECIES_BY_ID[id]` call sites.
 *
 * A Proxy rather than a plain object because a 1005-key object literal is built
 * every module load, and because the map already exists as the source of truth.
 * Unknown ids resolve to the first starter rather than throwing, so a save from
 * an older version cannot crash the game.
 */
export const SPECIES_BY_ID: Record<SpeciesId, SpeciesDef> = new Proxy(
  {} as Record<SpeciesId, SpeciesDef>,
  {
    get: (_t, key: string) => getSpecies(key),
    has: (_t, key: string) => BY_ID.has(key),
    ownKeys: () => [...BY_ID.keys()],
    getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }),
  },
);

/** Element affinity of a fresh, single-lineage seed (docs/16 §4). */
export function speciesAffinity(id: SpeciesId): Record<ElementId, number> {
  const src = getSpecies(id).elements;
  const out = {} as Record<ElementId, number>;
  for (const el of ELEMENTS) out[el] = src[el] ?? 0;
  // Keep the total at 1 so blending maths stays simple.
  const total = Object.values(out).reduce((a, b) => a + b, 0) || 1;
  for (const el of ELEMENTS) out[el] = out[el] / total;
  return out;
}