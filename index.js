require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// NUEVAS LIBRERÃAS PARA IMÃGENES
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const sharp = require('sharp');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// ==========================================
// CONFIGURACIÃ“N DE ALMACENAMIENTO DE IMÃGENES
// ==========================================
const uploadsDir = path.join(__dirname, 'uploads', 'gastos');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true }); // Crea la carpeta si no existe
}
// Hacer pÃºblica la carpeta de uploads para que el frontend pueda verlas
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Multer se configura mÃ¡s abajo en el mÃ³dulo de gastos

// ConexiÃ³n a PostgreSQL
const pool = new Pool({
    host: process.env.DB_HOST, port: process.env.DB_PORT,
    user: process.env.DB_USER, password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
});

const verifyToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    if (!authHeader) return res.status(403).json({ status: 'error', message: 'Acceso denegado.' });
    try {
        const token = authHeader.split(' ')[1];
        req.user = jwt.verify(token, process.env.JWT_SECRET);
        next();
    } catch (err) { return res.status(401).json({ status: 'error', message: 'Token invÃ¡lido.' }); }
};

app.get('/', (req, res) => res.json({ status: 'success', message: 'Auth Service is running!' }));

// ==========================================
// RUTAS DE AUTENTICACIÃ“N (Resumidas)
// ==========================================
app.post('/register', async (req, res) => {
    const { cedula, nombre, password } = req.body;
    try {
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);
        const result = await pool.query('INSERT INTO users (cedula, nombre, password) VALUES ($1, $2, $3) RETURNING id', [cedula, nombre, hashedPassword]);
        res.status(201).json({ status: 'success', user: result.rows[0] });
    } catch (err) { res.status(400).json({ status: 'error', error: err.message }); }
});

