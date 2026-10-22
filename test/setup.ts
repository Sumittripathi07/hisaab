// env.ts parses process.env eagerly at import, so this must run before any test imports it.
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgresql://hisaab:hisaab@localhost:5432/hisaab_test";
// Tests never send real email: the file transport writes here instead (relative to the working directory).
process.env.SMTP_URL = "file://./.test-outbox";
