/** Empties every table in `public` except Prisma's migration history. e2e's global setup runs it too. */
export const TRUNCATE_ALL = `
  DO $$
  DECLARE t text;
  BEGIN
    FOR t IN
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
    LOOP
      EXECUTE format('TRUNCATE TABLE %I RESTART IDENTITY CASCADE', t);
    END LOOP;
  END $$;
`;

export async function resetDb(): Promise<void> {
  // Imported here, not at the top, so e2e can import TRUNCATE_ALL without loading the app's env and database.
  const { db } = await import("@/lib/db");
  await db.$executeRawUnsafe(TRUNCATE_ALL);
}
