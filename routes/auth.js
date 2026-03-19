"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const asString = (value) => {
    if (typeof value !== 'string') {
        throw new TypeError('Invalid string value');
    }
    return value;
};
const asAuthUser = (value) => {
    if (typeof value !== 'object' ||
        value === null ||
        typeof value.id !== 'number') {
        throw new TypeError('Invalid authenticated user');
    }
    return value;
};
const isBcryptHash = (value) => /^\$2[aby]\$\d{2}\$/.test(value);
const registerAuthRoutes = (app, { pool, verifyToken }) => {
    app.post('/register', async (req, res) => {
        const { cedula, nombre, password } = req.body;
        try {
            const cedulaSafe = asString(cedula);
            const nombreSafe = asString(nombre);
            const passwordSafe = asString(password);
            const salt = await bcrypt.genSalt(10);
            const hashedPassword = await bcrypt.hash(passwordSafe, salt);
            const result = await pool.query('INSERT INTO users (cedula, nombre, password) VALUES ($1, $2, $3) RETURNING id', [cedulaSafe, nombreSafe, hashedPassword]);
            res.status(201).json({ status: 'success', user: result.rows[0] });
        }
        catch (err) {
            const error = err;
            res.status(400).json({ status: 'error', error: error.message });
        }
    });
    app.post('/login', async (req, res) => {
        const { cedula, password } = req.body;
        try {
            const cedulaSafe = asString(cedula);
            const passwordSafe = asString(password);
            const cedulaLimpia = cedulaSafe.toUpperCase().replace(/[^A-Z0-9]/g, '');
            const result = await pool.query('SELECT * FROM users WHERE cedula = $1', [cedulaLimpia]);
            const user = result.rows[0];
            if (!user) {
                return res.status(401).json({ status: 'error', message: 'Credenciales invalidas' });
            }
            const storedPassword = user.password;
            let passwordValid = false;
            if (isBcryptHash(storedPassword)) {
                passwordValid = await bcrypt.compare(passwordSafe, storedPassword);
            }
            else {
                passwordValid = passwordSafe === storedPassword;
                // Migra password legado en texto plano a bcrypt al primer login exitoso.
                if (passwordValid) {
                    const salt = await bcrypt.genSalt(10);
                    const hashedPassword = await bcrypt.hash(passwordSafe, salt);
                    await pool.query('UPDATE users SET password = $1 WHERE id = $2', [hashedPassword, user.id]);
                    user.password = hashedPassword;
                }
            }
            if (!passwordValid) {
                return res.status(401).json({ status: 'error', message: 'Credenciales invalidas' });
            }
            const userId = user.id;
            const adminRes = await pool.query('SELECT id FROM condominios WHERE admin_user_id = $1 LIMIT 1', [userId]);
            const hasAdminAccess = adminRes.rows.length > 0;
            let condominioId = adminRes.rows[0]?.id ?? null;
            if (!hasAdminAccess) {
                const upRes = await pool.query('SELECT rol, COALESCE(acceso_portal, true) AS acceso_portal FROM usuarios_propiedades WHERE user_id = $1', [userId]);
                const hasLinks = upRes.rows.length > 0;
                const hasPortalAccess = upRes.rows.some((r) => r.acceso_portal === true);
                if (hasLinks && !hasPortalAccess) {
                    return res.status(403).json({ status: 'error', message: 'Acceso al portal deshabilitado para este usuario.' });
                }
                if (hasPortalAccess) {
                    const condoRes = await pool.query(`
                            SELECT p.condominio_id
                            FROM usuarios_propiedades up
                            INNER JOIN propiedades p ON p.id = up.propiedad_id
                            WHERE up.user_id = $1
                              AND COALESCE(up.acceso_portal, true) = true
                              AND p.condominio_id IS NOT NULL
                            ORDER BY p.id ASC
                            LIMIT 1
                        `, [userId]);
                    condominioId = condoRes.rows[0]?.condominio_id ?? null;
                }
            }
            const token = jwt.sign({
                id: user.id,
                cedula: user.cedula,
                nombre: user.nombre,
                condominio_id: condominioId,
                is_admin: hasAdminAccess,
            }, process.env.JWT_SECRET, { expiresIn: '24h' });
            res.json({ status: 'success', token, user });
        }
        catch (err) {
            const error = err;
            res.status(500).json({ error: error.message });
        }
    });
    app.get('/me', verifyToken, async (req, res) => {
        try {
            const user = asAuthUser(req.user);
            const result = await pool.query('SELECT id, cedula, nombre, created_at FROM users WHERE id = $1', [user.id]);
            res.json({ status: 'success', user: result.rows[0] });
        }
        catch (err) {
            const error = err;
            res.status(500).json({ error: error.message });
        }
    });
};
module.exports = { registerAuthRoutes };
//# sourceMappingURL=auth.js.map