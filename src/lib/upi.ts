import { formatDecimal } from "@/lib/money/format";

const NOTE_LENGTH = 50;

/**
 * A UPI deep link (INR only) that opens the payer's UPI app with the payee, amount and a note filled in. The UPI ID goes
 * in as is: the profile form only lets through `[a-z0-9._-]@[a-z0-9]`. Names encode spaces as %20, never "+".
 */
export function upiPayLink({ upiId, payeeName, amount, groupName }: { upiId: string; payeeName: string; amount: bigint; groupName: string }): string {
  // Cut by code point, so an emoji is never split in half (encodeURIComponent throws on a lone surrogate).
  const note = Array.from(`Hisaab: ${groupName}`).slice(0, NOTE_LENGTH).join("");
  const enc = encodeURIComponent;
  return `upi://pay?pa=${upiId}&pn=${enc(payeeName)}&am=${formatDecimal(amount, 2)}&cu=INR&tn=${enc(note)}`;
}
