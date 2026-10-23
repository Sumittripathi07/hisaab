import { describe, expect, it } from "vitest";
import { upiPayLink } from "@/lib/upi";

describe("upiPayLink", () => {
  it("builds the UPI link", () =>
    expect(upiPayLink({ upiId: "asha@okicici", payeeName: "Asha", amount: 33333n, groupName: "Goa Trip" })).toBe(
      "upi://pay?pa=asha@okicici&pn=Asha&am=333.33&cu=INR&tn=Hisaab%3A%20Goa%20Trip",
    ));

  it("encodes names", () =>
    expect(upiPayLink({ upiId: "a@ok", payeeName: "Asha & Co", amount: 1n, groupName: "x" })).toContain("pn=Asha%20%26%20Co&am=0.01"));

  it("keeps the note within 50 characters", () => {
    // Emoji are two UTF-16 units each: cutting by units would split one and make encodeURIComponent throw.
    const link = upiPayLink({ upiId: "a@ok", payeeName: "Asha", amount: 1n, groupName: "😀".repeat(60) });
    const note = decodeURIComponent(link.split("&tn=")[1]);
    expect(Array.from(note)).toHaveLength(50);
    expect(note).toBe(`Hisaab: ${"😀".repeat(42)}`);
  });
});
