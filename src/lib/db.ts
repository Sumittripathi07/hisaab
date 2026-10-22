import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { env } from "@/lib/env";

// Neither the adapter nor the client connects until the first query, so importing this is safe at build time.
const globalForDb = globalThis as unknown as { db?: PrismaClient };

export const db =
  globalForDb.db ??
  new PrismaClient({
    // A bounded connect, so an unreachable database fails fast (/api/health answers 503) instead of hanging the request.
    adapter: new PrismaPg({ connectionString: env.DATABASE_URL, max: 5, connectionTimeoutMillis: 5_000 }),
  });

// Reuse one client across dev hot reloads so we don't leak pools.
if (env.NODE_ENV !== "production") globalForDb.db = db;
