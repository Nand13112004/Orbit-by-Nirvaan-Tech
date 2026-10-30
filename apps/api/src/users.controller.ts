import {
  Body,
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  Query,
  NotFoundException,
  Param,
  Patch,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import { hash } from 'argon2';
import { z } from 'zod';
import { AuthGuard, CurrentUser, Roles, RolesGuard, SafeUser, safeUser } from './common';
import { strongPassword } from './password';
import { PrismaService } from './prisma.service';
import { Response } from 'express';
import { AnalyticsCacheService } from './analytics-cache.service';

@Controller('users')
@UseGuards(AuthGuard)
export class UsersController {
  constructor(private readonly prisma: PrismaService, private readonly analyticsCache: AnalyticsCacheService) {}

  @Get()
  async list(
    @CurrentUser() user: SafeUser,
    @Res({ passthrough: true }) response: Response,
    @Query('page') pageValue?: string,
    @Query('search') searchValue?: string,
    @Query('active') activeValue?: string,
  ) {
    const query = z.object({
      page: z.coerce.number().int().min(1).max(100_000).default(1),
      search: z.string().trim().max(100).default(''),
      active: z.enum(['true', 'false', 'all']).default('all'),
    }).parse({ page: pageValue, search: searchValue ?? '', active: activeValue });
    const roleScope: Prisma.UserWhereInput = user.role === UserRole.ADMIN
        ? {}
        : user.role === UserRole.MANAGER
          ? { OR: [{ id: user.id }, { managerId: user.id }] }
          : { id: user.id };
    const filters: Prisma.UserWhereInput[] = [roleScope];
    if (query.active !== 'all') filters.push({ active: query.active === 'true' });
    if (query.search) filters.push({ OR: [
        { name: { contains: query.search, mode: 'insensitive' } },
        { email: { contains: query.search, mode: 'insensitive' } },
      ] });
    const where: Prisma.UserWhereInput = { AND: filters };
    const pageSize = 50;
    const [users, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        select: { id: true, name: true, email: true, role: true, active: true, managerId: true },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        skip: (query.page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.user.count({ where }),
    ]);
    response.setHeader('X-Total-Count', String(total));
    response.setHeader('X-Page', String(query.page));
    response.setHeader('X-Page-Size', String(pageSize));
    response.setHeader('X-Total-Pages', String(Math.ceil(total / pageSize)));
    return users;
  }

  @Post()
  @Roles(UserRole.ADMIN)
  @UseGuards(RolesGuard)
  async create(@CurrentUser() actor: SafeUser, @Body() body: unknown) {
    const schema = z.object({
      name: z.string().trim().min(1).max(120),
      email: z.string().email().max(254),
      password: strongPassword,
      role: z.enum(['MANAGER', 'MEMBER']),
      managerId: z.string().optional().nullable(),
    });
    const data = schema.parse(body);
    if (data.role === 'MEMBER' && data.managerId) {
      const manager = await this.prisma.user.findFirst({
        where: { id: data.managerId, role: UserRole.MANAGER, active: true },
      });
      if (!manager) throw new NotFoundException('Manager not found');
    } else if (data.role === 'MANAGER' && data.managerId) {
      throw new ForbiddenException('Managers cannot be assigned a manager');
    }
    const result = await this.prisma.$transaction(async (transaction) => {
      const created = await transaction.user.create({
        data: {
          name: data.name,
          email: data.email.trim().toLowerCase(),
          passwordHash: await hash(data.password, { type: 2 }),
          role: data.role,
          managerId: data.role === 'MEMBER' ? data.managerId : null,
        },
      });
      await transaction.auditLog.create({
        data: { actorId: actor.id, action: 'USER_CREATED', entity: 'User', entityId: created.id },
      });
      return created;
    });
    this.analyticsCache.invalidate();
    return safeUser(result);
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  async update(@CurrentUser() actor: SafeUser, @Param('id') id: string, @Body() body: unknown) {
    if (actor.role !== UserRole.ADMIN) throw new ForbiddenException('Only admins can manage users');
    const data = z.object({
      name: z.string().trim().min(1).max(120).optional(),
      role: z.nativeEnum(UserRole).optional(),
      active: z.boolean().optional(),
      managerId: z.string().nullable().optional(),
    }).parse(body);
    const target = await this.prisma.user.findUnique({ where: { id } });
    if (!target) throw new NotFoundException('User not found');
    const updated = await this.prisma.$transaction(async (transaction) => {
      const current = await transaction.user.findUniqueOrThrow({ where: { id } });
      if (
        actor.id === id &&
        (data.role !== undefined || data.active !== undefined || data.managerId !== undefined)
      ) {
        throw new ForbiddenException('Admins cannot change their own role, status, or team assignment');
      }
      const nextRole = data.role ?? current.role;
      if (
        current.role === UserRole.ADMIN &&
        current.active &&
        (nextRole !== UserRole.ADMIN || data.active === false)
      ) {
        const activeAdmins = await transaction.user.count({
          where: { role: UserRole.ADMIN, active: true },
        });
        if (activeAdmins <= 1) throw new ForbiddenException('At least one active admin must remain');
      }
      if (current.role === UserRole.MANAGER && (nextRole !== UserRole.MANAGER || data.active === false)) {
        const teamSize = await transaction.user.count({
          where: { managerId: id, role: UserRole.MEMBER },
        });
        if (teamSize > 0) {
          throw new BadRequestException('Reassign team members before changing or disabling this manager');
        }
      }
      if (nextRole === UserRole.MEMBER && data.managerId) {
        const manager = await transaction.user.findFirst({
          where: { id: data.managerId, role: UserRole.MANAGER, active: true },
        });
        if (!manager) throw new NotFoundException('Manager not found');
      }
      if (nextRole !== UserRole.MEMBER) data.managerId = null;
      const user = await transaction.user.update({ where: { id }, data });
      await transaction.auditLog.create({
        data: { actorId: actor.id, action: 'USER_UPDATED', entity: 'User', entityId: id },
      });
      return user;
    });
    this.analyticsCache.invalidate();
    return safeUser(updated);
  }

  @Post(':id/reset-password')
  @Roles(UserRole.ADMIN)
  @UseGuards(RolesGuard)
  async resetPassword(@CurrentUser() actor: SafeUser, @Param('id') id: string, @Body() body: unknown) {
    const { newPassword } = z.object({ newPassword: strongPassword }).parse(body);
    const target = await this.prisma.user.findUnique({ where: { id } });
    if (!target) throw new NotFoundException('User not found');
    await this.prisma.$transaction(async (transaction) => {
      await transaction.user.update({
        where: { id },
        data: { passwordHash: await hash(newPassword, { type: 2 }) },
      });
      await transaction.userSession.deleteMany({ where: { userId: id } });
      await transaction.auditLog.create({
        data: { actorId: actor.id, action: 'PASSWORD_RESET', entity: 'User', entityId: id },
      });
    });
    return { reset: true };
  }
}
