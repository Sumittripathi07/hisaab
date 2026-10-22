import { db } from "@/lib/db";

/** Empties every table in `public` except Prisma's migration history. */
export async function resetDb(): Promise<void> {
  await db.$executeRawUnsafe(`
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
  `);
}
