import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';

const BATCH_SIZE = 500;

const tables = [
  { source: 'User', key: 'id', targetName: 'User', target: 'user' },
  { source: 'LeadSource', key: 'id', targetName: 'LeadSource', target: 'leadSource' },
  { source: 'LeadSource', key: 'id', targetName: 'LeadSource', target: 'leadSource' },
  { source: 'Lead', key: 'id', targetName: 'Lead', target: 'lead' },
  { source: 'LeadNote', key: 'id', targetName: 'LeadNote', target: 'leadNote' },
  { source: 'FollowUp', key: 'id', targetName: 'FollowUp', target: 'followUp' },
  { source: 'AppSetting', key: 'key', targetName: 'AppSetting', target: 'appSetting' },
  { source: 'AuditLog', key: 'id', targetName: 'AuditLog', target: 'auditLog' },
] as const;

function requireTargetConfirmation(uri: string): string {
  const databaseName = decodeURIComponent(new URL(uri).pathname.replace(/^\//, '').split('/')[0] ?? '');
  const confirmation = process.argv.find((argument) => argument.startsWith('--target-db='))?.slice('--target-db='.length);
  if (!databaseName || confirmation !== databaseName) {
    throw new Error('Pass --target-db=<database name> matching the database in MONGODB_URI.');
  }
  return databaseName;
}

async function main() {
  const mongoUri = process.env.MONGODB_URI;
  const postgresUri = process.env.POSTGRES_SOURCE_URL ?? process.env.DATABASE_URL;
  if (!mongoUri || !postgresUri) {
    throw new Error('Set MONGODB_URI and POSTGRES_SOURCE_URL before running this data-copy script.');
  }
  const targetDatabase = requireTargetConfirmation(mongoUri);
  const source = new Pool({
    connectionString: postgresUri,
    ssl: { rejectUnauthorized: true },
    max: 1,
    connectionTimeoutMillis: 10_000,
  });
  const target = new PrismaClient();
  const sourceClient = await source.connect();

  try {
    await target.$connect();

    const currentTargetCounts = await Promise.all(
      tables.map(async (table) => {
        const delegate = (target as unknown as Record<string, { count(): Promise<number> }>)[table.target];
        return { collection: table.targetName, count: await delegate.count() };
      }),
    );
    if (currentTargetCounts.some(({ count }) => count !== 0)) {
      throw new Error('The target collections are not empty. No target documents were written. Use a dedicated empty Atlas database.');
    }

    // A consistent source snapshot prevents cross-table references from being
    // copied from different points in time. Pause application writes during
    // this copy and the final cutover.
    await sourceClient.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const copied: Array<{ collection: string; count: number }> = [];

    for (const table of tables) {
      const totalResult = await sourceClient.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM "${table.source}"`,
      );
      const expectedCount = Number(totalResult.rows[0]?.count ?? 0);
      let lastKey: string | undefined;
      let copiedCount = 0;

      while (true) {
        const result = lastKey === undefined
          ? await sourceClient.query(
              `SELECT * FROM "${table.source}" ORDER BY "${table.key}" ASC LIMIT $1`,
              [BATCH_SIZE],
            )
          : await sourceClient.query(
              `SELECT * FROM "${table.source}" WHERE "${table.key}" > $1 ORDER BY "${table.key}" ASC LIMIT $2`,
              [lastKey, BATCH_SIZE],
            );
        if (result.rows.length === 0) break;

        const delegate = (target as unknown as Record<string, {
          createMany(args: { data: unknown[] }): Promise<{ count: number }>;
        }>)[table.target];
        const inserted = await delegate.createMany({ data: result.rows });
        if (inserted.count !== result.rows.length) {
          throw new Error(`Copy count mismatch while importing ${table.targetName}.`);
        }
        copiedCount += inserted.count;
        lastKey = String(result.rows[result.rows.length - 1][table.key]);
      }

      if (copiedCount !== expectedCount) {
        throw new Error(`Source and copied counts differ for ${table.targetName}.`);
      }
      copied.push({ collection: table.targetName, count: copiedCount });
    }

    await sourceClient.query('COMMIT');

    const verified = await Promise.all(
      tables.map(async (table) => {
        const delegate = (target as unknown as Record<string, { count(): Promise<number> }>)[table.target];
        return { collection: table.targetName, count: await delegate.count() };
      }),
    );
    for (let index = 0; index < copied.length; index++) {
      if (copied[index].count !== verified[index].count) {
        throw new Error(`Post-copy verification failed for ${copied[index].collection}.`);
      }
    }

    console.info(JSON.stringify({
      result: 'copy-complete',
      targetDatabase,
      copied,
      verified,
      sessionsCopied: false,
    }, null, 2));
  } catch (error) {
    try {
      await sourceClient.query('ROLLBACK');
    } catch {
      // The source transaction may already have committed or failed to begin.
    }
    throw error;
  } finally {
    sourceClient.release();
    await source.end();
    await target.$disconnect();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown migration error';
  console.error(message.replace(/(?:mongodb(?:\+srv)?|postgres(?:ql)?:)\/\/[^\s]+/gi, '[redacted database URI]'));
  process.exitCode = 1;
});
