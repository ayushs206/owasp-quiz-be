import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

export type DatabaseProbe = () => Promise<unknown>;

export function createDatabaseReadinessCheck(
  probe: DatabaseProbe = async () => prisma.$queryRaw`SELECT 1`,
): () => Promise<{ ready: boolean; detail?: string }> {
  return async () => {
    try {
      await probe();
      return { ready: true };
    } catch {
      return { ready: false, detail: 'PostgreSQL is unavailable.' };
    }
  };
}

export const checkDatabaseReadiness = createDatabaseReadinessCheck();
