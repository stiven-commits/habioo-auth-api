const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const registerAuthRoutes = (app, { pool, verifyToken }) => {
    app.post('/register', async (req, res) => {
        const { cedula, nombre, password } = req.body;
        try {
            const salt = await bcrypt.genSalt(10);
            const hashedPassword = await bcrypt.hash(password, salt);
            const result = await pool.query(
                'INSERT INTO users (cedula, nombre, password) VALUES ($1, $2, $3) RETURNING id',
                [cedula, nombre, hashedPassword]
            );
            res.status(201).json({ status: 'success', user: result.rows[0] });
        } catch (err) {
            res.status(400).json({ status: 'error', error: err.message });
        }
    });

    app.post('/login', async (req, res) => {
        const { cedula, password } = req.body;
        try {
            const cedulaLimpia = cedula.toUpperCase().replace(/[^A-Z0-9]/g, '');
            const result = await pool.query('SELECT * FROM users WHERE cedula = $1', [cedulaLimpia]);
            if (!result.rows[0] || !(await bcrypt.compare(password, result.rows[0].password))) {
                return res.status(401).json({ status: 'error', message: 'Credenciales invalidas' });
            }
            const token = jwt.sign(
                { id: result.rows[0].id, cedula: result.rows[0].cedula, nombre: result.rows[0].nombre },
                process.env.JWT_SECRET,
                { expiresIn: '24h' }
            );
            res.json({ status: 'success', token, user: result.rows[0] });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    app.get('/me', verifyToken, async (req, res) => {
        try {
            const result = await pool.query('SELECT id, cedula, nombre, created_at FROM users WHERE id = $1', [req.user.id]);
            res.json({ status: 'success', user: result.rows[0] });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });
};

module.exports = { registerAuthRoutes };

