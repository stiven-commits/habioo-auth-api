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
    if (!req.user.cedula.startsWith('J-')) {
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
// REGISTRAR UN GASTO FÍSICO (Actualizado con Nota)
// ==========================================
app.post('/gastos', verifyToken, async (req, res) => {
    if (!req.user.cedula.startsWith('J-')) return res.status(403).json({ status: 'error', message: 'Solo las Juntas pueden registrar gastos.' });

    const { proveedor_id, concepto, monto_bs, tasa_cambio, total_cuotas, nota } = req.body;

    const parseLatamNum = (val) => {
        if (!val) return 0;
        return parseFloat(val.toString().replace(/\./g, '').replace(',', '.'));
    };

    try {
        const m_bs = parseLatamNum(monto_bs);
        const t_c = parseLatamNum(tasa_cambio);

        if (!proveedor_id) return res.status(400).json({ status: 'error', message: 'Debes seleccionar un proveedor.' });
        if (isNaN(m_bs) || isNaN(t_c) || t_c <= 0 || m_bs <= 0) return res.status(400).json({ status: 'error', message: 'Error matemático en monto o tasa.' });

        const condoRes = await pool.query('SELECT id, ciclo_actual FROM condominios WHERE admin_user_id = $1 ORDER BY id ASC LIMIT 1', [req.user.id]);
        if (condoRes.rows.length === 0) return res.status(404).json({ status: 'error', message: 'Condominio no encontrado.' });

        const condominio_id = condoRes.rows[0].id;
        const ciclo_actual = condoRes.rows[0].ciclo_actual || 1;

        const monto_usd = (m_bs / t_c).toFixed(2);
        const monto_cuota_usd = (monto_usd / parseInt(total_cuotas)).toFixed(2);

        // Guardamos el gasto INCLUYENDO la nota
        const gastoRes = await pool.query(`
            INSERT INTO gastos (condominio_id, proveedor_id, concepto, monto_bs, tasa_cambio, monto_usd, total_cuotas, nota)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id
        `, [condominio_id, proveedor_id, concepto, m_bs, t_c, monto_usd, total_cuotas, nota || '']);
        
        const gasto_id = gastoRes.rows[0].id;

        for (let i = 1; i <= total_cuotas; i++) {
            const ciclo_asignado = ciclo_actual + (i - 1);
            await pool.query(`
                INSERT INTO gastos_cuotas (gasto_id, numero_cuota, monto_cuota_usd, ciclo_asignado, estado)
                VALUES ($1, $2, $3, $4, 'Pendiente')
            `, [gasto_id, i, monto_cuota_usd, ciclo_asignado]);
        }

        res.json({ status: 'success', message: 'Gasto contable registrado con éxito' });
    } catch (err) {
        res.status(500).json({ status: 'error', error: err.message });
    }
});

// ==========================================
// OBTENER HISTORIAL DE GASTOS (Agrupado y con Fecha)
// ==========================================
app.get('/gastos', verifyToken, async (req, res) => {
    if (!req.user.cedula.startsWith('J-')) return res.status(403).json({ status: 'error', message: 'Acceso denegado' });
    
    try {
        const result = await pool.query(`
            SELECT g.id as gasto_id, gc.id as cuota_id, g.concepto, g.monto_bs, g.tasa_cambio, 
                   g.monto_usd as monto_total_usd, g.nota, p.nombre as proveedor, 
                   gc.numero_cuota, g.total_cuotas, gc.monto_cuota_usd, gc.ciclo_asignado, gc.estado,
                   TO_CHAR(g.fecha_gasto, 'DD/MM/YYYY') as fecha
            FROM gastos g
            JOIN gastos_cuotas gc ON g.id = gc.gasto_id
            JOIN proveedores p ON g.proveedor_id = p.id
            JOIN condominios c ON g.condominio_id = c.id
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
    if (!req.user.cedula.startsWith('J-')) return res.status(403).json({ status: 'error', message: 'Acceso denegado' });
    
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
    if (!req.user.cedula.startsWith('J-')) return res.status(403).json({ status: 'error', message: 'Acceso denegado' });
    
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
// APROBAR PRELIMINAR, REPARTIR DEUDAS Y AVANZAR CICLO
// ==========================================
app.post('/cerrar-ciclo', verifyToken, async (req, res) => {
    if (!req.user.cedula.startsWith('J-')) return res.status(403).json({ status: 'error', message: 'Acceso denegado' });
    
    try {
        // 1. Buscar los datos del Condominio
        const condoRes = await pool.query('SELECT id, ciclo_actual, metodo_division FROM condominios WHERE admin_user_id = $1 ORDER BY id ASC LIMIT 1', [req.user.id]);
        if (condoRes.rows.length === 0) return res.status(404).json({ status: 'error', message: 'Condominio no encontrado' });
        
        const { id: condominio_id, ciclo_actual, metodo_division } = condoRes.rows[0];

        // 2. Sumar todo el dinero de la caja de este ciclo
        const gastosRes = await pool.query(`
            SELECT COALESCE(SUM(gc.monto_cuota_usd), 0) as total_usd
            FROM gastos_cuotas gc
            JOIN gastos g ON gc.gasto_id = g.id
            WHERE g.condominio_id = $1 AND gc.ciclo_asignado = $2 AND (gc.estado = 'Pendiente' OR gc.estado IS NULL)
        `, [condominio_id, ciclo_actual]);

        const total_gastos = parseFloat(gastosRes.rows[0].total_usd);

        if (total_gastos <= 0) {
            return res.status(400).json({ status: 'error', message: 'No hay gastos pendientes para cobrar en este ciclo.' });
        }

        // 3. Buscar los apartamentos a los que se les va a cobrar
        const propRes = await pool.query('SELECT id, identificador, alicuota FROM propiedades WHERE condominio_id = $1', [condominio_id]);
        const propiedades = propRes.rows;

        if (propiedades.length === 0) {
            return res.status(400).json({ status: 'error', message: '¡Alto! No puedes cobrar si no hay inmuebles registrados.' });
        }

        // 4. El Motor Matemático (Repartir la deuda)
        const mes_cobro = `Ciclo ${ciclo_actual}`; 

        for (let prop of propiedades) {
            let monto_deuda = 0;

            if (metodo_division === 'Partes Iguales') {
                monto_deuda = (total_gastos / propiedades.length).toFixed(2);
            } else {
                // Matemática por Alícuota (Porcentaje)
                monto_deuda = (total_gastos * (parseFloat(prop.alicuota) / 100)).toFixed(2);
            }

            // Inyectamos la deuda al vecino
            await pool.query(`
                INSERT INTO recibos (propiedad_id, mes_cobro, monto_usd, estado)
                VALUES ($1, $2, $3, 'Aviso de Cobro')
            `, [prop.id, mes_cobro, monto_deuda]);
        }

        // 5. Congelar los gastos para que no se cobren dos veces
        await pool.query(`
            UPDATE gastos_cuotas 
            SET estado = 'Procesado' 
            FROM gastos 
            WHERE gastos_cuotas.gasto_id = gastos.id 
            AND gastos.condominio_id = $1 
            AND gastos_cuotas.ciclo_asignado = $2
        `, [condominio_id, ciclo_actual]);

        // 6. Avanzar el reloj de la Junta al siguiente Ciclo
        await pool.query('UPDATE condominios SET ciclo_actual = ciclo_actual + 1 WHERE id = $1', [condominio_id]);

        res.json({ 
            status: 'success', 
            message: `¡Cierre exitoso! Se procesaron $${total_gastos} y se generaron deudas para ${propiedades.length} inmuebles. Avanzamos al Ciclo ${ciclo_actual + 1}.` 
        });
    } catch (err) {
        res.status(500).json({ status: 'error', error: err.message });
    }
});
// ==========================================
// GESTIÓN DE PROPIEDADES E INQUILINOS (Lógica Fase 3)
// ==========================================

// 1. OBTENER (Con datos de Dueño e Inquilino)
app.get('/propiedades-admin', verifyToken, async (req, res) => {
    if (!req.user.cedula.startsWith('J-')) return res.status(403).json({ status: 'error', message: 'Acceso denegado' });
    
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
    if (!req.user.cedula.startsWith('J-')) return res.status(403).json({ status: 'error', message: 'Acceso denegado' });
    
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
    if (!req.user.cedula.startsWith('J-')) return res.status(403).json({ status: 'error', message: 'Acceso denegado' });
    
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
    if (!req.user.cedula.startsWith('J-')) return res.status(403).json({ status: 'error', message: 'Acceso denegado' });
    
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
app.listen(PORT, () => console.log(`Servidor corriendo en el puerto ${PORT}`));
