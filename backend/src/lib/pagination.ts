import { z } from 'zod';

export const PageQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const pageArgs = (q: { page: number; pageSize: number }) => ({ skip: (q.page - 1) * q.pageSize, take: q.pageSize });

export const pageResult = <T>(data: T[], total: number, q: { page: number; pageSize: number }) => ({
  data,
  pagination: { page: q.page, pageSize: q.pageSize, total, totalPages: Math.max(1, Math.ceil(total / q.pageSize)) },
});
