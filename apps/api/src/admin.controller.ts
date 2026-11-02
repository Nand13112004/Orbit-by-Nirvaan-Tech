import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Query, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { LeadStatus, Prisma, UserRole } from '@prisma/client';
import { z } from 'zod';
import { AuthGuard, CurrentUser, Roles, RolesGuard, SafeUser } from './common';
import { PrismaService } from './prisma.service';
import { AnalyticsCacheService } from './analytics-cache.service';

@Controller()
@UseGuards(AuthGuard)
export class AdminController {
  constructor(private readonly prisma: PrismaService, private readonly analyticsCache: AnalyticsCacheService) {}

  @Get('analytics')
  async analytics(@CurrentUser() user: SafeUser) {
    const cacheKey = `${user.id}:${user.role}`;
    const cached = this.analyticsCache.get<{
      totalLeads: number;
      byStatus: { status: LeadStatus; _count: { _all: number } }[];
      openFollowUps: number;
    }>(cacheKey);
    if (cached) return cached;
    const leadWhere: Prisma.LeadWhereInput = user.role === UserRole.ADMIN
      ? {}
      : user.role === UserRole.MANAGER
        ? { OR: [{ assigneeId: user.id }, { assignee: { managerId: user.id } }] }
        : { assigneeId: user.id };
    const followUpWhere: Prisma.FollowUpWhereInput = {
      completed: false,
      lead: leadWhere,
    };

    const [statusRows, followUpRows] = await Promise.all([
      this.prisma.lead.groupBy({
        by: ['status'],
        where: leadWhere,
        _count: { _all: true },
      }),
      this.prisma.followUp.count({ where: followUpWhere }),
    ]);
    const value = {
      totalLeads: statusRows.reduce((total, row) => total + row._count._all, 0),
      byStatus: statusRows.map(({ status, _count }) => ({ status, _count })),
      openFollowUps: followUpRows,
    };
    this.analyticsCache.set(cacheKey, value, 5_000);
    return value;
  }

  invalidateAnalyticsCache() {
    this.analyticsCache.invalidate();
  }

  @Get('follow-ups')
  listFollowUps(
    @CurrentUser() user: SafeUser,
    @Res({ passthrough: true }) response: Response,
    @Query('completed') completed?: string,
    @Query('take') takeValue?: string,
    @Query('page') pageValue?: string,
    @Query('dueFrom') dueFromValue?: string,
    @Query('dueBefore') dueBeforeValue?: string,
  ) {
    if (completed !== undefined && !['true', 'false', 'all'].includes(completed)) {
      throw new BadRequestException('completed must be true, false, or all');
    }
    const take = z.coerce.number().int().min(1).max(25).default(10).parse(takeValue);
    const page = z.coerce.number().int().min(1).max(100_000).default(1).parse(pageValue);
    const dueFrom = dueFromValue === undefined ? undefined : new Date(z.string().datetime().parse(dueFromValue));
    const dueBefore = dueBeforeValue === undefined ? undefined : new Date(z.string().datetime().parse(dueBeforeValue));
    if (dueFrom && dueBefore && dueFrom >= dueBefore) {
      throw new BadRequestException('dueFrom must be earlier than dueBefore');
    }
    const leadScope = user.role === UserRole.ADMIN
      ? {}
      : user.role === UserRole.MANAGER
        ? { OR: [{ assigneeId: user.id }, { assignee: { managerId: user.id } }] }
        : { assigneeId: user.id };
    const where = {
      ...(completed === 'all' ? {} : { completed: completed === 'true' }),
      ...(dueFrom || dueBefore ? {
        dueAt: {
          ...(dueFrom ? { gte: dueFrom } : {}),
          ...(dueBefore ? { lt: dueBefore } : {}),
        },
      } : {}),
      lead: leadScope,
    };
    return this.prisma.$transaction([
      this.prisma.followUp.findMany({
      where,
      select: {
        id: true,
        leadId: true,
        description: true,
        dueAt: true,
        completed: true,
        lead: { select: { id: true, name: true } },
      },
      orderBy: [{ dueAt: 'asc' }, { id: 'asc' }],
      skip: (page - 1) * take,
      take,
      }),
      this.prisma.followUp.count({ where }),
    ]).then(([items, total]) => {
      response.setHeader('X-Total-Count', String(total));
      response.setHeader('X-Page', String(page));
      response.setHeader('X-Page-Size', String(take));
      response.setHeader('X-Total-Pages', String(Math.ceil(total / take)));
      return items;
    });
  }

  @Get('sources')
  listSources() {
    return this.prisma.leadSource.findMany({ orderBy: { name: 'asc' } });
  }

  @Post('sources')
  @Roles(UserRole.ADMIN)
  @UseGuards(RolesGuard)
  async createSource(@CurrentUser() actor: SafeUser, @Body() body: unknown) {
    const { name } = z.object({ name: z.string().trim().min(1).max(100) }).parse(body);
    const source = await this.prisma.leadSource.create({ data: { name } });
    await this.prisma.auditLog.create({
      data: { actorId: actor.id, action: 'SOURCE_CREATED', entity: 'LeadSource', entityId: source.id },
    });
    return source;
  }

  @Patch('sources/:id')
  @Roles(UserRole.ADMIN)
  @UseGuards(RolesGuard)
  async updateSource(@CurrentUser() actor: SafeUser, @Param('id') id: string, @Body() body: unknown) {
    const { name } = z.object({ name: z.string().trim().min(1).max(100) }).parse(body);
    const source = await this.prisma.leadSource.update({ where: { id }, data: { name } });
    await this.prisma.auditLog.create({
      data: { actorId: actor.id, action: 'SOURCE_UPDATED', entity: 'LeadSource', entityId: id },
    });
    return source;
  }

  @Delete('sources/:id')
  @Roles(UserRole.ADMIN)
  @UseGuards(RolesGuard)
  async deleteSource(@CurrentUser() actor: SafeUser, @Param('id') id: string) {
    await this.prisma.leadSource.delete({ where: { id } });
    await this.prisma.auditLog.create({
      data: { actorId: actor.id, action: 'SOURCE_DELETED', entity: 'LeadSource', entityId: id },
    });
    return { deleted: true };
  }

  @Get('settings')
  @Roles(UserRole.ADMIN)
  @UseGuards(RolesGuard)
  settings() {
    return this.prisma.appSetting.findMany({ orderBy: { key: 'asc' } });
  }

  @Post('settings')
  @Roles(UserRole.ADMIN)
  @UseGuards(RolesGuard)
  async setSetting(@CurrentUser() actor: SafeUser, @Body() body: unknown) {
    const { key, value } = z.object({
      key: z.string().trim().min(1).max(100),
      value: z.string().max(2000),
    }).parse(body);
    const setting = await this.prisma.appSetting.upsert({
      where: { key },
      create: { key, value },
      update: { value },
    });
    await this.prisma.auditLog.create({
      data: { actorId: actor.id, action: 'SETTING_UPDATED', entity: 'AppSetting', entityId: key },
    });
    return setting;
  }
}
