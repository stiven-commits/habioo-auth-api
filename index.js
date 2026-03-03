require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Conexión a PostgreSQL
const pool = new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
});

// ==========================================
// EL GUARDIA DE SEGURIDAD (MIDDLEWARE)
// ==========================================
const verifyToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    if (!authHeader) return res.status(403).json({ status: 'error', message: '¡Alto! No tienes Pase VIP.' });

    try {
        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded;
        next();
    } catch (err) {
        return res.status(401).json({ status: 'error', message: 'Pase VIP inválido o expirado.' });
    }
};

// Ruta de prueba
app.get('/', (req, res) => {
    res.json({ status: 'success', message: 'Auth Service is running!' });
});

// ==========================================
// INICIALIZACIÓN DE LA BÓVEDA (Base de Datos)
// ==========================================
app.get('/init-db', async (req, res) => {
    try {
        // 1. Usuarios
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                cedula VARCHAR(20) UNIQUE NOT NULL,
                nombre VARCHAR(100) NOT NULL,
                password VARCHAR(255) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // 2. Condominios
        await pool.query(`
            CREATE TABLE IF NOT EXISTS condominios (
                id SERIAL PRIMARY KEY,
                nombre VARCHAR(150) NOT NULL,
                tipo VARCHAR(50) CHECK (tipo IN ('Junta General', 'Junta Individual')),
                junta_general_id INT REFERENCES condominios(id),
                tasa_interes DECIMAL(5,2) DEFAULT 0.00,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // 3. Propiedades
        await pool.query(`
            CREATE TABLE IF NOT EXISTS propiedades (
                id SERIAL PRIMARY KEY,
                condominio_id INT REFERENCES condominios(id) ON DELETE CASCADE,
                identificador VARCHAR(50) NOT NULL,
                alicuota DECIMAL(8,4) DEFAULT 0.0000,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // 4. Tabla Puente (Usuarios - Propiedades)
        await pool.query(`
            CREATE TABLE IF NOT EXISTS usuarios_propiedades (
                id SERIAL PRIMARY KEY,
                user_id INT REFERENCES users(id) ON DELETE CASCADE,
                propiedad_id INT REFERENCES propiedades(id) ON DELETE CASCADE,
                rol VARCHAR(50) CHECK (rol IN ('Propietario', 'Inquilino', 'Administrador')),
                UNIQUE(user_id, propiedad_id)
            );
        `);

        // 5. Recibos
        await pool.query(`
            CREATE TABLE IF NOT EXISTS recibos (
                id SERIAL PRIMARY KEY,
                propiedad_id INT REFERENCES propiedades(id) ON DELETE CASCADE,
                mes_cobro VARCHAR(20) NOT NULL,
                monto_usd DECIMAL(10,2) NOT NULL,
                estado VARCHAR(50) CHECK (estado IN ('Preliminar', 'Aviso de Cobro', 'Pagado', 'Validado')),
                fecha_emision TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                fecha_vencimiento TIMESTAMP,
                n8n_pdf_url VARCHAR(255)
            );
        `);

        res.json({ status: 'success', message: '¡Estructura de la Bóveda creada con éxito!' });
    } catch (err) {
        res.status(500).json({ status: 'error', error: err.message });
    }
});

// ==========================================
// RUTAS DE AUTENTICACIÓN
// ==========================================
app.post('/register', async (req, res) => {
    const { cedula, nombre, password } = req.body;
    try {
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);
        const result = await pool.query(
            'INSERT INTO users (cedula, nombre, password) VALUES ($1, $2, $3) RETURNING id, cedula, nombre',
            [cedula, nombre, hashedPassword]
        );
        res.status(201).json({ status: 'success', user: result.rows[0] });
    } catch (err) {
        res.status(400).json({ status: 'error', message: 'La cédula ya existe o error de datos.', detail: err.message });
    }
});

app.post('/login', async (req, res) => {
    let { cedula, password } = req.body;
    
    try {
        // 1. LIMPIEZA AUTOMÁTICA: Quitamos guiones, espacios y ponemos mayúsculas
        // Si llega "V-12345678", lo convertimos en "V12345678" antes de buscar
        const cedulaLimpia = cedula.toUpperCase().replace(/[^A-Z0-9]/g, '');

        const result = await pool.query('SELECT * FROM users WHERE cedula = $1', [cedulaLimpia]);
        const user = result.rows[0];

        if (!user) return res.status(401).json({ status: 'error', message: 'Credenciales inválidas' });

        // 2. Comparamos la contraseña
        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) return res.status(401).json({ status: 'error', message: 'Credenciales inválidas' });

        const token = jwt.sign(
            { id: user.id, cedula: user.cedula, nombre: user.nombre },
            process.env.JWT_SECRET,
            { expiresIn: '24h' }
        );

        res.json({ status: 'success', token, user: { cedula: user.cedula, nombre: user.nombre } });
    } catch (err) {
        res.status(500).json({ status: 'error', error: err.message });
    }
});

