import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  BadRequestException,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { LeadStatus, Prisma, UserRole } from '@prisma/client';
import { z } from 'zod';
import { AuthGuard, AuthRequest, CurrentUser, SafeUser } from './common';
import { PrismaService } from './prisma.service';
import { AnalyticsCacheService } from './analytics-cache.service';

const leadSchema = z.object({
  name: z.string().trim().min(1).max(160),
  email: z.string().email().max(254).optional().nullable(),
  phone: z.string().max(40).optional().nullable(),
  company: z.string().max(160).optional().nullable(),
  other: z.string().max(2000).optional().nullable(),
  status: z.nativeEnum(LeadStatus).optional(),
  sourceId: z.string().optional().nullable(),
  assigneeId: z.string().optional(),
});
const noteSchema = z.object({ content: z.string().trim().min(1).max(5000) });
const followUpSchema = z.object({
  dueAt: z.string().datetime(),
  description: z.string().trim().min(1).max(2000),
  destination: z.string().url().max(2048).refine((value) => new URL(value).protocol === 'https:', 'Destination must use HTTPS').optional().nullable(),
});

@Controller('leads')
@UseGuards(AuthGuard)
export class LeadsController {
  constructor(private readonly prisma: PrismaService, private readonly analyticsCache: AnalyticsCacheService) {}

  private whereFor(user: SafeUser): Prisma.LeadWhereInput {
    if (user.role === UserRole.ADMIN) return {};
    if (user.role === UserRole.MEMBER) return { assigneeId: user.id };
    return { OR: [{ assigneeId: user.id }, { assignee: { managerId: user.id } }] };
  }

  private async ensureLead(user: SafeUser, id: string, includeDetails = false) {
    const where = { id, ...this.whereFor(user) };
    const lead = includeDetails
      ? await this.prisma.lead.findFirst({
          where,
          include: {
            assignee: { select: { id: true, name: true } },
            source: { select: { id: true, name: true } },
            notes: {
              take: 50,
              orderBy: { createdAt: 'desc' },
              include: { author: { select: { id: true, name: true } } },
            },
            followUps: { take: 25, orderBy: { dueAt: 'asc' } },
          },
        })
      : await this.prisma.lead.findFirst({ where, select: { id: true } });
    if (!lead) throw new NotFoundException('Lead not found');
    return lead;
  }

