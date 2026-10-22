import { randomBytes } from "node:crypto";

/** A short, URL-safe code for invite links: 11 characters. */
export const newInviteCode = (): string => randomBytes(8).toString("base64url");

/** The secret in a placeholder's claim link: 32 characters. */
export const newClaimToken = (): string => randomBytes(24).toString("base64url");
