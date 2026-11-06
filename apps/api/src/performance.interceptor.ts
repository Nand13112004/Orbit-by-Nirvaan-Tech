import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Observable, finalize } from 'rxjs';

@Injectable()
export class PerformanceInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();
    const startedAt = process.hrtime.bigint();
    const requestId = (request as Request & { requestId?: string }).requestId;
    const requestStartedAt = (request as Request & { phaseStartedAt?: bigint }).phaseStartedAt;
    const middlewareDurationMs = requestStartedAt
      ? Number((Number(startedAt - requestStartedAt) / 1_000_000).toFixed(2))
      : undefined;

    return next.handle().pipe(
      finalize(() => {
        const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
        const roundedDurationMs = Number(durationMs.toFixed(2));
        if (!response.headersSent) {
          response.setHeader(
            'Server-Timing',
            `middleware;dur=${middlewareDurationMs ?? 0}, controller;dur=${roundedDurationMs}`,
          );
        }
        console.info(JSON.stringify({
          event: 'controller_response',
          requestId,
          method: request.method,
          path: request.originalUrl.split('?')[0],
          durationMs: roundedDurationMs,
          middlewareDurationMs,
        }));
      }),
    );
  }
}