  @Get()
  async list(
    @CurrentUser() user: SafeUser,
    @Query('page') pageValue?: string,
    @Query('search') searchValue?: string,
    @Query('status') statusValue?: string,
    @Query('sort') sortValue?: string,
    @Query('order') orderValue?: string,
  ) {
    const query = z.object({
      page: z.coerce.number().int().min(1).max(100_000).default(1),
      search: z.string().trim().max(100).default(''),
      status: z.nativeEnum(LeadStatus).optional(),
      sort: z.enum(['name', 'status', 'updatedAt']).default('updatedAt'),
      order: z.enum(['asc', 'desc']).default('desc'),
    }).parse({
      page: pageValue,
      search: searchValue ?? '',
      status: statusValue || undefined,
      sort: sortValue,
      order: orderValue,
    });
    const filters: Prisma.LeadWhereInput[] = [this.whereFor(user)];
    if (query.status) filters.push({ status: query.status });
    if (query.search) {
      filters.push({
        OR: [
          { name: { contains: query.search, mode: 'insensitive' } },
          { email: { contains: query.search, mode: 'insensitive' } },
          { company: { contains: query.search, mode: 'insensitive' } },
        ],
      });
    }
    const where: Prisma.LeadWhereInput = { AND: filters };
    const primarySort: Prisma.LeadOrderByWithRelationInput = query.sort === 'name'
      ? { name: query.order }
      : query.sort === 'status'
        ? { status: query.order }
        : { updatedAt: query.order };
    const pageSize = 25;
    const [items, total] = await Promise.all([
      this.prisma.lead.findMany({
        where,
        select: {
          id: true,
          name: true,
          email: true,
          company: true,
          status: true,
          assigneeId: true,
          updatedAt: true,
          assignee: { select: { id: true, name: true } },
          followUps: {
            where: { completed: false },
            orderBy: { dueAt: 'asc' },
            take: 1,
            select: { description: true, dueAt: true, destination: true },
          },
        },
        orderBy: [primarySort, { id: 'asc' }],
        skip: (query.page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.lead.count({ where }),
    ]);
    return { items, total, page: query.page, pageSize, totalPages: Math.ceil(total / pageSize) };
  }

  @Post()
  async create(@CurrentUser() user: SafeUser, @Body() body: unknown) {
    const data = leadSchema.parse(body);
    const assigneeId = data.assigneeId ?? (user.role === UserRole.MEMBER ? user.id : undefined);
    if (!assigneeId) throw new BadRequestException('Select an assignee for this lead');
    await this.assertAssignee(user, assigneeId);
    const lead = await this.prisma.lead.create({
      data: {
        name: data.name,
        email: data.email,
        phone: data.phone,
        company: data.company,
        other: data.other,
        status: data.status,
        sourceId: data.sourceId,
        assigneeId,
        createdById: user.id,
      },
    });
    this.analyticsCache.invalidate();
    return lead;
  }

  @Get(':id')
  get(@CurrentUser() user: SafeUser, @Param('id') id: string) {
    return this.ensureLead(user, id, true);
  }

  @Patch(':id')
  async update(@CurrentUser() user: SafeUser, @Param('id') id: string, @Body() body: unknown) {
    await this.ensureLead(user, id);
    const data = leadSchema.partial().parse(body);
    if (user.role === UserRole.MEMBER && data.assigneeId && data.assigneeId !== user.id) {
      throw new ForbiddenException('Members cannot reassign leads');
    }
    if (data.assigneeId) await this.assertAssignee(user, data.assigneeId);
    const { assigneeId, ...leadData } = data;
    const lead = await this.prisma.lead.update({
      where: { id },
      data: { ...leadData, ...(assigneeId ? { assigneeId } : {}) },
    });
    this.analyticsCache.invalidate();
    return lead;
  }

  @Delete(':id')
  async remove(@CurrentUser() user: SafeUser, @Param('id') id: string) {
    if (user.role === UserRole.MEMBER) throw new ForbiddenException('Only admins and managers can delete leads');
    await this.ensureLead(user, id);
    await this.prisma.lead.delete({ where: { id } });
    this.analyticsCache.invalidate();
    return { deleted: true };
  }

  @Post(':id/notes')
  async addNote(@CurrentUser() user: SafeUser, @Param('id') id: string, @Body() body: unknown) {
    await this.ensureLead(user, id);
    const { content } = noteSchema.parse(body);
    return this.prisma.leadNote.create({ data: { leadId: id, authorId: user.id, content } });
  }

  @Post(':id/follow-ups')
  async addFollowUp(@CurrentUser() user: SafeUser, @Param('id') id: string, @Body() body: unknown) {
    await this.ensureLead(user, id);
    const data = followUpSchema.parse(body);
    const followUp = await this.prisma.followUp.create({
      data: { leadId: id, createdById: user.id, description: data.description, dueAt: new Date(data.dueAt), destination: data.destination },
    });
    this.analyticsCache.invalidate();
    return followUp;
  }

  @Patch(':id/follow-ups/:followUpId')
  async updateFollowUp(
    @CurrentUser() user: SafeUser,
    @Param('id') id: string,
    @Param('followUpId') followUpId: string,
    @Body() body: unknown,
  ) {
    await this.ensureLead(user, id);
    const data = z.object({ completed: z.boolean().optional(), dueAt: z.string().datetime().optional() }).parse(body);
    const followUp = await this.prisma.followUp.findFirst({ where: { id: followUpId, leadId: id } });
    if (!followUp) throw new NotFoundException('Follow-up not found');
    const updated = await this.prisma.followUp.update({
      where: { id: followUpId },
      data: { ...data, ...(data.dueAt ? { dueAt: new Date(data.dueAt) } : {}) },
    });
    this.analyticsCache.invalidate();
    return updated;
  }

  @Delete(':id/follow-ups/:followUpId')
  async removeFollowUp(
    @CurrentUser() user: SafeUser,
    @Param('id') id: string,
    @Param('followUpId') followUpId: string,
  ) {
    await this.ensureLead(user, id);
    const followUp = await this.prisma.followUp.findFirst({ where: { id: followUpId, leadId: id } });
    if (!followUp) throw new NotFoundException('Follow-up not found');
    await this.prisma.followUp.delete({ where: { id: followUpId } });
    this.analyticsCache.invalidate();
    return { deleted: true };
  }

  private async assertAssignee(actor: SafeUser, assigneeId: string) {
    const target = await this.prisma.user.findFirst({
      where: { id: assigneeId, active: true, role: { not: UserRole.ADMIN } },
    });
    if (!target) throw new NotFoundException('Assignee not found');
    if (actor.role === UserRole.MEMBER && target.id !== actor.id) {
      throw new ForbiddenException('Members can only assign leads to themselves');
    }
    if (actor.role === UserRole.MANAGER && target.id !== actor.id && target.managerId !== actor.id) {
      throw new ForbiddenException('Managers can only assign leads to their team');
    }
  }
}
