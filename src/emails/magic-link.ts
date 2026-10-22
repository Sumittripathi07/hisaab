const escapeHtml = (s: string) =>
  s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

/** The sign-in email: a centred card with one button. The link lasts 10 minutes (set in auth.ts). */
export function magicLinkEmail(url: string): { subject: "Your Hisaab sign-in link"; html: string; text: string } {
  const href = escapeHtml(url);
  return {
    subject: "Your Hisaab sign-in link",
    html: `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:32px 16px;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#18181b;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:420px;background:#ffffff;border-radius:16px;padding:32px;">
            <tr>
              <td align="center">
                <p style="margin:0 0 24px;font-size:22px;font-weight:700;letter-spacing:-0.02em;">Hisaab<span style="color:#059669;">.</span></p>
                <h1 style="margin:0 0 8px;font-size:20px;line-height:28px;font-weight:600;">Sign in to Hisaab</h1>
                <p style="margin:0 0 24px;font-size:15px;line-height:22px;color:#52525b;">Tap the button to sign in. This link works once and is valid for 10 minutes.</p>
                <a href="${href}" style="display:inline-block;background:#059669;color:#ffffff;text-decoration:none;font-size:16px;font-weight:600;padding:14px 28px;border-radius:12px;">Sign in to Hisaab</a>
                <p style="margin:24px 0 0;font-size:13px;line-height:20px;color:#71717a;">If you didn't ask for this, ignore this email. Nobody can sign in without the link.</p>
                <p style="margin:16px 0 0;font-size:12px;line-height:18px;color:#a1a1aa;word-break:break-all;">Button not working? Paste this into your browser:<br>${href}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`,
    text: `Sign in to Hisaab

Open this link to sign in. It works once and is valid for 10 minutes:
${url}

If you didn't ask for this, ignore this email. Nobody can sign in without the link.
`,
  };
}
