"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const registerRootRoutes = (app) => {
    app.get('/', (req, res, _next) => res.json({ status: 'success', message: 'Auth Service is running!' }));
};
module.exports = { registerRootRoutes };
//# sourceMappingURL=root.js.map