// env.ts parses process.env eagerly at import, so this must run before any test imports it.
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgresql://hisaab:hisaab@localhost:5432/hisaab_test";
// Tests never send real email: the file transport writes here instead (relative to the working directory).
process.env.SMTP_URL = "file://./.test-outbox";
// Auth config. These are test values only; the Google ones are never sent anywhere.
process.env.BETTER_AUTH_SECRET = "test-secret-abcdefghijklmnopqrstuvwxyz0123456789";
process.env.BETTER_AUTH_URL = "http://localhost:3000";
process.env.GOOGLE_CLIENT_ID = "test-google-client-id";
process.env.GOOGLE_CLIENT_SECRET = "test-google-client-secret";
