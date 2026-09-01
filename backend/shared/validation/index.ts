import { Request, Response, NextFunction, RequestHandler } from 'express';
import { AnyZodObject, ZodError } from 'zod';
import { ValidationError } from '../errors/ValidationError';

interface ValidationSchema {
  body?: AnyZodObject;
  query?: AnyZodObject;
  params?: AnyZodObject;
}

/**
 * Express middleware generator that validates request attributes (body, query, params) against Zod schemas.
 * If validation fails, standard Zod errors are compiled into a custom operational ValidationError.
 */
export function validateRequest(schemas: ValidationSchema): RequestHandler {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      if (schemas.body) {
        req.body = await schemas.body.parseAsync(req.body);
      }
      if (schemas.query) {
        req.query = await schemas.query.parseAsync(req.query) as any;
      }
      if (schemas.params) {
        req.params = await schemas.params.parseAsync(req.params) as any;
      }
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const errorRecord: Record<string, string[]> = {};
        for (const issue of error.issues) {
          const pathKey = issue.path.join('.') || 'payload';
          if (!errorRecord[pathKey]) {
            errorRecord[pathKey] = [];
          }
          errorRecord[pathKey].push(issue.message);
        }
        next(new ValidationError('Request schema validation failed', errorRecord));
      } else {
        next(error);
      }
    }
  };
}
export * from './commonSchemas';
