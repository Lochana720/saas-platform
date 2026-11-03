export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (msg: string, details?: unknown) => new HttpError(400, msg, 'BAD_REQUEST', details);
export const unauthorized = (msg = 'Authentication required') => new HttpError(401, msg, 'UNAUTHORIZED');
export const forbidden = (msg = 'You do not have permission to do this') => new HttpError(403, msg, 'FORBIDDEN');
export const notFound = (what = 'Resource') => new HttpError(404, `${what} not found`, 'NOT_FOUND');
export const conflict = (msg: string) => new HttpError(409, msg, 'CONFLICT');
export const planLimit = (msg: string) => new HttpError(402, msg, 'PLAN_LIMIT_REACHED');
