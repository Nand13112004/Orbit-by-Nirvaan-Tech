import 'dotenv/config';
import { PrismaClient, UserRole } from '@prisma/client';
import { hash } from 'argon2';

const prisma = new PrismaClient();
const PLACEHOLDERS = new Set([
  'CHANGE_ME_ADMIN_PASSWORD',
  'CHANGE_ME_MANAGER_PASSWORD',
  'CHANGE_ME_MEMBER_PASSWORD',
  'password',
  'changeme',
]);

function config(name: string, email: string, password: string, role: UserRole) {
  const values = {
    name: process.env[name],
    email: process.env[email],
    password: process.env[password],
  };
  if (!values.name?.trim() || !values.email?.trim() || !values.password) {
    throw new Error(`Missing required initial account configuration for ${role}`);
  }
  if (PLACEHOLDERS.has(values.password) || values.password.toUpperCase().startsWith('CHANGE_ME')) {
    throw new Error(`Replace the placeholder password configured for ${role}`);
  }
  if (
    values.password.length < 16 ||
    !/[a-z]/.test(values.password) ||
    !/[A-Z]/.test(values.password) ||
    !/[0-9]/.test(values.password) ||
    !/[^A-Za-z0-9]/.test(values.password)
  ) {
    throw new Error(`Initial ${role} password must be at least 16 characters and include upper/lowercase, a number, and a symbol`);
  }
  return { ...values, email: values.email.trim().toLowerCase(), role };
}

async function main() {
  const accounts = [
    config('INITIAL_ADMIN_NAME', 'INITIAL_ADMIN_EMAIL', 'INITIAL_ADMIN_PASSWORD', UserRole.ADMIN),
    config('INITIAL_MANAGER_NAME', 'INITIAL_MANAGER_EMAIL', 'INITIAL_MANAGER_PASSWORD', UserRole.MANAGER),
    config('INITIAL_MEMBER_NAME', 'INITIAL_MEMBER_EMAIL', 'INITIAL_MEMBER_PASSWORD', UserRole.MEMBER),
  ];
  if (new Set(accounts.map((account) => account.email)).size !== accounts.length) {
    throw new Error('Initial account emails must be unique');
  }
  if (new Set(accounts.map((account) => account.password)).size !== accounts.length) {
    throw new Error('Initial account passwords must be unique');
  }

  const existingUsers = await prisma.user.findMany({
    where: { email: { in: accounts.map((account) => account.email) } },
  });
  for (const account of accounts) {
    const existing = existingUsers.find((user) => user.email === account.email);
    if (existing && existing.role !== account.role) {
      throw new Error(`Configured email for ${account.role} already belongs to another role; resolve this administratively`);
    }
  }

  const created: UserRole[] = [];
  await prisma.$transaction(async (transaction) => {
    const initialManager = accounts.find((account) => account.role === UserRole.MANAGER)!;
    let manager = existingUsers.find((user) => user.email === initialManager.email);
    if (!manager) {
      manager = await transaction.user.create({
        data: {
          name: initialManager.name!,
          email: initialManager.email,
          passwordHash: await hash(initialManager.password!, { type: 2 }),
          role: initialManager.role,
        },
      });
      created.push(initialManager.role);
    }

    for (const account of accounts) {
      const existing = existingUsers.find((user) => user.email === account.email);
      if (existing) continue;
      if (account.role === UserRole.MANAGER) continue;
      await transaction.user.create({
        data: {
          name: account.name!,
          email: account.email,
          passwordHash: await hash(account.password!, { type: 2 }),
          role: account.role,
          ...(account.role === UserRole.MEMBER ? { managerId: manager.id } : {}),
        },
      });
      created.push(account.role);
    }
  });

  for (const account of accounts) {
    if (created.includes(account.role)) console.info(`Created initial ${account.role} account.`);
    else console.info(`Initial ${account.role} account already exists; credentials were not changed.`);
  }
}

main()
  .catch((error: unknown) => {
    if (error instanceof Error) console.error(error.message);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
