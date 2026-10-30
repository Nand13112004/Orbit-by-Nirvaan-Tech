import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { AsyncLocalStorage } from 'node:async_hooks';

export const requestContext = new AsyncLocalStorage<{ requestId: string }>();

@Injectable()
export class PrismaService extends PrismaClient<Prisma.PrismaClientOptions, 'query'> implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super({ log: [{ emit: 'event', level: 'query' }] });
    this.$on('query', (event) => {
      const slow = event.duration >= 100;
      if (process.env.NODE_ENV === 'development' || slow) {
        console.info(JSON.stringify({
          event: 'database_query',
          requestId: requestContext.getStore()?.requestId,
          durationMs: event.duration,
          slow,
        }));
      }
    });
  }

  async onModuleInit() {
    await this.$connect();
    await this.$runCommandRaw({
      createIndexes: 'UserSession',
      indexes: [{
        key: { expiresAt: 1 },
        name: 'UserSession_expiresAt_ttl',
        expireAfterSeconds: 0,
      }],
    });
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
