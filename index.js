require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// NUEVAS LIBRERÍAS PARA IMÁGENES
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const sharp = require('sharp');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// ==========================================
// CONFIGURACIÓN DE ALMACENAMIENTO DE IMÁGENES
// ==========================================
const uploadsDir = path.join(__dirname, 'uploads', 'gastos');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true }); // Crea la carpeta si no existe
}
// Hacer pública la carpeta de uploads para que el frontend pueda verlas
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Configurar Multer (Guarda temporalmente en memoria para que Sharp lo procese)
const storage = multer.memoryStorage();
const upload = multer({ 
    storage: storage,
    limits: { files: 4, fileSize: 10 * 1024 * 1024 } // Max 4 archivos, 10MB c/u
});

// Conexión a PostgreSQL
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
    } catch (err) { return res.status(401).json({ status: 'error', message: 'Token inválido.' }); }
};

app.get('/', (req, res) => res.json({ status: 'success', message: 'Auth Service is running!' }));

// ==========================================
// RUTAS DE AUTENTICACIÓN (Resumidas)
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
            return res.status(401).json({ status: 'error', message: 'Credenciales inválidas' });
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
const formatMonthText = (y_m) => {
    const [y, m] = y_m.split('-');
    return `${["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"][parseInt(m) - 1]} ${y}`;
};

