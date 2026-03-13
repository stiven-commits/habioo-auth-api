import type { Application, NextFunction, Request, Response } from 'express';

const registerRootRoutes = (app: Application): void => {
    app.get('/', (req: Request, res: Response, _next: NextFunction) => res.json({ status: 'success', message: 'Auth Service is running!' }));
};

module.exports = { registerRootRoutes };