app.post('/login', async (req, res) => {
    let { cedula, password } = req.body;
    try {
        const cedulaLimpia = cedula.toUpperCase().replace(/[^A-Z0-9]/g, '');
        const result = await pool.query('SELECT * FROM users WHERE cedula = $1', [cedulaLimpia]);
        if (!result.rows[0] || !(await bcrypt.compare(password, result.rows[0].password))) {
            return res.status(401).json({ status: 'error', message: 'Credenciales invÃ¡lidas' });
        }
        const token = jwt.sign({ id: result.rows[0].id, cedula: result.rows[0].cedula, nombre: result.rows[0].nombre }, process.env.JWT_SECRET, { expiresIn: '24h' });
        res.json({ status: 'success', token, user: result.rows[0] });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/me', verifyToken, async (req, res) => {
    try {
        const result = await pool.query('SELECT id, cedula, nombre, created_at FROM users WHERE id = $1', [req.user.id]);
        res.json({ status: 'success', user: result.rows[0] });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// HELPERS DE CALENDARIO
const addMonths = (yyyy_mm, m) => {
    let [year, month] = yyyy_mm.split('-').map(Number);
    month += m; while (month > 12) { month -= 12; year += 1; }
    return `${year}-${month.toString().padStart(2, '0')}`;
};

// Parsea formato ES: 1.234,56 -> 1234.56
const parseLocaleNumber = (value, fallback = 0) => {
    if (value === null || value === undefined || value === '') return fallback;
    const normalized = value.toString().replace(/\./g, '').replace(',', '.');
    const parsed = parseFloat(normalized);
    return Number.isFinite(parsed) ? parsed : fallback;
};
const formatMonthText = (YYYYMM) => {
    if (!YYYYMM) return '';
    const [year, month] = YYYYMM.split('-');
    const months = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
    return `${months[parseInt(month, 10) - 1]} ${year}`;
};

// ==========================================
// MÃ“DULO DE GASTOS (FACTURA + SOPORTES)
// ==========================================
// Configurar Multer para aceptar 2 campos distintos
const upload = multer({ 
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 } // Max 10MB por archivo
});

app.post('/gastos', verifyToken, upload.fields([{ name: 'factura_img', maxCount: 1 }, { name: 'soportes', maxCount: 4 }]), async (req, res) => {
    if (!req.user.cedula.startsWith('J')) return res.status(403).json({ status: 'error', message: 'Acceso denegado' });
    
    // Agregamos propiedad_id
    const { proveedor_id, concepto, monto_bs, tasa_cambio, total_cuotas, nota, tipo, zona_id, propiedad_id, fecha_gasto } = req.body;
    const parseNum = (v) => parseFloat(v.toString().replace(/\./g, '').replace(',', '.'));

    try {
        let facturaGuardada = null;
        let soportesGuardados = [];

        if (req.files) {
            if (req.files['factura_img'] && req.files['factura_img'].length > 0) {
                const file = req.files['factura_img'][0];
                const uniqueName = `factura_${Date.now()}_${Math.round(Math.random() * 1E9)}.webp`;
                await sharp(file.buffer).resize({ width: 1200, withoutEnlargement: true }).webp({ quality: 80 }).toFile(path.join(uploadsDir, uniqueName));
                facturaGuardada = `/uploads/gastos/${uniqueName}`;
            }
            if (req.files['soportes'] && req.files['soportes'].length > 0) {
                for (const file of req.files['soportes']) {
                    const uniqueName = `soporte_${Date.now()}_${Math.round(Math.random() * 1E9)}.webp`;
                    await sharp(file.buffer).resize({ width: 1200, withoutEnlargement: true }).webp({ quality: 80 }).toFile(path.join(uploadsDir, uniqueName));
                    soportesGuardados.push(`/uploads/gastos/${uniqueName}`);
                }
            }
        }

        const m_bs = parseLocaleNumber(monto_bs);
        const t_c = parseLocaleNumber(tasa_cambio);
        
        const condoRes = await pool.query('SELECT id, mes_actual FROM condominios WHERE admin_user_id = $1 LIMIT 1', [req.user.id]);
        const condominio_id = condoRes.rows[0].id;
        const mes_actual = condoRes.rows[0].mes_actual; 
        
        const monto_usd = (m_bs / t_c).toFixed(2);
        const monto_cuota_usd = (monto_usd / parseInt(total_cuotas)).toFixed(2);

        const mes_factura = fecha_gasto ? fecha_gasto.substring(0, 7) : mes_actual;
        const mes_inicio_cobro = (mes_factura > mes_actual) ? mes_factura : mes_actual;

        // LÃ³gica de validaciÃ³n de campos segÃºn el tipo
        const dbTipo = tipo || 'Comun';
        const zId = (dbTipo === 'Zona' || dbTipo === 'No Comun') ? (zona_id || null) : null;
        const pId = dbTipo === 'Individual' ? (propiedad_id || null) : null;

        const result = await pool.query(`
            INSERT INTO gastos (condominio_id, proveedor_id, concepto, monto_bs, tasa_cambio, monto_usd, total_cuotas, nota, tipo, zona_id, propiedad_id, fecha_gasto, factura_img, imagenes)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING id
        `, [condominio_id, proveedor_id, concepto, m_bs, t_c, monto_usd, total_cuotas, nota, dbTipo, zId, pId, fecha_gasto || null, facturaGuardada, soportesGuardados]);

        for (let i = 1; i <= total_cuotas; i++) {
            const mes_cuota = addMonths(mes_inicio_cobro, i - 1);
            await pool.query(`INSERT INTO gastos_cuotas (gasto_id, numero_cuota, monto_cuota_usd, mes_asignado) VALUES ($1, $2, $3, $4)`, 
            [result.rows[0].id, i, monto_cuota_usd, mes_cuota]);
        }
        res.json({ status: 'success', message: 'Gasto registrado con Ã©xito.' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/gastos', verifyToken, async (req, res) => {
    if (!req.user.cedula.startsWith('J')) return res.status(403).json({ status: 'error' });
    try {
        const result = await pool.query(`
            SELECT g.id as gasto_id, gc.id as cuota_id, g.concepto, g.monto_bs, g.tasa_cambio, 
                   g.monto_usd as monto_total_usd, g.nota, p.nombre as proveedor, 
                   gc.numero_cuota, g.total_cuotas, gc.monto_cuota_usd, gc.mes_asignado, gc.estado,
                   TO_CHAR(g.created_at, 'DD/MM/YYYY') as fecha_registro,
                   TO_CHAR(g.fecha_gasto, 'DD/MM/YYYY') as fecha_factura,
                   g.tipo, z.nombre as zona_nombre, prop.identificador as propiedad_identificador,
                   g.factura_img, g.imagenes, 
                   GREATEST(0, g.monto_usd - (gc.monto_cuota_usd * gc.numero_cuota)) as saldo_pendiente
            FROM gastos g
            JOIN gastos_cuotas gc ON g.id = gc.gasto_id
            JOIN proveedores p ON g.proveedor_id = p.id
            JOIN condominios c ON g.condominio_id = c.id
            LEFT JOIN zonas z ON g.zona_id = z.id
            LEFT JOIN propiedades prop ON g.propiedad_id = prop.id
            WHERE c.admin_user_id = $1 ORDER BY g.id DESC, gc.numero_cuota ASC
        `, [req.user.id]);
        res.json({ status: 'success', gastos: result.rows });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/gastos/:id', verifyToken, async (req, res) => {
    try {
        const gastoId = req.params.id;
        const cuotasCheck = await pool.query("SELECT id FROM gastos_cuotas WHERE gasto_id = $1 AND estado != 'Pendiente'", [gastoId]);
        if (cuotasCheck.rows.length > 0) return res.status(400).json({ status: 'error', message: 'No puedes eliminar un gasto con cuotas procesadas.' });

        // Extraer rutas de imÃ¡genes para borrarlas del servidor
        const imgRes = await pool.query('SELECT factura_img, imagenes FROM gastos WHERE id = $1', [gastoId]);
        const { factura_img, imagenes } = imgRes.rows[0] || {};

        await pool.query('DELETE FROM gastos_cuotas WHERE gasto_id = $1', [gastoId]);
        await pool.query('DELETE FROM gastos WHERE id = $1', [gastoId]);

        // Borrar factura principal
        if (factura_img) {
            const fullPath = path.join(__dirname, factura_img);
            if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
        }

        // Borrar soportes
        if (imagenes && imagenes.length > 0) {
            imagenes.forEach(imgPath => {
                const fullPath = path.join(__dirname, imgPath);
                if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
            });
        }

        res.json({ status: 'success', message: 'Gasto eliminado.' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ... PRELIMINAR, ZONAS, PROVEEDORES (Todo igual a lo que tenÃ­as) ...
app.get('/preliminar', verifyToken, async (req, res) => {
    try {
        const condoRes = await pool.query('SELECT id, mes_actual, metodo_division FROM condominios WHERE admin_user_id = $1 LIMIT 1', [req.user.id]);
        const { id: condominio_id, mes_actual, metodo_division } = condoRes.rows[0];
        const gastosRes = await pool.query(`
            SELECT g.concepto, gc.monto_cuota_usd, gc.numero_cuota, g.total_cuotas, p.nombre as proveedor, g.nota, g.monto_usd as monto_total_usd, gc.mes_asignado,
                (g.monto_usd - (gc.monto_cuota_usd * gc.numero_cuota)) as saldo_restante
            FROM gastos_cuotas gc JOIN gastos g ON gc.gasto_id = g.id JOIN proveedores p ON g.proveedor_id = p.id
            WHERE g.condominio_id = $1 AND gc.mes_asignado >= $2 AND (gc.estado = 'Pendiente' OR gc.estado IS NULL) AND g.tipo = 'Comun' ORDER BY gc.mes_asignado ASC
        `, [condominio_id, mes_actual]);
        const total_usd = gastosRes.rows.filter(g => g.mes_asignado === mes_actual).reduce((sum, item) => sum + parseFloat(item.monto_cuota_usd), 0);
        const alicuotasRes = await pool.query(`SELECT DISTINCT alicuota FROM propiedades WHERE condominio_id = $1 ORDER BY alicuota ASC`, [condominio_id]);
        res.json({ status: 'success', mes_actual, mes_texto: formatMonthText(mes_actual), metodo_division, gastos: gastosRes.rows, total_usd: total_usd.toFixed(2), alicuotas_disponibles: alicuotasRes.rows.map(r => parseFloat(r.alicuota)) });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/cerrar-ciclo', verifyToken, async (req, res) => {
    try {
        const condoRes = await pool.query('SELECT id, mes_actual, metodo_division FROM condominios WHERE admin_user_id = $1 LIMIT 1', [req.user.id]);
        const { id: condo_id, mes_actual, metodo_division } = condoRes.rows[0];
        const propRes = await pool.query('SELECT id, alicuota FROM propiedades WHERE condominio_id = $1', [condo_id]);
        
        // Incluimos g.propiedad_id
        const cuotasRes = await pool.query(`SELECT gc.monto_cuota_usd, g.tipo, g.zona_id, g.propiedad_id FROM gastos_cuotas gc JOIN gastos g ON gc.gasto_id = g.id WHERE g.condominio_id = $1 AND gc.mes_asignado = $2 AND gc.estado = 'Pendiente'`, [condo_id, mes_actual]);
        
        for (let p of propRes.rows) {
            let total_deuda = 0;
            const zonasApto = await pool.query('SELECT zona_id FROM propiedades_zonas WHERE propiedad_id = $1', [p.id]);
            const zonaIds = zonasApto.rows.map(z => z.zona_id); 
            
            for (let c of cuotasRes.rows) {
                if (c.tipo === 'Comun') {
                    if (metodo_division === 'Partes Iguales') total_deuda += (parseFloat(c.monto_cuota_usd) / propRes.rows.length); 
                    else total_deuda += (parseFloat(c.monto_cuota_usd) * (parseFloat(p.alicuota) / 100));
                } 
                else if ((c.tipo === 'No Comun' || c.tipo === 'Zona') && zonaIds.includes(c.zona_id)) {
                    const propsZona = await pool.query('SELECT COUNT(*) FROM propiedades_zonas WHERE zona_id = $1', [c.zona_id]);
                    if (metodo_division === 'Partes Iguales') total_deuda += (parseFloat(c.monto_cuota_usd) / parseInt(propsZona.rows[0].count));
                    else {
                        const sumAl = await pool.query(`SELECT SUM(p.alicuota) as total FROM propiedades p JOIN propiedades_zonas pz ON p.id = pz.propiedad_id WHERE pz.zona_id = $1`, [c.zona_id]);
                        total_deuda += (parseFloat(c.monto_cuota_usd) * (parseFloat(p.alicuota) / parseFloat(sumAl.rows[0].total)));
                    }
                }
                // NUEVA REGLA: GASTO INDIVIDUAL
                else if (c.tipo === 'Individual' && c.propiedad_id === p.id) {
                    total_deuda += parseFloat(c.monto_cuota_usd); // Se le suma el 100% de la cuota a su recibo
                }
            }
            if (total_deuda > 0) await pool.query(`INSERT INTO recibos (propiedad_id, mes_cobro, monto_usd, estado) VALUES ($1, $2, $3, 'Aviso de Cobro')`, [p.id, formatMonthText(mes_actual), total_deuda.toFixed(2)]);
        }
        await pool.query(`UPDATE gastos_cuotas SET estado = 'Procesado' FROM gastos WHERE gastos_cuotas.gasto_id = gastos.id AND gastos.condominio_id = $1 AND gastos_cuotas.mes_asignado = $2`, [condo_id, mes_actual]);
        const proximoMes = addMonths(mes_actual, 1);
        await pool.query('UPDATE condominios SET mes_actual = $1 WHERE id = $2', [proximoMes, condo_id]);
        res.json({ status: 'success', message: `Recibos generados. Avanzando a ${formatMonthText(proximoMes)}.` });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/proveedores', verifyToken, async (req, res) => {
    const { identificador, nombre, telefono1, telefono2, direccion, estado_venezuela } = req.body;
    try {
        const r = await pool.query(`INSERT INTO proveedores (identificador, nombre, telefono1, telefono2, direccion, estado_venezuela) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`, [identificador, nombre, telefono1, telefono2, direccion, estado_venezuela]);
        res.json({ status: 'success', message: 'Proveedor registrado', id: r.rows[0].id });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/proveedores', verifyToken, async (req, res) => {
    try {
        const r = await pool.query(`SELECT * FROM proveedores ORDER BY nombre ASC`);
        res.json({ status: 'success', proveedores: r.rows });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/propiedades-admin', verifyToken, async (req, res) => {
    try {
        const c = await pool.query('SELECT id FROM condominios WHERE admin_user_id = $1 LIMIT 1', [req.user.id]);
        const r = await pool.query(`
            SELECT p.id, p.identificador, p.alicuota,
                u1.id as prop_id, u1.nombre as prop_nombre, u1.cedula as prop_cedula, u1.email as prop_email, u1.telefono as prop_telefono,
                u2.id as inq_id, u2.nombre as inq_nombre, u2.cedula as inq_cedula, u2.email as inq_email, u2.telefono as inq_telefono
            FROM propiedades p LEFT JOIN usuarios_propiedades up1 ON p.id = up1.propiedad_id AND up1.rol = 'Propietario' LEFT JOIN users u1 ON up1.user_id = u1.id LEFT JOIN usuarios_propiedades up2 ON p.id = up2.propiedad_id AND up2.rol = 'Inquilino' LEFT JOIN users u2 ON up2.user_id = u2.id
            WHERE p.condominio_id = $1 ORDER BY p.identificador ASC
        `, [c.rows[0].id]);
        res.json({ status: 'success', propiedades: r.rows });
    } catch (err) { res.status(500).json({ error: err.message }); }
});
// Crear Propiedad y enlazar Propietario
app.post('/propiedades-admin', verifyToken, async (req, res) => {
    const { identificador, alicuota, zona_id, nombre, cedula, correo, telefono } = req.body;
    try {
        await pool.query('BEGIN');
        const c = await pool.query('SELECT id FROM condominios WHERE admin_user_id = $1 LIMIT 1', [req.user.id]);
        const condoId = c.rows[0].id;

        // 1. Guardar Usuario
        let userId = null;
        if (cedula && nombre) {
            let userRes = await pool.query('SELECT id FROM users WHERE cedula = $1', [cedula]);
            if (userRes.rows.length === 0) {
                userRes = await pool.query(
                    'INSERT INTO users (cedula, nombre, email, telefono, password) VALUES ($1, $2, $3, $4, $5) RETURNING id',
                    [cedula, nombre, correo || null, telefono || null, '123456']
                );
            } else {
                await pool.query('UPDATE users SET nombre = $1, email = $2, telefono = $3 WHERE cedula = $4', [nombre, correo || null, telefono || null, cedula]);
            }
            userId = userRes.rows[0].id;
        }

        // 2. Guardar Propiedad
        const propRes = await pool.query(
            'INSERT INTO propiedades (condominio_id, identificador, alicuota, zona_id) VALUES ($1, $2, $3, $4) RETURNING id', 
            [condoId, identificador, parseLocaleNumber(alicuota || '0'), zona_id || null]
        );

        // 3. Vincularlos
        if (userId) {
            await pool.query('INSERT INTO usuarios_propiedades (user_id, propiedad_id, rol) VALUES ($1, $2, $3)', [userId, propRes.rows[0].id, 'Propietario']);
        }

        await pool.query('COMMIT');
        res.json({ status: 'success', message: 'Inmueble guardado' });
    } catch (err) { 
        await pool.query('ROLLBACK');
        res.status(500).json({ error: err.message }); 
    }
});

// Editar Propiedad
app.put('/propiedades-admin', verifyToken, async (req, res) => {
    const { id, identificador, alicuota, zona_id, nombre, cedula, correo, telefono } = req.body;
    try {
        await pool.query('BEGIN');
        await pool.query('UPDATE propiedades SET identificador = $1, alicuota = $2, zona_id = $3 WHERE id = $4', [identificador, parseLocaleNumber(alicuota || '0'), zona_id || null, id]);

        if (cedula && nombre) {
            let userRes = await pool.query('SELECT id FROM users WHERE cedula = $1', [cedula]);
            let userId = null;
            if (userRes.rows.length === 0) {
                userRes = await pool.query('INSERT INTO users (cedula, nombre, email, telefono, password) VALUES ($1, $2, $3, $4, $5) RETURNING id', [cedula, nombre, correo, telefono, '123456']);
            } else {
                await pool.query('UPDATE users SET nombre = $1, email = $2, telefono = $3 WHERE cedula = $4', [nombre, correo, telefono, cedula]);
            }
            userId = userRes.rows[0].id;

            const linkRes = await pool.query('SELECT id FROM usuarios_propiedades WHERE propiedad_id = $1 AND rol = $2', [id, 'Propietario']);
            if (linkRes.rows.length > 0) {
                await pool.query('UPDATE usuarios_propiedades SET user_id = $1 WHERE id = $2', [userId, linkRes.rows[0].id]);
            } else {
                await pool.query('INSERT INTO usuarios_propiedades (user_id, propiedad_id, rol) VALUES ($1, $2, $3)', [userId, id, 'Propietario']);
            }
        }
        await pool.query('COMMIT');
        res.json({ status: 'success', message: 'Inmueble actualizado' });
    } catch (err) { 
        await pool.query('ROLLBACK');
        res.status(500).json({ error: err.message }); 
    }
});
app.get('/bancos', verifyToken, async (req, res) => {
    try {
        const r = await pool.query(`SELECT cb.* FROM cuentas_bancarias cb JOIN condominios c ON cb.condominio_id = c.id WHERE c.admin_user_id = $1 ORDER BY cb.nombre_banco ASC`, [req.user.id]);
        res.json({ status: 'success', bancos: r.rows });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 2. Crear banco
app.post('/bancos', verifyToken, async (req, res) => {
    const { numero_cuenta, nombre_banco, apodo, tipo, nombre_titular, cedula_rif, telefono } = req.body;
    try {
        const c = await pool.query('SELECT id FROM condominios WHERE admin_user_id = $1 LIMIT 1', [req.user.id]);
        const condoId = c.rows[0].id;
        
        await pool.query(
            'INSERT INTO cuentas_bancarias (condominio_id, numero_cuenta, nombre_banco, apodo, tipo, nombre_titular, cedula_rif, telefono) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
            [condoId, numero_cuenta || '', nombre_banco || '', apodo, tipo, nombre_titular || '', cedula_rif || '', telefono || '']
        );
        res.json({ status: 'success', message: 'Cuenta agregada' });
    } catch (err) { 
        res.status(500).json({ error: err.message }); 
    }
});

// RUTA PARA SETEAR LA CUENTA PREDETERMINADA
app.put('/bancos/:id/predeterminada', verifyToken, async (req, res) => {
    try {
        const cuentaId = req.params.id;
        const c = await pool.query('SELECT id FROM condominios WHERE admin_user_id = $1 LIMIT 1', [req.user.id]);
        const condoId = c.rows[0].id;

        // Iniciamos la transacciÃ³n para asegurar que no queden 2 cuentas activas por error
        await pool.query('BEGIN');
        
        // 1. Apagamos el marcador en todas las cuentas de este condominio
        await pool.query('UPDATE cuentas_bancarias SET es_predeterminada = false WHERE condominio_id = $1', [condoId]);
        
        // 2. Encendemos el marcador SÃ“LO en la cuenta seleccionada
        await pool.query('UPDATE cuentas_bancarias SET es_predeterminada = true WHERE id = $1 AND condominio_id = $2', [cuentaId, condoId]);
        
        await pool.query('COMMIT'); // Guardamos los cambios de forma segura
        
        res.json({ status: 'success', message: 'Cuenta principal actualizada con Ã©xito.' });
    } catch (err) { 
        await pool.query('ROLLBACK'); // Si algo falla, deshacemos para no romper nada
        res.status(500).json({ error: err.message }); 
    }
});

app.delete('/bancos/:id', verifyToken, async (req, res) => {
    try {
        const cuentaId = req.params.id;
        const c = await pool.query('SELECT id FROM condominios WHERE admin_user_id = $1 LIMIT 1', [req.user.id]);
        const condoId = c.rows[0].id;

        // Verificamos si hay movimientos en CUALQUIER fondo atado a esta cuenta
        const movs = await pool.query(`
            SELECT COUNT(*) 
            FROM movimientos_fondos mf
            JOIN fondos f ON mf.fondo_id = f.id
            WHERE f.cuenta_bancaria_id = $1 AND mf.tipo != 'AJUSTE_INICIAL'
        `, [cuentaId]);
        
        if (parseInt(movs.rows[0].count) > 0) {
            return res.status(400).json({ 
                status: 'error', 
                message: 'No se puede eliminar: Esta cuenta tiene fondos con ingresos o gastos activos.' 
            });
        }

        // Si está limpia, la eliminamos (los fondos se borrarán en cascada automáticamente)
        await pool.query('DELETE FROM cuentas_bancarias WHERE id = $1 AND condominio_id = $2', [cuentaId, condoId]);
        res.json({ status: 'success', message: 'Cuenta eliminada con éxito.' });
    } catch (err) { 
        res.status(500).json({ error: err.message }); 
    }
});

app.get('/zonas', verifyToken, async (req, res) => {
    try {
        const c = await pool.query('SELECT id FROM condominios WHERE admin_user_id = $1 LIMIT 1', [req.user.id]);
        const zRes = await pool.query(`SELECT z.id, z.nombre, z.activa, (SELECT COUNT(*) FROM gastos g WHERE g.zona_id = z.id) > 0 as tiene_gastos FROM zonas z WHERE z.condominio_id = $1 ORDER BY z.activa DESC, z.nombre ASC`, [c.rows[0].id]);
        const zonas = zRes.rows;
        for (let z of zonas) {
            const pRes = await pool.query(`SELECT p.id, p.identificador FROM propiedades p JOIN propiedades_zonas pz ON p.id = pz.propiedad_id WHERE pz.zona_id = $1`, [z.id]);
            z.propiedades = pRes.rows; z.propiedades_ids = pRes.rows.map(p => p.id);
        }
        const aRes = await pool.query('SELECT id, identificador FROM propiedades WHERE condominio_id = $1 ORDER BY identificador ASC', [c.rows[0].id]);
        res.json({ status: 'success', zonas, todas_propiedades: aRes.rows });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/zonas', verifyToken, async (req, res) => {
    const { nombre, propiedades_ids } = req.body;
    try {
        const c = await pool.query('SELECT id FROM condominios WHERE admin_user_id = $1 LIMIT 1', [req.user.id]);
        const z = await pool.query('INSERT INTO zonas (condominio_id, nombre, activa) VALUES ($1, $2, true) RETURNING id', [c.rows[0].id, nombre]);
        if (propiedades_ids) for (let p of propiedades_ids) await pool.query('INSERT INTO propiedades_zonas (zona_id, propiedad_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [z.rows[0].id, p]);
        res.json({ status: 'success', message: 'Zona agregada exitosamente' }); // <-- Agregado message
    } catch (err) { res.status(500).json({ error: err.message }); }
});
app.put('/zonas/:id', verifyToken, async (req, res) => {
    const { nombre, activa } = req.body;
    try {
        await pool.query('UPDATE zonas SET nombre = $1, activa = $2 WHERE id = $3', [nombre, activa, req.params.id]);
        res.json({ status: 'success', message: 'Zona actualizada' }); // <-- Agregado message
    } catch (err) { res.status(500).json({ error: err.message }); }
});
app.delete('/zonas/:id', verifyToken, async (req, res) => {
    try { await pool.query('DELETE FROM zonas WHERE id = $1', [req.params.id]); res.json({ status: 'success' }); } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/recibos-historial', verifyToken, async (req, res) => {
    try {
        const r = await pool.query(`SELECT r.id, r.mes_cobro, r.monto_usd, r.estado, TO_CHAR(r.fecha_emision, 'DD/MM/YYYY') as fecha, p.identificador as apto, u.nombre as propietario FROM recibos r JOIN propiedades p ON r.propiedad_id = p.id LEFT JOIN usuarios_propiedades up ON p.id = up.propiedad_id AND up.rol = 'Propietario' LEFT JOIN users u ON up.user_id = u.id JOIN condominios c ON p.condominio_id = c.id WHERE c.admin_user_id = $1 ORDER BY r.id DESC`, [req.user.id]);
        res.json({ status: 'success', recibos: r.rows });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Obtener fondos del condominio
app.get('/fondos', verifyToken, async (req, res) => {
    try {
        const condoRes = await pool.query('SELECT id FROM condominios WHERE admin_user_id = $1 LIMIT 1', [req.user.id]);
        const result = await pool.query(`
            SELECT f.*, cb.nombre_banco, cb.apodo 
            FROM fondos f 
            JOIN cuentas_bancarias cb ON f.cuenta_bancaria_id = cb.id 
            WHERE f.condominio_id = $1 
            ORDER BY cb.nombre_banco ASC, f.es_operativo DESC, f.nombre ASC
        `, [condoRes.rows[0].id]);
        res.json({ status: 'success', fondos: result.rows });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Crear fondo con saldo inicial
app.post('/fondos', verifyToken, async (req, res) => {
    const { cuenta_bancaria_id, nombre, moneda, porcentaje, saldo_inicial, es_operativo } = req.body;
    
    // 💡 SOLUCIÓN: Si es el Fondo Principal (es_operativo = true), forzamos a que guarde un 0.
    // De lo contrario, usamos tu excelente función parseLocaleNumber para limpiar el porcentaje escrito.
    const porcNum = es_operativo ? 0 : parseLocaleNumber(porcentaje); 
    
    // El saldo inicial sigue usando tu función normal
    const saldoNum = parseLocaleNumber(saldo_inicial);

    try {
        const condoRes = await pool.query('SELECT id FROM condominios WHERE admin_user_id = $1 LIMIT 1', [req.user.id]);
        const fondo = await pool.query(
            'INSERT INTO fondos (condominio_id, cuenta_bancaria_id, nombre, moneda, porcentaje_asignacion, saldo_actual, es_operativo) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
            [condoRes.rows[0].id, cuenta_bancaria_id, nombre, moneda, porcNum, saldoNum, es_operativo || false]
        );
        
        // Solo registramos movimiento si el saldo inicial no es cero
        if (saldoNum !== 0) {
            await pool.query('INSERT INTO movimientos_fondos (fondo_id, tipo, monto, nota) VALUES ($1, $2, $3, $4)',
            [fondo.rows[0].id, 'AJUSTE_INICIAL', saldoNum, 'Saldo de apertura del fondo']);
        }
        res.json({ status: 'success', message: 'Fondo creado y anclado a la cuenta.' });
    } catch (err) { 
        console.error("Error al crear fondo:", err.message);
        res.status(500).json({ error: err.message }); 
    }
});
// ELIMINAR FONDO VIRTUAL (Solo si no tiene movimientos)
app.delete('/fondos/:id', verifyToken, async (req, res) => {
    try {
        const fondoId = req.params.id;
        
        // Verificamos que el fondo no tenga movimientos reales (ignoramos el AJUSTE_INICIAL de cuando se creó)
        const movs = await pool.query("SELECT COUNT(*) FROM movimientos_fondos WHERE fondo_id = $1 AND tipo != 'AJUSTE_INICIAL'", [fondoId]);
        
        if (parseInt(movs.rows[0].count) > 0) {
            return res.status(400).json({ status: 'error', message: 'No se puede eliminar: El fondo ya tiene ingresos o gastos registrados.' });
        }
        
        // Si está limpio, lo borramos de forma segura
        await pool.query('DELETE FROM fondos WHERE id = $1', [fondoId]);
        res.json({ status: 'success', message: 'Fondo eliminado correctamente.' });
    } catch (err) { 
        res.status(500).json({ error: err.message }); 
    }
});
// ==========================================
// MÓDULO DE PAGOS Y FONDOS VIRTUALES
// ==========================================
app.post('/pagos-admin', verifyToken, async (req, res) => {
    // 💡 Ajustado: Ahora escucha en /pagos-admin y recibe monto_origen
    const { recibo_id, cuenta_id, monto_origen, tasa_cambio, referencia, fecha_pago, moneda, metodo } = req.body;
    
    // Limpiamos los números
    const monto_pagado_num = parseLocaleNumber(monto_origen);
    const tasa_num = parseLocaleNumber(tasa_cambio) || 1;
    
    const moneda_final = moneda || 'BS';
    const monto_usd_num = (moneda_final === 'USD' || moneda_final === 'EUR') 
        ? monto_pagado_num 
        : parseFloat((monto_pagado_num / tasa_num).toFixed(2));

    try {
        await pool.query('BEGIN');

        // 1. Registrar el pago
        const resultPago = await pool.query(`
            INSERT INTO pagos (recibo_id, cuenta_bancaria_id, monto_origen, tasa_cambio, monto_usd, moneda, referencia, fecha_pago, metodo, estado) 
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'Validado') RETURNING id
        `, [recibo_id, cuenta_id, monto_pagado_num, tasa_num, monto_usd_num, moneda_final, referencia, fecha_pago || new Date(), metodo || 'Transferencia']);
        
        const pagoId = resultPago.rows[0].id;

        // 2. MAGIA DE LOS FONDOS
        const fondos = await pool.query('SELECT * FROM fondos WHERE cuenta_bancaria_id = $1', [cuenta_id]);

        if (fondos.rows.length > 0) {
            let acumuladoOtros = 0;
            let fondoOperativoId = null;

            for (let f of fondos.rows) {
                if (f.es_operativo) {
                    fondoOperativoId = f.id;
                    continue;
                }
                const tajada = (monto_pagado_num * (parseFloat(f.porcentaje_asignacion) / 100)).toFixed(2);
                acumuladoOtros += parseFloat(tajada);
                await pool.query('UPDATE fondos SET saldo_actual = saldo_actual + $1 WHERE id = $2', [tajada, f.id]);
                await pool.query('INSERT INTO movimientos_fondos (fondo_id, tipo, monto, referencia_id, nota) VALUES ($1, $2, $3, $4, $5)',
                [f.id, 'INGRESO_PAGO', tajada, pagoId, `Aporte automático (Recibo #${recibo_id})`]);
            }

            if (fondoOperativoId) {
                const resto = (monto_pagado_num - acumuladoOtros).toFixed(2);
                await pool.query('UPDATE fondos SET saldo_actual = saldo_actual + $1 WHERE id = $2', [resto, fondoOperativoId]);
                await pool.query('INSERT INTO movimientos_fondos (fondo_id, tipo, monto, referencia_id, nota) VALUES ($1, $2, $3, $4, $5)',
                [fondoOperativoId, 'INGRESO_PAGO', resto, pagoId, `Ingreso operativo (Recibo #${recibo_id})`]);
            }
        }

        // 3. Evaluar si es Pagado Completo o Abonado Parcial
        const recRes = await pool.query('SELECT monto_usd FROM recibos WHERE id = $1', [recibo_id]);
        const montoRecibo = parseFloat(recRes.rows[0].monto_usd);
        
        // Sumar todos los pagos validados de este recibo
        const sumRes = await pool.query('SELECT SUM(monto_usd) as total_pagado FROM pagos WHERE recibo_id = $1 AND estado = $2', [recibo_id, 'Validado']);
        const totalPagado = parseFloat(sumRes.rows[0].total_pagado || 0);

        // Si lo que ha pagado alcanza o supera el costo del recibo (con un pequeño margen de error de céntimos)
        const nuevoEstado = (totalPagado >= (montoRecibo - 0.05)) ? 'Pagado' : 'Abonado Parcial';
        
        await pool.query('UPDATE recibos SET estado = $1 WHERE id = $2', [nuevoEstado, recibo_id]);

        await pool.query('COMMIT');
        res.json({ status: 'success', message: 'Pago registrado y fondos distribuidos correctamente.' });
    } catch (err) { 
        await pool.query('ROLLBACK');
        console.error(err);
        res.status(500).json({ error: err.message }); 
    }
});

// ==========================================
// MÓDULO DE DASHBOARDS Y REPORTES
// ==========================================

// 1. Obtener las propiedades de un usuario (Vista Propietario)
app.get('/mis-propiedades', verifyToken, async (req, res) => {
    try {
        const query = `
            SELECT p.*, c.nombre as condominio_nombre 
            FROM propiedades p
            JOIN usuarios_propiedades up ON p.id = up.propiedad_id
            JOIN condominios c ON p.condominio_id = c.id
            WHERE up.user_id = $1
        `;
        const result = await pool.query(query, [req.user.id]);
        res.json({ status: 'success', propiedades: result.rows });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 2. Obtener resumen financiero de un usuario (Vista Propietario)
app.get('/mis-finanzas', verifyToken, async (req, res) => {
    try {
        // Sumamos toda la deuda de los recibos no pagados de las propiedades de este usuario
        const queryDeuda = `
            SELECT SUM(r.monto_usd) as total_deuda
            FROM recibos r
            JOIN propiedades p ON r.propiedad_id = p.id
            JOIN usuarios_propiedades up ON p.id = up.propiedad_id
            WHERE up.user_id = $1 AND r.estado NOT IN ('Pagado', 'Solvente')
        `;
        const resultDeuda = await pool.query(queryDeuda, [req.user.id]);
        
        res.json({ 
            status: 'success', 
            finanzas: {
                total_deuda: parseFloat(resultDeuda.rows[0].total_deuda || 0).toFixed(2)
            } 
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 3. Cuentas por cobrar globales (Vista Administrador)
app.get('/cuentas-por-cobrar', verifyToken, async (req, res) => {
    try {
        // Verificamos que sea el admin del condominio
        const c = await pool.query('SELECT id FROM condominios WHERE admin_user_id = $1 LIMIT 1', [req.user.id]);
        if (c.rows.length === 0) return res.status(403).json({ error: 'No autorizado' });
        const condoId = c.rows[0].id;

        // Traemos todos los recibos que tengan deuda
        const query = `
            SELECT r.*, p.identificador as apto
            FROM recibos r
            JOIN propiedades p ON r.propiedad_id = p.id
            WHERE p.condominio_id = $1 AND r.estado NOT IN ('Pagado', 'Solvente')
            ORDER BY r.fecha_emision DESC
        `;
        const result = await pool.query(query, [condoId]);
        res.json({ status: 'success', recibos: result.rows });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
app.listen(PORT, () => console.log(`Servidor corriendo en el puerto ${PORT}`));