// ==========================================
// RUTAS PROTEGIDAS (Requieren Token)
// ==========================================
app.get('/me', verifyToken, async (req, res) => {
    try {
        const result = await pool.query('SELECT id, cedula, nombre, created_at FROM users WHERE id = $1', [req.user.id]);
        const user = result.rows[0];
        if (!user) return res.status(404).json({ status: 'error', message: 'Usuario no encontrado.' });
        res.json({ status: 'success', user });
    } catch (err) {
        res.status(500).json({ status: 'error', error: err.message });
    }
});

app.get('/mis-propiedades', verifyToken, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT p.id as propiedad_id, p.identificador, c.nombre as condominio_nombre, up.rol
            FROM usuarios_propiedades up
            JOIN propiedades p ON up.propiedad_id = p.id
            JOIN condominios c ON p.condominio_id = c.id
            WHERE up.user_id = $1
        `, [req.user.id]);
        
        res.json({ status: 'success', propiedades: result.rows });
    } catch (err) {
        res.status(500).json({ status: 'error', error: err.message });
    }
});

app.get('/mis-finanzas', verifyToken, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT
                COALESCE(SUM(CASE WHEN r.estado = 'Aviso de Cobro' THEN r.monto_usd ELSE 0 END), 0) AS deuda_actual,
                COALESCE(SUM(CASE WHEN r.estado = 'Validado' THEN r.monto_usd ELSE 0 END), 0) AS total_pagado,
                COALESCE(COUNT(CASE WHEN r.estado = 'Aviso de Cobro' THEN 1 END), 0) AS recibos_pendientes
            FROM recibos r
            JOIN propiedades p ON r.propiedad_id = p.id
            JOIN usuarios_propiedades up ON up.propiedad_id = p.id
            WHERE up.user_id = $1
        `, [req.user.id]);

        res.json({ status: 'success', finanzas: result.rows[0] });
    } catch (err) {
        res.status(500).json({ status: 'error', error: err.message });
    }
});

// ==========================================
// REGISTRAR PROVEEDOR (Solo Juntas)
// ==========================================
app.post('/proveedores', verifyToken, async (req, res) => {
    // Validamos que el usuario sea una Junta (J-)
    if (!req.user.cedula.startsWith('J')) {
        return res.status(403).json({ status: 'error', message: 'Solo las Juntas de Condominio pueden registrar proveedores.' });
    }

    const { identificador, nombre, telefono1, telefono2, direccion, estado_venezuela } = req.body;

    try {
        const result = await pool.query(`
            INSERT INTO proveedores (identificador, nombre, telefono1, telefono2, direccion, estado_venezuela) 
            VALUES ($1, $2, $3, $4, $5, $6) RETURNING id
        `, [identificador, nombre, telefono1, telefono2, direccion, estado_venezuela]);
        
        res.json({ status: 'success', message: 'Proveedor registrado', id: result.rows[0].id });
    } catch (err) {
        if (err.code === '23505') { // Código de Postgres para "Ya existe" (Unique Constraint)
            return res.status(400).json({ status: 'error', message: 'Este proveedor ya existe en el directorio nacional.' });
        }
        res.status(500).json({ status: 'error', error: err.message });
    }
});

// ==========================================
// OBTENER DIRECTORIO DE PROVEEDORES
// ==========================================
app.get('/proveedores', verifyToken, async (req, res) => {
    try {
        // Ahora sí pedimos todos los datos: telefonos, direccion y estado
        const result = await pool.query(`
            SELECT id, identificador, nombre, telefono1, telefono2, direccion, estado_venezuela 
            FROM proveedores 
            ORDER BY nombre ASC
        `);
        res.json({ status: 'success', proveedores: result.rows });
    } catch (err) {
        res.status(500).json({ status: 'error', error: err.message });
    }
});

