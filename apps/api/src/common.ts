import {
  CanActivate,
  ArgumentsHost,
  Catch,
  createParamDecorator,
  ExceptionFilter,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { User, UserRole } from '@prisma/client';
import { Request } from 'express';
import { ZodError } from 'zod';
import { PrismaService } from './prisma.service';

export type SafeUser = Pick<User, 'id' | 'name' | 'email' | 'role' | 'active' | 'managerId'>;
export type AuthRequest = Request & { user?: SafeUser };

export const CurrentUser = createParamDecorator(
  (_: unknown, context: ExecutionContext) => context.switchToHttp().getRequest<AuthRequest>().user!,
);

export const Roles = (...roles: UserRole[]) => SetMetadata('roles', roles);

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthRequest>();
    const guardStartedAt = process.hrtime.bigint();

    // If this request already has an authenticated user attached (set by a prior
    // guard in the same request lifecycle, e.g. when both AuthGuard + RolesGuard
    // run on the same handler), skip the redundant DB round-trip.
    if (request.user) {
      this.logGuard(request, guardStartedAt, 'authenticated-user-reused');
      return true;
    }

    const userId = request.session?.userId;
    if (!userId) {
      this.logGuard(request, guardStartedAt, 'missing-session-user');
      throw new UnauthorizedException('Authentication required');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, email: true, role: true, active: true, managerId: true },
    });
    if (!user || !user.active) {
      request.session.destroy(() => undefined);
      this.logGuard(request, guardStartedAt, 'inactive-or-missing-user');
      throw new UnauthorizedException('Authentication required');
    }

    const { id, name, email, role, active, managerId } = user;
    request.user = { id, name, email, role, active, managerId };
    this.logGuard(request, guardStartedAt, 'authenticated');
    return true;
  }

  private logGuard(request: AuthRequest, startedAt: bigint, outcome: string) {
    console.info(JSON.stringify({
      event: 'auth_guard',
      requestId: (request as AuthRequest & { requestId?: string }).requestId,
      durationMs: Number((Number(process.hrtime.bigint() - startedAt) / 1_000_000).toFixed(2)),
      outcome,
    }));
  }
}

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<UserRole[]>('roles', [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!roles?.length) return true;
    const user = context.switchToHttp().getRequest<AuthRequest>().user;
    if (!user || !roles.includes(user.role)) throw new ForbiddenException('Insufficient permissions');
    return true;
  }
}

export const safeUser = (user: User): SafeUser => ({
  id: user.id,
  name: user.name,
  email: user.email,
  role: user.role,
  active: user.active,
  managerId: user.managerId,
});

@Catch(ZodError)
export class ZodValidationFilter implements ExceptionFilter {
  catch(exception: ZodError, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse();
    response.status(400).json({
      statusCode: 400,
      message: 'Request validation failed',
      errors: exception.issues.map(({ path, message }) => ({ path, message })),
    });
  }
}
