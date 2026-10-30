import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { verify, hash } from 'argon2';
import { randomBytes } from 'node:crypto';
import { Request, Response } from 'express';
import { Session } from 'express-session';
import { z } from 'zod';
import { AuthGuard, AuthRequest, CurrentUser, safeUser, SafeUser } from './common';
import { strongPassword } from './password';
import { PrismaService } from './prisma.service';

const credentialsSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(256),
});
const dummyPasswordHash = hash(randomBytes(32).toString('hex'), { type: 2 });
type SessionRequest = Request & { session: Session & { userId: string } };

@Controller('auth')
export class AuthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('csrf')
  @Header('Cache-Control', 'no-store, private')
  async csrf(@Req() req: Request & { csrfToken: () => string }) {
    // csrf-csrf binds tokens to the Express session ID. Persist an anonymous
    // bootstrap session so the browser sends that same ID on the protected POST.
    const csrfSession = req.session as typeof req.session & { csrfBootstrap?: boolean };
    if (!csrfSession.csrfBootstrap) {
      csrfSession.csrfBootstrap = true;
      await new Promise<void>((resolve, reject) => {
        csrfSession.save((error) => (error ? reject(error) : resolve()));
      });
    }
    return { csrfToken: req.csrfToken() };
  }

  @Post('login')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async login(
    @Body() body: unknown,
    @Req() req: AuthRequest,
  ): Promise<{ user: SafeUser }> {
    const parsed = credentialsSchema.safeParse(body);
    if (!parsed.success) throw new UnauthorizedException('Invalid email or password');
    const user = await this.prisma.user.findUnique({
      where: { email: parsed.data.email.trim().toLowerCase() },
    });
    const storedHash = user ? user.passwordHash : await dummyPasswordHash;
    const valid = await verify(storedHash, parsed.data.password);
    if (!user || !user.active || !valid) {
      await this.prisma.auditLog.create({
        data: { actorId: user?.id, action: 'LOGIN_FAILED', entity: 'User', entityId: user?.id },
      });
      throw new UnauthorizedException('Invalid email or password');
    }

    await new Promise<void>((resolve, reject) => {
      req.session.regenerate((error) => (error ? reject(error) : resolve()));
    });
    req.session.userId = user.id;
    await new Promise<void>((resolve, reject) => {
      req.session.save((error) => (error ? reject(error) : resolve()));
    });
    await this.prisma.auditLog.create({
      data: { actorId: user.id, action: 'LOGIN', entity: 'User', entityId: user.id },
    });
    return { user: safeUser(user) };
  }

  @Get('me')
  @UseGuards(AuthGuard)
  me(@CurrentUser() user: SafeUser) {
    return { user };
  }

  @Post('logout')
  @HttpCode(204)
  @UseGuards(AuthGuard)
  async logout(
    @Req() req: SessionRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    await new Promise<void>((resolve, reject) => {
      req.session.destroy((error) => (error ? reject(error) : resolve()));
    });
    response.clearCookie('nirvaan.sid', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
    });
  }

  @Post('password')
  @HttpCode(204)
  @UseGuards(AuthGuard)
  async changePassword(
    @CurrentUser() user: SafeUser,
    @Body() body: unknown,
    @Req() req: SessionRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    const schema = z.object({ currentPassword: z.string().max(256), newPassword: strongPassword });
    const parsed = schema.safeParse(body);
    if (!parsed.success) throw new UnauthorizedException('Invalid password change request');
    const record = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    if (!(await verify(record.passwordHash, parsed.data.currentPassword))) {
      throw new UnauthorizedException('Current password is incorrect');
    }
    if (parsed.data.currentPassword === parsed.data.newPassword) {
      throw new UnauthorizedException('Choose a different password');
    }
    await this.prisma.$transaction(async (transaction) => {
      await transaction.user.update({
        where: { id: user.id },
        data: { passwordHash: await hash(parsed.data.newPassword, { type: 2 }) },
      });
      await transaction.auditLog.create({
        data: { actorId: user.id, action: 'PASSWORD_CHANGED', entity: 'User', entityId: user.id },
      });
    });
    await new Promise<void>((resolve, reject) => {
      req.session.destroy((error) => (error ? reject(error) : resolve()));
    });
    response.clearCookie('nirvaan.sid', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
    });
  }
}