// ==========================================
// RUTA: REGISTRAR GASTO (Actualizada para Zonas)
// ==========================================
app.post('/gastos', verifyToken, async (req, res) => {
    if (!req.user.cedula.startsWith('J')) return res.status(403).json({ status: 'error', message: 'Acceso denegado' });
    
    const { proveedor_id, concepto, monto_bs, tasa_cambio, total_cuotas, nota, tipo, zona_id } = req.body;
    const parseNum = (v) => parseFloat(v.toString().replace(/\./g, '').replace(',', '.'));

    try {
        const m_bs = parseNum(monto_bs);
        const t_c = parseNum(tasa_cambio);
        const condoRes = await pool.query('SELECT id, ciclo_actual FROM condominios WHERE admin_user_id = $1 LIMIT 1', [req.user.id]);
        
        const condominio_id = condoRes.rows[0].id;
        const ciclo_actual = condoRes.rows[0].ciclo_actual;
        const monto_usd = (m_bs / t_c).toFixed(2);
        const monto_cuota_usd = (monto_usd / parseInt(total_cuotas)).toFixed(2);

        const result = await pool.query(`
            INSERT INTO gastos (condominio_id, proveedor_id, concepto, monto_bs, tasa_cambio, monto_usd, total_cuotas, nota, tipo, zona_id)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id
        `, [condominio_id, proveedor_id, concepto, m_bs, t_c, monto_usd, total_cuotas, nota, tipo || 'Comun', zona_id || null]);

        for (let i = 1; i <= total_cuotas; i++) {
            await pool.query(`INSERT INTO gastos_cuotas (gasto_id, numero_cuota, monto_cuota_usd, ciclo_asignado) VALUES ($1, $2, $3, $4)`, 
            [result.rows[0].id, i, monto_cuota_usd, ciclo_actual + (i - 1)]);
        }
        res.json({ status: 'success', message: 'Gasto registrado correctamente.' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ==========================================
// OBTENER HISTORIAL (Corregido: Trae Tipo y Zona)
// ==========================================
app.get('/gastos', verifyToken, async (req, res) => {
    if (!req.user.cedula.startsWith('J')) return res.status(403).json({ status: 'error', message: 'Acceso denegado' });
    
    try {
        const result = await pool.query(`
            SELECT g.id as gasto_id, gc.id as cuota_id, g.concepto, g.monto_bs, g.tasa_cambio, 
                   g.monto_usd as monto_total_usd, g.nota, p.nombre as proveedor, 
                   gc.numero_cuota, g.total_cuotas, gc.monto_cuota_usd, gc.ciclo_asignado, gc.estado,
                   TO_CHAR(g.fecha_gasto, 'DD/MM/YYYY') as fecha,
                   g.tipo, z.nombre as zona_nombre
            FROM gastos g
            JOIN gastos_cuotas gc ON g.id = gc.gasto_id
            JOIN proveedores p ON g.proveedor_id = p.id
            JOIN condominios c ON g.condominio_id = c.id
            LEFT JOIN zonas z ON g.zona_id = z.id
            WHERE c.admin_user_id = $1
            ORDER BY g.id DESC, gc.numero_cuota ASC
        `, [req.user.id]);
        
        res.json({ status: 'success', gastos: result.rows });
    } catch (err) {
        res.status(500).json({ status: 'error', error: err.message });
    }
});

// ==========================================
// ELIMINAR UN GASTO (Regla de Auditoría)
// ==========================================
app.delete('/gastos/:id', verifyToken, async (req, res) => {
    if (!req.user.cedula.startsWith('J')) return res.status(403).json({ status: 'error', message: 'Acceso denegado' });
    
    try {
        const gastoId = req.params.id;

        // 1. Buscamos la Junta
        const condoRes = await pool.query('SELECT id FROM condominios WHERE admin_user_id = $1 LIMIT 1', [req.user.id]);
        if (condoRes.rows.length === 0) return res.status(404).json({ status: 'error', message: 'Condominio no encontrado' });
        
        // 2. Auditoría: ¿Hay alguna cuota que ya se cobró o se procesó?
        const cuotasCheck = await pool.query("SELECT id FROM gastos_cuotas WHERE gasto_id = $1 AND estado != 'Pendiente'", [gastoId]);
        if (cuotasCheck.rows.length > 0) {
            return res.status(400).json({ status: 'error', message: '¡Alto! No puedes eliminar este gasto porque ya tiene cuotas procesadas o pagadas. Por auditoría, debe mantenerse.' });
        }

        // 3. Si todo está limpio, ejecutamos la eliminación en cascada
        await pool.query('DELETE FROM gastos_cuotas WHERE gasto_id = $1', [gastoId]);
        await pool.query('DELETE FROM gastos WHERE id = $1 AND condominio_id = $2', [gastoId, condoRes.rows[0].id]);

        res.json({ status: 'success', message: 'Gasto y sus cuotas eliminados exitosamente.' });
    } catch (err) {
        res.status(500).json({ status: 'error', error: err.message });
    }
});

// ==========================================
// VER EL PRELIMINAR (Actualizado con Nota y Detalles)
// ==========================================
app.get('/preliminar', verifyToken, async (req, res) => {
    if (!req.user.cedula.startsWith('J')) return res.status(403).json({ status: 'error', message: 'Acceso denegado' });
    
    try {
        const condoRes = await pool.query('SELECT id, ciclo_actual, metodo_division FROM condominios WHERE admin_user_id = $1 ORDER BY id ASC LIMIT 1', [req.user.id]);
        if (condoRes.rows.length === 0) return res.status(404).json({ status: 'error', message: 'Condominio no encontrado' });
        
        const { id: condominio_id, ciclo_actual, metodo_division } = condoRes.rows[0];

        // Extraemos todos los detalles para la modal
        const gastosRes = await pool.query(`
            SELECT g.concepto, gc.monto_cuota_usd, gc.numero_cuota, g.total_cuotas, p.nombre as proveedor, g.nota, g.monto_bs, g.tasa_cambio, g.monto_usd as monto_total_usd
            FROM gastos_cuotas gc
            JOIN gastos g ON gc.gasto_id = g.id
            JOIN proveedores p ON g.proveedor_id = p.id
            WHERE g.condominio_id = $1 AND gc.ciclo_asignado = $2 AND (gc.estado = 'Pendiente' OR gc.estado IS NULL)
        `, [condominio_id, ciclo_actual]);

        const total_usd = gastosRes.rows.reduce((sum, item) => sum + parseFloat(item.monto_cuota_usd), 0);

        res.json({ status: 'success', ciclo_actual, metodo_division, gastos: gastosRes.rows, total_usd: total_usd.toFixed(2) });
    } catch (err) {
        res.status(500).json({ status: 'error', error: err.message });
    }
});

// ==========================================
// MOTOR DE CIERRE: REPARTO POR ZONAS
// ==========================================
app.post('/cerrar-ciclo', verifyToken, async (req, res) => {
    if (!req.user.cedula.startsWith('J')) return res.status(403).json({ status: 'error', message: 'Acceso denegado' });
    
    try {
        const condoRes = await pool.query('SELECT id, ciclo_actual, metodo_division FROM condominios WHERE admin_user_id = $1 LIMIT 1', [req.user.id]);
        const { id: condo_id, ciclo_actual, metodo_division } = condoRes.rows[0];

        // 1. Obtener todas las propiedades
        const propRes = await pool.query('SELECT id, alicuota, zona_id FROM propiedades WHERE condominio_id = $1', [condo_id]);
        const propiedades = propRes.rows;

        // 2. Obtener cuotas del ciclo agrupadas por tipo/zona
        const cuotasRes = await pool.query(`
            SELECT gc.monto_cuota_usd, g.tipo, g.zona_id 
            FROM gastos_cuotas gc JOIN gastos g ON gc.gasto_id = g.id
            WHERE g.condominio_id = $1 AND gc.ciclo_asignado = $2 AND gc.estado = 'Pendiente'
        `, [condo_id, ciclo_actual]);
        
        const cuotas = cuotasRes.rows;

        // 3. REPARTO MATEMÁTICO (Actualizado para M:N)
        for (let p of propiedades) {
            let total_deuda_apto = 0;

            // Buscamos a qué zonas pertenece este apartamento específico
            const zonasDelApto = await pool.query('SELECT zona_id FROM propiedades_zonas WHERE propiedad_id = $1', [p.id]);
            const zonaIds = zonasDelApto.rows.map(z => z.zona_id); // Ej: [1, 5]

            for (let c of cuotas) {
                // Si es Gasto COMÚN (Para todos)
                if (c.tipo === 'Comun') {
                    if (metodo_division === 'Partes Iguales') total_deuda_apto += (parseFloat(c.monto_cuota_usd) / propiedades.length);
                    else total_deuda_apto += (parseFloat(c.monto_cuota_usd) * (parseFloat(p.alicuota) / 100));
                } 
                // Si es Gasto NO COMÚN (Verificamos si el apto está en la zona del gasto)
                else if (c.tipo === 'No Comun' && zonaIds.includes(c.zona_id)) {
                    // Contamos cuántas propiedades hay en esa zona específica para dividir
                    const propsEnZonaRes = await pool.query('SELECT COUNT(*) FROM propiedades_zonas WHERE zona_id = $1', [c.zona_id]);
                    const cantidadEnZona = parseInt(propsEnZonaRes.rows[0].count);

                    if (metodo_division === 'Partes Iguales') {
                        total_deuda_apto += (parseFloat(c.monto_cuota_usd) / cantidadEnZona);
                    } else {
                        // En No Comun por Alicuota, calculamos el % relativo a la zona
                        const alicuotasZonaRes = await pool.query(`
                            SELECT SUM(p.alicuota) as total 
                            FROM propiedades p 
                            JOIN propiedades_zonas pz ON p.id = pz.propiedad_id 
                            WHERE pz.zona_id = $1
                        `, [c.zona_id]);
                        const totalAlicuotaZona = parseFloat(alicuotasZonaRes.rows[0].total) || 100;
                        
                        total_deuda_apto += (parseFloat(c.monto_cuota_usd) * (parseFloat(p.alicuota) / totalAlicuotaZona));
                    }
                }
            }
        }

        await pool.query(`UPDATE gastos_cuotas SET estado = 'Procesado' FROM gastos WHERE gastos_cuotas.gasto_id = gastos.id AND gastos.condominio_id = $1 AND gastos_cuotas.ciclo_asignado = $2`, [condo_id, ciclo_actual]);
        await pool.query('UPDATE condominios SET ciclo_actual = ciclo_actual + 1 WHERE id = $1', [condo_id]);

        res.json({ status: 'success', message: 'Cierre completado con reparto por zonas.' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});
// ==========================================
// GESTIÓN DE PROPIEDADES E INQUILINOS (Lógica Fase 3)
// ==========================================

// 1. OBTENER (Con datos de Dueño e Inquilino)
app.get('/propiedades-admin', verifyToken, async (req, res) => {
    if (!req.user.cedula.startsWith('J')) return res.status(403).json({ status: 'error', message: 'Acceso denegado' });
    
    try {
        const condoRes = await pool.query('SELECT id FROM condominios WHERE admin_user_id = $1 LIMIT 1', [req.user.id]);
        if (condoRes.rows.length === 0) return res.status(404).json({ status: 'error', message: 'Condominio no encontrado' });
        
        const result = await pool.query(`
            SELECT 
                p.id, p.identificador, p.alicuota,
                u1.id as prop_id, u1.nombre as prop_nombre, u1.cedula as prop_cedula, u1.email as prop_email, u1.telefono as prop_telefono,
                u2.id as inq_id, u2.nombre as inq_nombre, u2.cedula as inq_cedula, u2.email as inq_email, u2.telefono as inq_telefono
            FROM propiedades p
            LEFT JOIN usuarios_propiedades up1 ON p.id = up1.propiedad_id AND up1.rol = 'Propietario'
            LEFT JOIN users u1 ON up1.user_id = u1.id
            LEFT JOIN usuarios_propiedades up2 ON p.id = up2.propiedad_id AND up2.rol = 'Inquilino'
            LEFT JOIN users u2 ON up2.user_id = u2.id
            WHERE p.condominio_id = $1
            ORDER BY p.identificador ASC
        `, [condoRes.rows[0].id]);

        res.json({ status: 'success', propiedades: result.rows });
    } catch (err) {
        res.status(500).json({ status: 'error', error: err.message });
    }
});

// 2. CREAR (Genera usuarios automáticos)
app.post('/propiedades-admin', verifyToken, async (req, res) => {
    if (!req.user.cedula.startsWith('J')) return res.status(403).json({ status: 'error', message: 'Acceso denegado' });
    
    const { 
        identificador, alicuota, 
        prop_nombre, prop_cedula, prop_email, prop_telefono,
        tiene_inquilino, inq_nombre, inq_cedula, inq_email, inq_telefono 
    } = req.body;
    
    // Función auxiliar para buscar o crear usuario
    const findOrCreateUser = async (nombre, cedula, email, telefono) => {
        if (!cedula) return null;
        let userRes = await pool.query('SELECT id FROM users WHERE cedula = $1', [cedula]);
        
        if (userRes.rows.length > 0) {
            if (email || telefono) {
                await pool.query('UPDATE users SET email = COALESCE($1, email), telefono = COALESCE($2, telefono) WHERE id = $3', [email, telefono, userRes.rows[0].id]);
            }
            return userRes.rows[0].id;
        } else {
            const salt = await bcrypt.genSalt(10);
            const hashedPassword = await bcrypt.hash(cedula, salt); // Clave inicial = Cédula
            const newUser = await pool.query(
                'INSERT INTO users (nombre, cedula, email, telefono, password) VALUES ($1, $2, $3, $4, $5) RETURNING id',
                [nombre, cedula, email, telefono, hashedPassword]
            );
            return newUser.rows[0].id;
        }
    };

    try {
        const condoRes = await pool.query('SELECT id FROM condominios WHERE admin_user_id = $1 LIMIT 1', [req.user.id]);
        if (condoRes.rows.length === 0) return res.status(404).json({ status: 'error', message: 'Condominio no encontrado' });
        const condominio_id = condoRes.rows[0].id;
        
        const parsedAlicuota = parseFloat(alicuota.toString().replace(',', '.')) || 0;

        const propRes = await pool.query(
            'INSERT INTO propiedades (condominio_id, identificador, alicuota) VALUES ($1, $2, $3) RETURNING id',
            [condominio_id, identificador, parsedAlicuota]
        );
        const propiedad_id = propRes.rows[0].id;

        const propUserId = await findOrCreateUser(prop_nombre, prop_cedula, prop_email, prop_telefono);
        if (propUserId) {
            await pool.query(
                'INSERT INTO usuarios_propiedades (user_id, propiedad_id, rol) VALUES ($1, $2, $3)',
                [propUserId, propiedad_id, 'Propietario']
            );
        }

        if (tiene_inquilino && inq_cedula) {
            const inqUserId = await findOrCreateUser(inq_nombre, inq_cedula, inq_email, inq_telefono);
            if (inqUserId) {
                await pool.query(
                    'INSERT INTO usuarios_propiedades (user_id, propiedad_id, rol) VALUES ($1, $2, $3)',
                    [inqUserId, propiedad_id, 'Inquilino']
                );
            }
        }

        res.json({ status: 'success', message: 'Inmueble y residentes registrados con acceso.' });
    } catch (err) {
        res.status(500).json({ status: 'error', error: err.message });
    }
});

// 3. EDITAR (Permite cambiar contraseñas y corregir datos)
app.put('/propiedades-admin/:id', verifyToken, async (req, res) => {
    if (!req.user.cedula.startsWith('J')) return res.status(403).json({ status: 'error', message: 'Acceso denegado' });
    
    const propId = req.params.id;
    const { 
        identificador, alicuota, 
        prop_nombre, prop_cedula, prop_email, prop_telefono, prop_password,
        tiene_inquilino, inq_nombre, inq_cedula, inq_email, inq_telefono, inq_password
    } = req.body;

    const upsertUser = async (rol, nombre, cedula, email, telefono, password) => {
        if (!cedula) return;

        let userRes = await pool.query('SELECT id FROM users WHERE cedula = $1', [cedula]);
        let userId;

        if (userRes.rows.length > 0) {
            userId = userRes.rows[0].id;
            let query = 'UPDATE users SET nombre = $1, email = $2, telefono = $3';
            let params = [nombre, email, telefono];
            
            if (password && password.trim() !== "") {
                const salt = await bcrypt.genSalt(10);
                const hash = await bcrypt.hash(password, salt);
                query += `, password = $${params.length + 1} WHERE id = $${params.length + 2}`;
                params.push(hash, userId);
            } else {
                query += ` WHERE id = $${params.length + 1}`;
                params.push(userId);
            }
            await pool.query(query, params);
        } else {
            const salt = await bcrypt.genSalt(10);
            const hash = await bcrypt.hash(password || cedula, salt); 
            const newUser = await pool.query(
                'INSERT INTO users (nombre, cedula, email, telefono, password) VALUES ($1, $2, $3, $4, $5) RETURNING id',
                [nombre, cedula, email, telefono, hash]
            );
            userId = newUser.rows[0].id;
        }

        await pool.query("DELETE FROM usuarios_propiedades WHERE propiedad_id = $1 AND rol = $2", [propId, rol]);
        await pool.query(
            'INSERT INTO usuarios_propiedades (user_id, propiedad_id, rol) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
            [userId, propId, rol]
        );
    };

    try {
        const parsedAlicuota = parseFloat(alicuota.toString().replace(',', '.')) || 0;
        await pool.query('UPDATE propiedades SET identificador = $1, alicuota = $2 WHERE id = $3', [identificador, parsedAlicuota, propId]);
        await upsertUser('Propietario', prop_nombre, prop_cedula, prop_email, prop_telefono, prop_password);

        if (tiene_inquilino && inq_cedula) {
            await upsertUser('Inquilino', inq_nombre, inq_cedula, inq_email, inq_telefono, inq_password);
        } else {
            await pool.query("DELETE FROM usuarios_propiedades WHERE propiedad_id = $1 AND rol = 'Inquilino'", [propId]);
        }

        res.json({ status: 'success', message: 'Datos actualizados correctamente.' });
    } catch (err) {
        res.status(500).json({ status: 'error', error: err.message });
    }
});
// ==========================================
// CUENTAS POR COBRAR (Avisos de Cobro)
// ==========================================
app.get('/cuentas-por-cobrar', verifyToken, async (req, res) => {
    if (!req.user.cedula.startsWith('J')) return res.status(403).json({ status: 'error', message: 'Acceso denegado' });
    
    try {
        // 1. Buscamos la Junta
        const condoRes = await pool.query('SELECT id FROM condominios WHERE admin_user_id = $1 ORDER BY id ASC LIMIT 1', [req.user.id]);
        if (condoRes.rows.length === 0) return res.status(404).json({ status: 'error', message: 'Condominio no encontrado' });
        
        const condominio_id = condoRes.rows[0].id;

        // 2. Buscamos todos los recibos de las propiedades de este condominio
        const result = await pool.query(`
            SELECT r.id, p.identificador as inmueble, r.mes_cobro as ciclo, r.monto_usd, r.estado, 
                   TO_CHAR(r.fecha_emision, 'DD/MM/YYYY') as fecha
            FROM recibos r
            JOIN propiedades p ON r.propiedad_id = p.id
            WHERE p.condominio_id = $1
            ORDER BY r.id DESC
        `, [condominio_id]);

        res.json({ status: 'success', recibos: result.rows });
    } catch (err) {
        res.status(500).json({ status: 'error', error: err.message });
    }
});
// ==========================================
// GESTIÓN DE CUENTAS BANCARIAS
// ==========================================
app.get('/bancos', verifyToken, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT cb.* FROM cuentas_bancarias cb
            JOIN condominios c ON cb.condominio_id = c.id
            WHERE c.admin_user_id = $1 ORDER BY cb.nombre_banco ASC
        `, [req.user.id]);
        res.json({ status: 'success', bancos: result.rows });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/bancos', verifyToken, async (req, res) => {
    const { numero_cuenta, nombre_banco, apodo } = req.body;
    try {
        const condoRes = await pool.query('SELECT id FROM condominios WHERE admin_user_id = $1 LIMIT 1', [req.user.id]);
        await pool.query(
            'INSERT INTO cuentas_bancarias (condominio_id, numero_cuenta, nombre_banco, apodo) VALUES ($1, $2, $3, $4)',
            [condoRes.rows[0].id, numero_cuenta, nombre_banco, apodo]
        );
        res.json({ status: 'success', message: 'Cuenta bancaria registrada.' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/bancos/:id', verifyToken, async (req, res) => {
    try {
        await pool.query('DELETE FROM cuentas_bancarias WHERE id = $1', [req.params.id]);
        res.json({ status: 'success', message: 'Cuenta eliminada.' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ==========================================
// GESTIÓN DE ZONAS (Multizona)
// ==========================================
// ==========================================
// GESTIÓN DE ZONAS (Multizona con Auditoría)
// ==========================================
app.get('/zonas', verifyToken, async (req, res) => {
    try {
        const condoRes = await pool.query('SELECT id FROM condominios WHERE admin_user_id = $1 LIMIT 1', [req.user.id]);
        if (condoRes.rows.length === 0) return res.status(404).json({ status: 'error', message: 'Condominio no encontrado' });
        const condo_id = condoRes.rows[0].id;

        // Buscamos zonas y calculamos si tienen gastos asociados (Auditoría)
        const zonasRes = await pool.query(`
            SELECT z.id, z.nombre, z.activa,
                   (SELECT COUNT(*) FROM gastos g WHERE g.zona_id = z.id) > 0 as tiene_gastos
            FROM zonas z 
            WHERE z.condominio_id = $1 
            ORDER BY z.activa DESC, z.nombre ASC
        `, [condo_id]);
        
        const zonas = zonasRes.rows;

        // Adjuntamos las propiedades de cada zona
        for (let zona of zonas) {
            const propsRes = await pool.query(`
                SELECT p.id, p.identificador 
                FROM propiedades p
                JOIN propiedades_zonas pz ON p.id = pz.propiedad_id
                WHERE pz.zona_id = $1
            `, [zona.id]);
            zona.propiedades = propsRes.rows;
            zona.propiedades_ids = propsRes.rows.map(p => p.id); // Para facilitar la edición en frontend
        }

        const allProps = await pool.query('SELECT id, identificador FROM propiedades WHERE condominio_id = $1 ORDER BY identificador ASC', [condo_id]);

        res.json({ status: 'success', zonas, todas_propiedades: allProps.rows });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/zonas', verifyToken, async (req, res) => {
    const { nombre, propiedades_ids } = req.body;
    try {
        const condoRes = await pool.query('SELECT id FROM condominios WHERE admin_user_id = $1 LIMIT 1', [req.user.id]);
        
        const zonaRes = await pool.query(
            'INSERT INTO zonas (condominio_id, nombre, activa) VALUES ($1, $2, true) RETURNING id',
            [condoRes.rows[0].id, nombre]
        );
        const zona_id = zonaRes.rows[0].id;

        if (propiedades_ids && propiedades_ids.length > 0) {
            for (let prop_id of propiedades_ids) {
                await pool.query('INSERT INTO propiedades_zonas (zona_id, propiedad_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [zona_id, prop_id]);
            }
        }
        res.json({ status: 'success', message: 'Zona creada exitosamente.' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// NUEVO: Editar Zona (Nombre, Propiedades y Estado)
app.put('/zonas/:id', verifyToken, async (req, res) => {
    const { id } = req.params;
    const { nombre, propiedades_ids, activa } = req.body;
    
    try {
        // 1. Verificar si tiene gastos (Seguridad extra aunque el frontend lo bloquee)
        const checkGastos = await pool.query('SELECT COUNT(*) FROM gastos WHERE zona_id = $1', [id]);
        const tieneGastos = parseInt(checkGastos.rows[0].count) > 0;

        // Actualizamos datos básicos
        await pool.query('UPDATE zonas SET nombre = $1, activa = $2 WHERE id = $3', [nombre, activa, id]);

        // Si NO tiene gastos, permitimos cambiar la estructura de apartamentos
        // Si TIENE gastos, protegemos la estructura para no romper recibos viejos, pero permitimos cambiar nombre/estado
        if (!tieneGastos && propiedades_ids) {
            // Borramos relaciones viejas y ponemos las nuevas
            await pool.query('DELETE FROM propiedades_zonas WHERE zona_id = $1', [id]);
            for (let prop_id of propiedades_ids) {
                await pool.query('INSERT INTO propiedades_zonas (zona_id, propiedad_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [id, prop_id]);
            }
        }

        res.json({ status: 'success', message: 'Zona actualizada.' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/zonas/:id', verifyToken, async (req, res) => {
    try {
        // Validación de seguridad: No borrar si hay gastos
        const check = await pool.query('SELECT id FROM gastos WHERE zona_id = $1 LIMIT 1', [req.params.id]);
        if (check.rows.length > 0) {
            return res.status(400).json({ status: 'error', message: 'No se puede eliminar: Esta zona tiene historial contable. Desactívala en su lugar.' });
        }

        await pool.query('DELETE FROM zonas WHERE id = $1', [req.params.id]);
        res.json({ status: 'success', message: 'Zona eliminada.' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});
app.listen(PORT, () => console.log(`Servidor corriendo en el puerto ${PORT}`));
