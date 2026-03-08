const fs = require('fs');
const path = require('path');
const multer = require('multer');
const sharp = require('sharp');

const registerGastosRoutes = (app, { pool, verifyToken, parseLocaleNumber, addMonths, formatMonthText }) => {
    const uploadsDir = path.join(__dirname, '..', 'uploads', 'gastos');
    if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir, { recursive: true });
    }

    const upload = multer({
        storage: multer.memoryStorage(),
        limits: { fileSize: 10 * 1024 * 1024 },
    });

    app.post('/gastos', verifyToken, upload.fields([{ name: 'factura_img', maxCount: 1 }, { name: 'soportes', maxCount: 4 }]), async (req, res) => {
        if (!req.user.cedula.startsWith('J')) return res.status(403).json({ status: 'error', message: 'Acceso denegado' });

        const { proveedor_id, concepto, monto_bs, tasa_cambio, total_cuotas, nota, tipo, zona_id, propiedad_id, fecha_gasto } = req.body;

        try {
            let facturaGuardada = null;
            const soportesGuardados = [];

            if (req.files) {
                if (req.files.factura_img && req.files.factura_img.length > 0) {
                    const file = req.files.factura_img[0];
                    const uniqueName = `factura_${Date.now()}_${Math.round(Math.random() * 1e9)}.webp`;
                    await sharp(file.buffer).resize({ width: 1200, withoutEnlargement: true }).webp({ quality: 80 }).toFile(path.join(uploadsDir, uniqueName));
                    facturaGuardada = `/uploads/gastos/${uniqueName}`;
                }
                if (req.files.soportes && req.files.soportes.length > 0) {
                    for (const file of req.files.soportes) {
                        const uniqueName = `soporte_${Date.now()}_${Math.round(Math.random() * 1e9)}.webp`;
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
            const monto_cuota_usd = (monto_usd / parseInt(total_cuotas, 10)).toFixed(2);

            const mes_factura = fecha_gasto ? fecha_gasto.substring(0, 7) : mes_actual;
            const mes_inicio_cobro = mes_factura > mes_actual ? mes_factura : mes_actual;

            const dbTipo = tipo || 'Comun';
            const zId = dbTipo === 'Zona' || dbTipo === 'No Comun' ? (zona_id || null) : null;
            const pId = dbTipo === 'Individual' ? (propiedad_id || null) : null;

            const result = await pool.query(
                `
            INSERT INTO gastos (condominio_id, proveedor_id, concepto, monto_bs, tasa_cambio, monto_usd, total_cuotas, nota, tipo, zona_id, propiedad_id, fecha_gasto, factura_img, imagenes)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING id
        `,
                [condominio_id, proveedor_id, concepto, m_bs, t_c, monto_usd, total_cuotas, nota, dbTipo, zId, pId, fecha_gasto || null, facturaGuardada, soportesGuardados]
            );

            for (let i = 1; i <= total_cuotas; i += 1) {
                const mes_cuota = addMonths(mes_inicio_cobro, i - 1);
                await pool.query('INSERT INTO gastos_cuotas (gasto_id, numero_cuota, monto_cuota_usd, mes_asignado) VALUES ($1, $2, $3, $4)', [result.rows[0].id, i, monto_cuota_usd, mes_cuota]);
            }
            res.json({ status: 'success', message: 'Gasto registrado con exito.' });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    app.get('/gastos', verifyToken, async (req, res) => {
        if (!req.user.cedula.startsWith('J')) return res.status(403).json({ status: 'error' });
        try {
            const result = await pool.query(
                `
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
        `,
                [req.user.id]
            );
            res.json({ status: 'success', gastos: result.rows });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    app.delete('/gastos/:id', verifyToken, async (req, res) => {
        try {
            const gastoId = req.params.id;
            const cuotasCheck = await pool.query("SELECT id FROM gastos_cuotas WHERE gasto_id = $1 AND estado != 'Pendiente'", [gastoId]);
            if (cuotasCheck.rows.length > 0) return res.status(400).json({ status: 'error', message: 'No puedes eliminar un gasto con cuotas procesadas.' });

            const imgRes = await pool.query('SELECT factura_img, imagenes FROM gastos WHERE id = $1', [gastoId]);
            const { factura_img, imagenes } = imgRes.rows[0] || {};

            await pool.query('DELETE FROM gastos_cuotas WHERE gasto_id = $1', [gastoId]);
            await pool.query('DELETE FROM gastos WHERE id = $1', [gastoId]);

            if (factura_img) {
                const fullPath = path.join(__dirname, '..', factura_img);
                if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
            }

            if (imagenes && imagenes.length > 0) {
                imagenes.forEach((imgPath) => {
                    const fullPath = path.join(__dirname, '..', imgPath);
                    if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
                });
            }

            res.json({ status: 'success', message: 'Gasto eliminado.' });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    app.get('/preliminar', verifyToken, async (req, res) => {
        try {
            const condoRes = await pool.query('SELECT id, mes_actual, metodo_division FROM condominios WHERE admin_user_id = $1 LIMIT 1', [req.user.id]);
            const { id: condominio_id, mes_actual, metodo_division } = condoRes.rows[0];
            const gastosRes = await pool.query(
                `
            SELECT g.concepto, gc.monto_cuota_usd, gc.numero_cuota, g.total_cuotas, p.nombre as proveedor, g.nota, g.monto_usd as monto_total_usd, gc.mes_asignado,
                (g.monto_usd - (gc.monto_cuota_usd * gc.numero_cuota)) as saldo_restante
            FROM gastos_cuotas gc JOIN gastos g ON gc.gasto_id = g.id JOIN proveedores p ON g.proveedor_id = p.id
            WHERE g.condominio_id = $1 AND gc.mes_asignado >= $2 AND (gc.estado = 'Pendiente' OR gc.estado IS NULL) AND g.tipo = 'Comun' ORDER BY gc.mes_asignado ASC
        `,
                [condominio_id, mes_actual]
            );
            const total_usd = gastosRes.rows.filter((g) => g.mes_asignado === mes_actual).reduce((sum, item) => sum + parseFloat(item.monto_cuota_usd), 0);
            const alicuotasRes = await pool.query('SELECT DISTINCT alicuota FROM propiedades WHERE condominio_id = $1 ORDER BY alicuota ASC', [condominio_id]);
            res.json({
                status: 'success',
                mes_actual,
                mes_texto: formatMonthText(mes_actual),
                metodo_division,
                gastos: gastosRes.rows,
                total_usd: total_usd.toFixed(2),
                alicuotas_disponibles: alicuotasRes.rows.map((r) => parseFloat(r.alicuota)),
            });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    app.post('/cerrar-ciclo', verifyToken, async (req, res) => {
        try {
            const condoRes = await pool.query('SELECT id, mes_actual, metodo_division FROM condominios WHERE admin_user_id = $1 LIMIT 1', [req.user.id]);
            const { id: condo_id, mes_actual, metodo_division } = condoRes.rows[0];
            const propRes = await pool.query('SELECT id, alicuota FROM propiedades WHERE condominio_id = $1', [condo_id]);

            const cuotasRes = await pool.query(
                `SELECT gc.monto_cuota_usd, g.tipo, g.zona_id, g.propiedad_id FROM gastos_cuotas gc JOIN gastos g ON gc.gasto_id = g.id WHERE g.condominio_id = $1 AND gc.mes_asignado = $2 AND gc.estado = 'Pendiente'`,
                [condo_id, mes_actual]
            );

            for (const p of propRes.rows) {
                let total_deuda = 0;
                const zonasApto = await pool.query('SELECT zona_id FROM propiedades_zonas WHERE propiedad_id = $1', [p.id]);
                const zonaIds = zonasApto.rows.map((z) => z.zona_id);

                for (const c of cuotasRes.rows) {
                    if (c.tipo === 'Comun') {
                        if (metodo_division === 'Partes Iguales') total_deuda += parseFloat(c.monto_cuota_usd) / propRes.rows.length;
                        else total_deuda += parseFloat(c.monto_cuota_usd) * (parseFloat(p.alicuota) / 100);
                    } else if ((c.tipo === 'No Comun' || c.tipo === 'Zona') && zonaIds.includes(c.zona_id)) {
                        const propsZona = await pool.query('SELECT COUNT(*) FROM propiedades_zonas WHERE zona_id = $1', [c.zona_id]);
                        if (metodo_division === 'Partes Iguales') total_deuda += parseFloat(c.monto_cuota_usd) / parseInt(propsZona.rows[0].count, 10);
                        else {
                            const sumAl = await pool.query(
                                'SELECT SUM(p.alicuota) as total FROM propiedades p JOIN propiedades_zonas pz ON p.id = pz.propiedad_id WHERE pz.zona_id = $1',
                                [c.zona_id]
                            );
                            total_deuda += parseFloat(c.monto_cuota_usd) * (parseFloat(p.alicuota) / parseFloat(sumAl.rows[0].total));
                        }
                    } else if (c.tipo === 'Individual' && c.propiedad_id === p.id) {
                        total_deuda += parseFloat(c.monto_cuota_usd);
                    }
                }

                if (total_deuda > 0) {
                    await pool.query("INSERT INTO recibos (propiedad_id, mes_cobro, monto_usd, estado) VALUES ($1, $2, $3, 'Aviso de Cobro')", [p.id, formatMonthText(mes_actual), total_deuda.toFixed(2)]);
                }
            }
            await pool.query(
                "UPDATE gastos_cuotas SET estado = 'Procesado' FROM gastos WHERE gastos_cuotas.gasto_id = gastos.id AND gastos.condominio_id = $1 AND gastos_cuotas.mes_asignado = $2",
                [condo_id, mes_actual]
            );
            const proximoMes = addMonths(mes_actual, 1);
            await pool.query('UPDATE condominios SET mes_actual = $1 WHERE id = $2', [proximoMes, condo_id]);
            res.json({ status: 'success', message: `Recibos generados. Avanzando a ${formatMonthText(proximoMes)}.` });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });
};

module.exports = { registerGastosRoutes };

