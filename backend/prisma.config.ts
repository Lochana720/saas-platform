import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

// Migrations and seeding run as the database OWNER (MIGRATION_DATABASE_URL).
// The running API connects as the restricted `app_user` role (DATABASE_URL),
// which is subject to Row-Level Security.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: env('MIGRATION_DATABASE_URL'),
  },
});
