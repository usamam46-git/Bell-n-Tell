import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { eq } from 'drizzle-orm';
import { createBusinessInput, registerInput } from '@bellntell/contracts';
import { readEnv } from '../env.js';
import { hashPassword, keyedHash, randomSecret } from '../auth/crypto.js';
import { createDb } from './client.js';
import { users, businesses, businessMemberships, businessSettings } from './schema.js';

const env = readEnv();
const { db, pool } = createDb(env.DATABASE_URL);
const password = randomSecret();
const recoveryCode = randomSecret();
const account = registerInput.parse({ email: 'seed.owner@localhost.test', password, name: 'Local owner' });
const businessInput = createBusinessInput.parse({ name: 'Demo business', slug: 'demo-business', timezone: 'UTC' });
const file = process.env.SEED_CREDENTIALS_FILE ?? resolve(process.cwd(), '../../.local-seed-credentials');
try {
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, account.email)).limit(1);
  if (existing) { process.stdout.write('Development seed already exists.\n'); }
  else {
    if (existsSync(file)) throw new Error('Seed credential file already exists; choose a different path before seeding');
    await db.transaction(async (tx) => {
      const [user] = await tx.insert(users).values({ email: account.email, name: account.name, passwordHash: await hashPassword(password), recoveryCodeHash: keyedHash(env.AUTH_HASH_KEY, 'recovery', recoveryCode) }).returning();
      const [business] = await tx.insert(businesses).values(businessInput).returning();
      await tx.insert(businessMemberships).values({ businessId: business.id, userId: user.id, role: 'owner' });
      await tx.insert(businessSettings).values({ businessId: business.id });
    });
    await writeFile(file, `Email: ${account.email}\nPassword: ${password}\nRecovery code: ${recoveryCode}\n`, { mode: 0o600, flag: 'wx' });
    process.stdout.write('Development seed created. Credentials were saved to the credential file.\n');
  }
} catch {
  process.stderr.write('Development seed failed. Check the database and credential file state.\n');
  process.exitCode = 1;
} finally { await pool.end(); }
