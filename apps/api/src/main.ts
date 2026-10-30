
import 'reflect-metadata';
import 'dotenv/config';
import cookieParser = require('cookie-parser');
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { doubleCsrf } from 'csrf-csrf';
import { NextFunction, Request, Response } from 'express';
import { PerformanceInterceptor } from './performance.interceptor';
import session = require('express-session');

import { AppModule } from './app.module';
import { ZodValidationFilter } from './common';
import { PrismaService, requestContext } from './prisma.service';
import { PrismaSessionStore } from './prisma-session.store';

async function bootstrap() {
  // Validate required environment variables.
  const required = [
    'MONGODB_URI',
    'SESSION_SECRET',
    'APP_ORIGIN',
  ];

  const missing = required.filter((key) => !process.env[key]);

  if (missing.length) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}`,
    );
  }

  // Validate the frontend origins allowed to call the API.
  const allowedOrigins = [
    process.env.APP_ORIGIN!,
    ...(process.env.APP_ORIGINS ?? '').split(',').map((origin) => origin.trim()).filter(Boolean),
  ];

  for (const origin of allowedOrigins) {
    const configuredOrigin = new URL(origin);
    if (configuredOrigin.origin !== origin) {
      throw new Error(
        'APP_ORIGIN and APP_ORIGINS must contain origins only, without paths or trailing slashes',
      );
    }

    if (
      process.env.NODE_ENV === 'production' &&
      configuredOrigin.protocol !== 'https:'
    ) {
      throw new Error('APP_ORIGIN and APP_ORIGINS must use HTTPS in production');
    }
  }

  // Validate trusted proxy configuration.
  const trustedProxyHops = Number(
    process.env.TRUST_PROXY_HOPS ?? 0,
  );

  if (
    !Number.isSafeInteger(trustedProxyHops) ||
    trustedProxyHops < 0
  ) {
    throw new Error(
      'TRUST_PROXY_HOPS must be a non-negative integer',
    );
  }

  // Validate session secret.
  const sessionSecret = process.env.SESSION_SECRET ?? '';

  if (
    sessionSecret.length < 32 ||
    /REPLACE_WITH|CHANGE_ME/i.test(sessionSecret)
  ) {
    throw new Error(
      'SESSION_SECRET must be a non-placeholder value of at least 32 characters',
    );
  }

  // Initialize NestJS.
  const app = await NestFactory.create(AppModule);

  app.setGlobalPrefix('api');
  app.useGlobalInterceptors(new PerformanceInterceptor());
  const requestCounter = { value: 0 };
  const tracePhase = (request: Request, phase: string, startedAt: bigint) => {
    console.info(JSON.stringify({
      event: 'request_phase',
      requestId: (request as Request & { requestId?: string }).requestId,
      phase,
      durationMs: Number((Number(process.hrtime.bigint() - startedAt) / 1_000_000).toFixed(2)),
    }));
  };

  app.use((request: Request, response: Response, next: NextFunction) => {
    const startedAt = process.hrtime.bigint();
    (request as Request & { phaseStartedAt?: bigint }).phaseStartedAt = startedAt;
    const requestId = request.headers['x-request-id']?.toString().slice(0, 128)
      ?? `${process.pid}-${++requestCounter.value}`;
    response.setHeader('X-Request-Id', requestId);
    (request as Request & { requestId?: string }).requestId = requestId;
    response.once('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      console.info(JSON.stringify({
        event: 'http_response',
        requestId,
        method: request.method,
        path: request.originalUrl.split('?')[0],
        status: response.statusCode,
        durationMs: Number(durationMs.toFixed(2)),
      }));
    });
    requestContext.run({ requestId }, next);
  });

  app.enableCors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error('Origin is not allowed by CORS'));
    },
    credentials: true,
    exposedHeaders: ['Server-Timing', 'X-Request-Id', 'X-Total-Count', 'X-Page', 'X-Page-Size', 'X-Total-Pages'],
  });
  app.use((request: Request, response: Response, next: NextFunction) => {
    const startedAt = process.hrtime.bigint();
    cookieParser()(request, response, (error?: unknown) => {
      tracePhase(request, 'cookie-parser', startedAt);
      next(error as string | Error | undefined);
    });
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  app.useGlobalFilters(new ZodValidationFilter());

  app
    .getHttpAdapter()
    .getInstance()
    .set('trust proxy', trustedProxyHops || false);

  // Store sessions in the same MongoDB Atlas database as application data.
  const sessionStore = new PrismaSessionStore(app.get(PrismaService));

  const sessionMiddleware = session({
      name: 'nirvaan.sid',
      secret: sessionSecret,
      store: sessionStore,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 1000 * 60 * 60 * 8,
      },
  });
  app.use((request: Request, response: Response, next: NextFunction) => {
    const startedAt = process.hrtime.bigint();
    sessionMiddleware(request, response, (error?: unknown) => {
      tracePhase(request, 'session-load', startedAt);
      next(error as string | Error | undefined);
    });
  });

  // CSRF protection.
  const { doubleCsrfProtection } = doubleCsrf({
    getSecret: () => sessionSecret,

    getSessionIdentifier: (request) =>
      (request as typeof request & { sessionID?: string })
        .sessionID ?? '',

    cookieName:
      process.env.NODE_ENV === 'production'
        ? '__Host-nirvaan.csrf'
        : 'nirvaan.csrf',

    cookieOptions: {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
    },

    getCsrfTokenFromRequest: (request) =>
      request.headers['x-csrf-token'] as string,
  });

  app.use((request: Request, response: Response, next: NextFunction) => {
    const startedAt = process.hrtime.bigint();
    doubleCsrfProtection(request, response, (error?: unknown) => {
      tracePhase(request, 'csrf', startedAt);
      next(error as string | Error | undefined);
    });
  });

  // Start the API server.
  const port = Number(process.env.PORT ?? 4000);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }

  await app.listen(port, '0.0.0.0');

  console.log(`NirvaanOS API listening on port ${port}`);
}

void bootstrap();