// ==========================================
// MÓDULO DE GASTOS (AHORA CON IMÁGENES)
// ==========================================
// Usamos upload.array('imagenes', 4) para atrapar los archivos
app.post('/gastos', verifyToken, upload.array('imagenes', 4), async (req, res) => {
    if (!req.user.cedula.startsWith('J')) return res.status(403).json({ status: 'error', message: 'Acceso denegado' });
    
    // Al usar FormData, los campos de texto vienen en req.body
    const { proveedor_id, concepto, monto_bs, tasa_cambio, total_cuotas, nota, tipo, zona_id, fecha_gasto } = req.body;
    const parseNum = (v) => parseFloat(v.toString().replace(/\./g, '').replace(',', '.'));

    try {
        // PROCESAMIENTO DE IMÁGENES CON SHARP (A WebP)
        let imagenesGuardadas = [];
        if (req.files && req.files.length > 0) {
            for (const file of req.files) {
                // Generamos un nombre único: gasto_170000000_123.webp
                const uniqueName = `gasto_${Date.now()}_${Math.round(Math.random() * 1E9)}.webp`;
                const outputPath = path.join(uploadsDir, uniqueName);

                await sharp(file.buffer)
                    .resize({ width: 1200, withoutEnlargement: true }) // No más ancho de 1200px
                    .webp({ quality: 80 }) // Compresión WebP al 80%
                    .toFile(outputPath);

                // Guardamos la ruta relativa para la DB
                imagenesGuardadas.push(`/uploads/gastos/${uniqueName}`);
            }
        }

        const m_bs = parseNum(monto_bs);
        const t_c = parseNum(tasa_cambio);
        
        const condoRes = await pool.query('SELECT id, mes_actual FROM condominios WHERE admin_user_id = $1 LIMIT 1', [req.user.id]);
        const condominio_id = condoRes.rows[0].id;
        const mes_actual = condoRes.rows[0].mes_actual; 
        
        const monto_usd = (m_bs / t_c).toFixed(2);
        const monto_cuota_usd = (monto_usd / parseInt(total_cuotas)).toFixed(2);

        const mes_factura = fecha_gasto ? fecha_gasto.substring(0, 7) : mes_actual;
        const mes_inicio_cobro = (mes_factura > mes_actual) ? mes_factura : mes_actual;

        // INSERTAMOS EL GASTO INCLUYENDO EL ARREGLO DE IMÁGENES
        const result = await pool.query(`
            INSERT INTO gastos (condominio_id, proveedor_id, concepto, monto_bs, tasa_cambio, monto_usd, total_cuotas, nota, tipo, zona_id, fecha_gasto, imagenes)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id
        `, [condominio_id, proveedor_id, concepto, m_bs, t_c, monto_usd, total_cuotas, nota, tipo || 'Comun', zona_id || null, fecha_gasto || null, imagenesGuardadas]);

        for (let i = 1; i <= total_cuotas; i++) {
            const mes_cuota = addMonths(mes_inicio_cobro, i - 1);
            await pool.query(`INSERT INTO gastos_cuotas (gasto_id, numero_cuota, monto_cuota_usd, mes_asignado) VALUES ($1, $2, $3, $4)`, 
            [result.rows[0].id, i, monto_cuota_usd, mes_cuota]);
        }
        res.json({ status: 'success', message: 'Gasto e imágenes registrados con éxito.' });
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
                   g.tipo, z.nombre as zona_nombre, g.imagenes,
                   GREATEST(0, g.monto_usd - (gc.monto_cuota_usd * gc.numero_cuota)) as saldo_pendiente
            FROM gastos g
            JOIN gastos_cuotas gc ON g.id = gc.gasto_id
            JOIN proveedores p ON g.proveedor_id = p.id
            JOIN condominios c ON g.condominio_id = c.id
            LEFT JOIN zonas z ON g.zona_id = z.id
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

        // Extraer rutas de imagenes para borrarlas del servidor
        const imgRes = await pool.query('SELECT imagenes FROM gastos WHERE id = $1', [gastoId]);
        const imagenes = imgRes.rows[0]?.imagenes || [];

        await pool.query('DELETE FROM gastos_cuotas WHERE gasto_id = $1', [gastoId]);
        await pool.query('DELETE FROM gastos WHERE id = $1', [gastoId]);

        // Borrar fisicamente las imagenes
        imagenes.forEach(imgPath => {
            const fullPath = path.join(__dirname, imgPath);
            if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
        });

        res.json({ status: 'success', message: 'Gasto eliminado.' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ... PRELIMINAR, ZONAS, PROVEEDORES (Todo igual a lo que tenías) ...
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
        const propRes = await pool.query('SELECT id, alicuota, zona_id FROM propiedades WHERE condominio_id = $1', [condo_id]);
        const cuotasRes = await pool.query(`SELECT gc.monto_cuota_usd, g.tipo, g.zona_id FROM gastos_cuotas gc JOIN gastos g ON gc.gasto_id = g.id WHERE g.condominio_id = $1 AND gc.mes_asignado = $2 AND gc.estado = 'Pendiente'`, [condo_id, mes_actual]);
        for (let p of propRes.rows) {
            let total_deuda = 0;
            const zonasApto = await pool.query('SELECT zona_id FROM propiedades_zonas WHERE propiedad_id = $1', [p.id]);
            const zonaIds = zonasApto.rows.map(z => z.zona_id); 
            for (let c of cuotasRes.rows) {
                if (c.tipo === 'Comun') {
                    if (metodo_division === 'Partes Iguales') total_deuda += (parseFloat(c.monto_cuota_usd) / propRes.rows.length); else total_deuda += (parseFloat(c.monto_cuota_usd) * (parseFloat(p.alicuota) / 100));
                } else if (c.tipo === 'No Comun' && zonaIds.includes(c.zona_id)) {
                    const propsZona = await pool.query('SELECT COUNT(*) FROM propiedades_zonas WHERE zona_id = $1', [c.zona_id]);
                    if (metodo_division === 'Partes Iguales') total_deuda += (parseFloat(c.monto_cuota_usd) / parseInt(propsZona.rows[0].count));
                    else {
                        const sumAl = await pool.query(`SELECT SUM(p.alicuota) as total FROM propiedades p JOIN propiedades_zonas pz ON p.id = pz.propiedad_id WHERE pz.zona_id = $1`, [c.zona_id]);
                        total_deuda += (parseFloat(c.monto_cuota_usd) * (parseFloat(p.alicuota) / parseFloat(sumAl.rows[0].total)));
                    }
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

app.get('/bancos', verifyToken, async (req, res) => {
    try {
        const r = await pool.query(`SELECT cb.* FROM cuentas_bancarias cb JOIN condominios c ON cb.condominio_id = c.id WHERE c.admin_user_id = $1 ORDER BY cb.nombre_banco ASC`, [req.user.id]);
        res.json({ status: 'success', bancos: r.rows });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/bancos', verifyToken, async (req, res) => {
    const { numero_cuenta, nombre_banco, apodo, tipo } = req.body;
    try {
        const c = await pool.query('SELECT id FROM condominios WHERE admin_user_id = $1 LIMIT 1', [req.user.id]);
        await pool.query('INSERT INTO cuentas_bancarias (condominio_id, numero_cuenta, nombre_banco, apodo, tipo) VALUES ($1, $2, $3, $4, $5)', [c.rows[0].id, numero_cuenta, nombre_banco, apodo, tipo]);
        res.json({ status: 'success', message: 'Cuenta registrada.' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/bancos/:id', verifyToken, async (req, res) => {
    try { await pool.query('DELETE FROM cuentas_bancarias WHERE id = $1', [req.params.id]); res.json({ status: 'success' }); } catch (err) { res.status(500).json({ error: err.message }); }
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
        res.json({ status: 'success' });
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

app.listen(PORT, () => console.log(`Servidor corriendo en el puerto ${PORT}`));