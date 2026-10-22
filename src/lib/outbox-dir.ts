import { relative, resolve, sep } from "node:path";

/**
 * The directory a `file://<dir>` SMTP_URL points at. A relative `file://./dir` resolves against process.cwd().
 * Throws for any other URL and for a dir that is the working directory or a parent of it, because the
 * test helpers delete this dir recursively. The message never includes the URL: it may hold credentials.
 * Imports nothing app-specific, so e2e can use it without loading the database.
 */
export function outboxDir(smtpUrl: string | undefined): string {
  const path = smtpUrl?.startsWith("file://") ? smtpUrl.slice("file://".length) : "";
  const dir = path && resolve(path);
  // relative(dir, cwd) only starts with ".." when cwd is not inside dir.
  if (!dir || relative(dir, process.cwd()).split(sep)[0] !== "..") {
    throw new Error("SMTP_URL must be file://<dir> for the file outbox, and <dir> must not be the working directory or a parent of it.");
  }
  return dir;
}
