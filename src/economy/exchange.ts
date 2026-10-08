/**
 * Quy đổi tiền tệ — đổi loại tiền này sang loại khác (docs/16).
 *
 * Bốn loại tiền gắn với bốn hoạt động, và cửa hàng tính giá theo từng loại — đó là
 * thiết kế có chủ đích, và quy đổi không được phép xoá nó. Nên bảng tỉ giá dưới đây
 * được xây để "đổi luôn lỗ hơn đi kiếm trực tiếp":
 *
 *   - **LEAF_VALUE** là giá trị chuẩn của 1 đơn vị, quy về Xu lá. Mật ong ngang xu
 *     vì chăm cây không giới hạn và gần như miễn phí; Phấn hoa đắt gấp 8 vì lai tạo
 *     tốn phí và thời gian; Mảnh lửa 300 vì cả ngày chỉ rớt được tối đa 3.
 *
 *   - **EXCHANGE_FEE 20%** lấy đi một phần giá trị mỗi lần đổi. Đổi hai chiều luôn
 *     lỗ — 100 xu → 80 mật → 64 xu — nên không có vòng lặp sinh lời, và người chăm
 *     đúng hoạt động vẫn là người được trả tốt nhất.
 *
 *   - **EXCHANGE_DAILY_CAP** giới hạn tổng giá trị đổi trong một ngày, tính theo
 *     tiền *bỏ vào* quy ra xu. Đủ để đổi một ô đất tầng đầu hay vài hạt trong ngày,
 *     nhưng ô tầng ba phải tích qua vài ngày — một hoạt động grind suốt không thể
 *     gánh cả nền kinh tế.
 *
 *   - **Mảnh lửa chỉ đổi ra, không đổi vào.** Cap 3/ngày của nó tồn tại để giá
 *     nghìn lửa là một mục tiêu dài hạn; cho phép đổi vào sẽ biến khan hiếm đó
 *     thành một phép tính. Cây giá 🔥 vẫn chỉ mua bằng 🔥.
 *
 * Số nguyên hết — tỉ giá 20% được viết thành ×4/5 thay vì nhân số thập phân, để một
 * giá 0.80000004 không bao giờ trở thành "thiếu 1" trên nút mua.
 */

import { CURRENCY_IDS, type CurrencyId } from "../core/currency";

/** Giá trị chuẩn của 1 đơn vị tiền, quy ra Xu lá. Nguồn chân lý duy nhất cho mọi quy đổi. */
export const LEAF_VALUE: Record<CurrencyId, number> = {
  leafCoin: 1,
  nectar: 1,
  pollen: 8,
  ember: 300,
};

/**
 * Phí quy đổi, phần giá trị bị mất mỗi lần đổi.
 *
 * In ra cho người chơi là `EXCHANGE_FEE * 100`%, nhưng toán bên dưới dùng
 * `(5 - EXCHANGE_FEE * 5)`/`5` — tức ×4/5 ở phí 20% — để giữ phép tính nguyên.
 */
export const EXCHANGE_FEE = 0.2;

/**
 * Tổng giá trị được đổi trong một ngày, tính bằng Xu lá trên phần tiền bỏ vào.
 *
 * 3.000 là đủ cho một ô vườn tầng đầu (900-1.400) hoặc vài hạt, nhưng ô tầng ba
 * (7.400+) phải đổi qua nhiều ngày — cap là bộ đếm ngày, không phải bức tường.
 */
export const EXCHANGE_DAILY_CAP = 3000;

/**
 * Các loại tiền `from` có thể đổi thành.
 *
 * Mảnh lửa không bao giờ nằm trong danh sách này: chỉ đổi ra, không đổi vào, và đó
 * là quy tắc của cả bảng tỉ giá lẫn mọi màn hình gọi nó.
 */
export function exchangeTargets(from: CurrencyId): CurrencyId[] {
  return CURRENCY_IDS.filter((id) => id !== from && id !== "ember");
}

export interface ExchangeQuote {
  /** Số tiền `to` nhận được sau phí. */
  out: number;
  /** Giá trị phần bỏ vào quy ra xu — thứ bị trừ vào hạn mức ngày. */
  leafIn: number;
}

/**
 * Tính một lệnh đổi: `amountIn` của `from` nhận được bao nhiêu `to`.
 *
 * Trả `null` cho mọi lệnh không hợp lệ — cùng loại, đổi vào Mảnh lửa, số lượng
 * không phải số nguyên dương — để màn hình và store khỏi lặp lại danh sách điều
 * kiện. `out` có thể là 0 khi đổi quá ít (1 xu → 0 phấn); store từ chối riêng với
 * lý do đọc được, còn màn hình vẫn hiển thị được con số.
 */
export function quoteExchange(from: CurrencyId, to: CurrencyId, amountIn: number): ExchangeQuote | null {
  if (!Number.isInteger(amountIn) || amountIn < 1) return null;
  if (from === to || to === "ember") return null;
  const leafIn = amountIn * LEAF_VALUE[from];
  return { out: Math.floor((leafIn * 4) / (5 * LEAF_VALUE[to])), leafIn };
}

/**
 * Giá tương đương: để trả `price` của `currency` thì cần tốn bao nhiêu `payWith`
 * qua quy đổi (đã gồm phí).
 *
 * Ngược của `quoteExchange`: cần đủ `payWith` để lệnh đổi trả ra ≥ `price`. Dùng
 * cho dòng "≈ X 🪙" trên card — một tham khảo trung thực, không phải một nút mua.
 * Trả `null` khi không có đường đổi (cùng loại, hoặc giá đang bằng Mảnh lửa).
 */
export function costIn(price: number, currency: CurrencyId, payWith: CurrencyId): number | null {
  if (!Number.isFinite(price) || price < 0) return null;
  if (payWith === currency) return Math.ceil(price);
  if (currency === "ember") return null;
  // leafNeeded × 4/5 ≥ price × LEAF_VALUE[currency]  →  ceil ngược lên.
  const leafNeeded = Math.ceil((price * 5 * LEAF_VALUE[currency]) / 4);
  return Math.ceil(leafNeeded / LEAF_VALUE[payWith]);
}

/**
 * Nhiều nhất có thể bỏ vào một lệnh đổi, chịu hai giới hạn: số dư và hạn mức ngày
 * còn lại. Trả về cho nút "Tối đa" — một con số người chơi thật sự đổi được.
 */
export function maxExchangeIn(from: CurrencyId, balance: number, leafAllowanceLeft: number): number {
  const byCap = Math.floor(leafAllowanceLeft / LEAF_VALUE[from]);
  return Math.max(0, Math.min(Math.floor(balance), byCap));
}
