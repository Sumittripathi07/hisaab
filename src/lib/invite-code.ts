const CODE = /^[\w-]{4,64}$/;

/**
 * The invite code in whatever someone pasted: a full invite link ("https://…/join/abc?x=1"), a message that
 * contains one, or the bare code. Null when there's no plausible code.
 */
export function inviteCodeFrom(input: string): string | null {
  const text = input.trim();
  const code = text.match(/\/join\/([^/?#\s]+)/)?.[1] ?? text;
  return CODE.test(code) ? code : null;
}
