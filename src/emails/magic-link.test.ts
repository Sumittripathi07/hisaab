import { expect, it } from "vitest";
import { magicLinkEmail } from "@/emails/magic-link";

const url = "http://localhost:3000/api/auth/magic-link/verify?token=abc&callbackURL=%2Fdashboard";

it("puts the link in both the html and the text, with the query's & escaped in html", () => {
  const mail = magicLinkEmail(url);
  expect(mail.subject).toBe("Your Hisaab sign-in link");
  expect(mail.text).toContain(url);
  expect(mail.html).toContain(url.replaceAll("&", "&amp;"));
  expect(mail.html).not.toContain("token=abc&callbackURL");
});

it("tells the reader the link lasts 10 minutes and can be ignored", () => {
  const { text } = magicLinkEmail(url);
  expect(text).toContain("10 minutes");
  expect(text).toContain("If you didn't ask for this, ignore this email");
});
