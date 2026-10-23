import { defineConfig } from 'drizzle-kit';
export default defineConfig({ schema: './src/db/schema.ts', out: './drizzle', dialect: 'postgresql', dbCredentials: { url: process.env.DATABASE_URL ?? 'postgres://bellntell:bellntell_dev_only@localhost:5432/bellntell' } });
