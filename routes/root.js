const registerRootRoutes = (app) => {
    app.get('/', (req, res) => res.json({ status: 'success', message: 'Auth Service is running!' }));
};

module.exports = { registerRootRoutes };

