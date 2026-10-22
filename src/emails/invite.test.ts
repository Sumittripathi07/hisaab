import { expect, it } from "vitest";
import { inviteEmail } from "@/emails/invite";

const claimUrl = "http://localhost:3000/claim/abc_DEF-123";

it("names the inviter and group in the subject and puts the claim link in both parts", () => {
  const mail = inviteEmail({ inviterName: "Asha", groupName: "Goa Trip", claimUrl });
  expect(mail.subject).toBe("Asha added you to Goa Trip on Hisaab");
  expect(mail.text).toContain(claimUrl);
  expect(mail.html).toContain(`href="${claimUrl}"`);
});

it("escapes names in the html so a group name can't inject markup", () => {
  const { html, text } = inviteEmail({ inviterName: "<b>Asha</b>", groupName: 'Q&A "Trip"', claimUrl });
  expect(html).not.toContain("<b>Asha</b>");
  expect(html).toContain("&lt;b&gt;Asha&lt;/b&gt;");
  expect(html).toContain("Q&amp;A &quot;Trip&quot;");
  expect(text).toContain('Q&A "Trip"');
});
