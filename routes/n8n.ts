import type { NextFunction, Request, Response } from 'express';
const n8nService = require('../services/n8n');

interface AuthDependencies {
    verifyToken: (req: Request, res: Response, next: NextFunction) => void | Promise<void>;
}

function isAdmin(req: Request, res: Response, next: NextFunction): void {
    const user = req.user as any;
    if (!user?.is_admin && !user?.is_superuser) {
        res.status(403).json({
            status: 'error',
            message: 'Se requieren permisos de administrador para gestionar workflows',
        });
        return;
    }
    next();
}

function registerN8NRoutes(app: any, deps: AuthDependencies): void {
    const basePath = '/api/n8n';

    // ========== WORKFLOWS ==========

    app.get(
        `${basePath}/workflows`,
        deps.verifyToken,
        isAdmin,
        async (_req: Request, res: Response, _next: NextFunction): Promise<void> => {
            try {
                const workflows = await n8nService.listWorkflows();
                res.json({ status: 'success', data: workflows });
            } catch (error: any) {
                res.status(500).json({
                    status: 'error',
                    message: 'Error al listar workflows',
                    error: error.message,
                });
            }
        }
    );

    app.get(
        `${basePath}/workflows/:id`,
        deps.verifyToken,
        isAdmin,
        async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
            try {
                const id = String(req.params.id);
                const workflow = await n8nService.getWorkflow(id);
                res.json({ status: 'success', data: workflow });
            } catch (error: any) {
                res.status(500).json({
                    status: 'error',
                    message: 'Error al obtener workflow',
                    error: error.message,
                });
            }
        }
    );

    app.post(
        `${basePath}/workflows`,
        deps.verifyToken,
        isAdmin,
        async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
            try {
                const payload = req.body as any;

                if (!payload.name) {
                    res.status(400).json({
                        status: 'error',
                        message: 'El nombre del workflow es requerido',
                    });
                    return;
                }

                if (!payload.nodes || !Array.isArray(payload.nodes)) {
                    res.status(400).json({
                        status: 'error',
                        message: 'El workflow debe tener nodos definidos',
                    });
                    return;
                }

                const workflow = await n8nService.createWorkflow(payload);
                res.status(201).json({ status: 'success', data: workflow });
            } catch (error: any) {
                res.status(500).json({
                    status: 'error',
                    message: 'Error al crear workflow',
                    error: error.message,
                });
            }
        }
    );

    app.put(
        `${basePath}/workflows/:id`,
        deps.verifyToken,
        isAdmin,
        async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
            try {
                const id = String(req.params.id);
                const payload = req.body as any;

                const workflow = await n8nService.updateWorkflow(id, payload);
                res.json({ status: 'success', data: workflow });
            } catch (error: any) {
                res.status(500).json({
                    status: 'error',
                    message: 'Error al actualizar workflow',
                    error: error.message,
                });
            }
        }
    );

    app.delete(
        `${basePath}/workflows/:id`,
        deps.verifyToken,
        isAdmin,
        async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
            try {
                const id = String(req.params.id);
                const result = await n8nService.deleteWorkflow(id);
                res.json({ status: 'success', data: result });
            } catch (error: any) {
                res.status(500).json({
                    status: 'error',
                    message: 'Error al eliminar workflow',
                    error: error.message,
                });
            }
        }
    );

    app.post(
        `${basePath}/workflows/:id/activate`,
        deps.verifyToken,
        isAdmin,
        async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
            try {
                const id = String(req.params.id);
                const workflow = await n8nService.activateWorkflow(id);
                res.json({ status: 'success', data: workflow });
            } catch (error: any) {
                res.status(500).json({
                    status: 'error',
                    message: 'Error al activar workflow',
                    error: error.message,
                });
            }
        }
    );

    app.post(
        `${basePath}/workflows/:id/deactivate`,
        deps.verifyToken,
        isAdmin,
        async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
            try {
                const id = String(req.params.id);
                const workflow = await n8nService.deactivateWorkflow(id);
                res.json({ status: 'success', data: workflow });
            } catch (error: any) {
                res.status(500).json({
                    status: 'error',
                    message: 'Error al desactivar workflow',
                    error: error.message,
                });
            }
        }
    );

    // ========== EXECUTIONS ==========

    app.get(
        `${basePath}/executions`,
        deps.verifyToken,
        isAdmin,
        async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
            try {
                const query = req.query as Record<string, string | undefined>;
                const executions = await n8nService.listExecutions({
                    workflowId: query.workflowId,
                    limit: query.limit ? parseInt(query.limit, 10) : undefined,
                    status: query.status,
                });
                res.json({ status: 'success', data: executions });
            } catch (error: any) {
                res.status(500).json({
                    status: 'error',
                    message: 'Error al listar ejecuciones',
                    error: error.message,
                });
            }
        }
    );

    app.get(
        `${basePath}/executions/:id`,
        deps.verifyToken,
        isAdmin,
        async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
            try {
                const id = String(req.params.id);
                const execution = await n8nService.getExecution(id);
                res.json({ status: 'success', data: execution });
            } catch (error: any) {
                res.status(500).json({
                    status: 'error',
                    message: 'Error al obtener ejecución',
                    error: error.message,
                });
            }
        }
    );

    // ========== TAGS ==========

    app.get(
        `${basePath}/tags`,
        deps.verifyToken,
        isAdmin,
        async (_req: Request, res: Response, _next: NextFunction): Promise<void> => {
            try {
                const tags = await n8nService.listTags();
                res.json({ status: 'success', data: tags });
            } catch (error: any) {
                res.status(500).json({
                    status: 'error',
                    message: 'Error al listar tags',
                    error: error.message,
                });
            }
        }
    );

    app.post(
        `${basePath}/tags`,
        deps.verifyToken,
        isAdmin,
        async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
            try {
                const { name } = req.body as { name?: string };

                if (!name) {
                    res.status(400).json({
                        status: 'error',
                        message: 'El nombre del tag es requerido',
                    });
                    return;
                }

                const tag = await n8nService.createTag(name);
                res.status(201).json({ status: 'success', data: tag });
            } catch (error: any) {
                res.status(500).json({
                    status: 'error',
                    message: 'Error al crear tag',
                    error: error.message,
                });
            }
        }
    );

    app.delete(
        `${basePath}/tags/:id`,
        deps.verifyToken,
        isAdmin,
        async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
            try {
                const id = String(req.params.id);
                const result = await n8nService.deleteTag(id);
                res.json({ status: 'success', data: result });
            } catch (error: any) {
                res.status(500).json({
                    status: 'error',
                    message: 'Error al eliminar tag',
                    error: error.message,
                });
            }
        }
    );

    // ========== WEBHOOK TEST ==========

    app.post(
        `${basePath}/webhooks/:path/test`,
        deps.verifyToken,
        isAdmin,
        async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
            try {
                const webhookPath = String(req.params.path);
                const payload = req.body;

                const result = await n8nService.testWebhook(webhookPath, payload);
                res.json({ status: 'success', data: result });
            } catch (error: any) {
                res.status(500).json({
                    status: 'error',
                    message: 'Error al probar webhook',
                    error: error.message,
                });
            }
        }
    );
}

module.exports = { registerN8NRoutes };
