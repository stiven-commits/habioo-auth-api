import type { AuthenticatedUser } from '../auth';

declare module 'express-serve-static-core' {
    interface Request {
        user?: AuthenticatedUser;
    }
}

export {};

