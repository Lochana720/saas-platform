import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { env } from './config/env.js';
import { prisma } from './lib/prisma.js';
import { authenticate } from './middleware/auth.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import { authRouter } from './routes/auth.routes.js';
import { membersRouter } from './routes/members.routes.js';
import { customersRouter } from './routes/customers.routes.js';
import { invoicesRouter } from './routes/invoices.routes.js';
import { billingRouter } from './routes/billing.routes.js';
import { analyticsRouter } from './routes/analytics.routes.js';
import { auditRouter } from './routes/audit.routes.js';
import { tenantRouter } from './routes/tenant.routes.js';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1); // behind nginx: real client IP for audit logs & rate limits
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({ origin: env.CORS_ORIGIN.split(','), credentials: true }));
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  app.get('/api/health', async (_req, res) => {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ok' });
  });

  // Public
  app.use('/api/auth', authRouter);

  // Everything below requires a valid session + tenant membership
  app.use('/api', authenticate);
  app.use('/api/tenant', tenantRouter);
  app.use('/api/members', membersRouter);
  app.use('/api/customers', customersRouter);
  app.use('/api/invoices', invoicesRouter);
  app.use('/api/billing', billingRouter);
  app.use('/api/analytics', analyticsRouter);
  app.use('/api/audit-logs', auditRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
