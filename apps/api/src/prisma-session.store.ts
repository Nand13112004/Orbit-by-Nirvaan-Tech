import session = require('express-session');
import { PrismaService } from './prisma.service';

const DEFAULT_SESSION_TTL_MS = 8 * 60 * 60 * 1000;

/** Express-session store backed by the application's MongoDB Prisma client. */
export class PrismaSessionStore extends session.Store {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  get(
    sid: string,
    callback: (error: unknown, sessionData?: session.SessionData | null) => void,
  ): void {
    void this.prisma.userSession
      .findFirst({
        where: { sid, expiresAt: { gt: new Date() } },
        select: { data: true },
      })
      .then((record) => {
        callback(null, record?.data as session.SessionData | undefined);
      })
      .catch((error: unknown) => callback(error));
  }

  set(sid: string, sessionData: session.SessionData, callback?: (error?: unknown) => void): void {
    const expiresAt = this.getExpiry(sessionData);
    const userId = (sessionData as session.SessionData & { userId?: unknown }).userId;
    const data = JSON.parse(JSON.stringify(sessionData));

    const operation = this.prisma.userSession.upsert({
      where: { sid },
      create: {
        sid,
        userId: typeof userId === 'string' ? userId : null,
        data,
        expiresAt,
      },
      update: {
        userId: typeof userId === 'string' ? userId : null,
        data,
        expiresAt,
      },
    });
    this.finish(operation, callback);
  }

  destroy(sid: string, callback?: (error?: unknown) => void): void {
    this.finish(this.prisma.userSession.deleteMany({ where: { sid } }), callback);
  }

  touch(sid: string, sessionData: session.SessionData, callback?: () => void): void {
    void this.prisma.userSession
      .updateMany({
        where: { sid },
        data: { expiresAt: this.getExpiry(sessionData) },
      })
      .then(() => callback?.())
      .catch(() => callback?.());
  }

  all(callback: (error: unknown, sessions?: session.SessionData[] | null) => void): void {
    void this.prisma.userSession
      .findMany({
        where: { expiresAt: { gt: new Date() } },
        select: { data: true },
      })
      .then((records) => {
        callback(null, records.map(({ data }) => data as unknown as session.SessionData));
      })
      .catch((error: unknown) => callback(error));
  }

  length(callback: (error: unknown, length?: number) => void): void {
    void this.prisma.userSession
      .count({ where: { expiresAt: { gt: new Date() } } })
      .then((count) => callback(null, count))
      .catch((error: unknown) => callback(error));
  }

  clear(callback?: (error?: unknown) => void): void {
    this.finish(this.prisma.userSession.deleteMany(), callback);
  }

  private getExpiry(sessionData: session.SessionData): Date {
    const cookieExpiry = sessionData.cookie?.expires;
    const expiry = cookieExpiry
      ? cookieExpiry instanceof Date
        ? cookieExpiry
        : new Date(cookieExpiry)
      : new Date(Date.now() + DEFAULT_SESSION_TTL_MS);
    return Number.isNaN(expiry.getTime())
      ? new Date(Date.now() + DEFAULT_SESSION_TTL_MS)
      : expiry;
  }

  private finish<T>(operation: Promise<T>, callback?: (error?: unknown) => void): void {
    void operation.then(
      () => callback?.(),
      (error: unknown) => {
        if (callback) callback(error);
        else console.error('MongoDB session-store operation failed');
      },
    );
  }
}
