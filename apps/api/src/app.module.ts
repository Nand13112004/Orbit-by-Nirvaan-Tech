import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { PrismaService } from './prisma.service';
import { AuthGuard, RolesGuard } from './common';
import { AuthController } from './auth.controller';
import { LeadsController } from './leads.controller';
import { UsersController } from './users.controller';
import { AdminController } from './admin.controller';
import { AnalyticsCacheService } from './analytics-cache.service';
import { HealthController } from './health.controller';
import { ChatController } from './chat.controller';

@Module({
  imports: [ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }])],
  controllers: [AuthController, LeadsController, UsersController, AdminController, HealthController, ChatController],
  providers: [
    PrismaService,
    AnalyticsCacheService,
    AuthGuard,
    RolesGuard,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
