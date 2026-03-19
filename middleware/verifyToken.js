"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const jwt = require('jsonwebtoken');
const verifyToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    if (!authHeader) {
        res.status(403).json({ status: 'error', message: 'Acceso denegado.' });
        return;
    }
    try {
        const token = authHeader.split(' ')[1];
        if (!token) {
            res.status(401).json({ status: 'error', message: 'Token invalido.' });
            return;
        }
        req.user = jwt.verify(token, process.env.JWT_SECRET);
        next();
    }
    catch (_err) {
        res.status(401).json({ status: 'error', message: 'Token invalido.' });
    }
};
module.exports = { verifyToken };
//# sourceMappingURL=verifyToken.js.map