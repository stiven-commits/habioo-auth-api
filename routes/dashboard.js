const registerDashboardRoutes = (app, { pool, verifyToken }) => {
    app.get('/mis-propiedades', verifyToken, async (req, res) => {
        try {
            const query = `
            SELECT p.*, c.nombre as condominio_nombre 
            FROM propiedades p
            JOIN usuarios_propiedades up ON p.id = up.propiedad_id
            JOIN condominios c ON p.condominio_id = c.id
            WHERE up.user_id = $1 AND COALESCE(up.acceso_portal, true) = true
        `;
            const result = await pool.query(query, [req.user.id]);
            res.json({ status: 'success', propiedades: result.rows });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    app.get('/mis-finanzas', verifyToken, async (req, res) => {
        try {
            const queryDeuda = `
            SELECT SUM(r.monto_usd) as total_deuda
            FROM recibos r
            JOIN propiedades p ON r.propiedad_id = p.id
            JOIN usuarios_propiedades up ON p.id = up.propiedad_id
            WHERE up.user_id = $1 AND COALESCE(up.acceso_portal, true) = true AND r.estado NOT IN ('Pagado', 'Solvente')
        `;
            const resultDeuda = await pool.query(queryDeuda, [req.user.id]);

            res.json({
                status: 'success',
                finanzas: {
                    total_deuda: parseFloat(resultDeuda.rows[0].total_deuda || 0).toFixed(2),
                },
            });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    app.get('/cuentas-por-cobrar', verifyToken, async (req, res) => {
        try {
            const c = await pool.query('SELECT id FROM condominios WHERE admin_user_id = $1 LIMIT 1', [req.user.id]);
            if (c.rows.length === 0) return res.status(403).json({ error: 'No autorizado' });
            const condoId = c.rows[0].id;

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
    // 🧪 RUTA DE DESARROLLO: INYECTAR DATOS DE PRUEBA COMPLETOS
    app.post('/dashboard-admin/seed-prueba', verifyToken, async (req, res) => {
        try {
            await pool.query('BEGIN');
            
            const condoRes = await pool.query('SELECT id, mes_actual FROM condominios WHERE admin_user_id = $1 LIMIT 1', [req.user.id]);
            const condoId = condoRes.rows[0].id;
            const mesActual = condoRes.rows[0].mes_actual;

            // 1. Limpieza segura: Borramos pruebas anteriores (en orden para no romper Foreign Keys)
            await pool.query("DELETE FROM gastos WHERE concepto LIKE '[TEST]%' AND condominio_id = $1", [condoId]);
            await pool.query("DELETE FROM proveedores WHERE nombre LIKE '[TEST]%' AND condominio_id = $1", [condoId]);
            await pool.query("DELETE FROM propiedades WHERE identificador LIKE 'TEST-%' AND condominio_id = $1", [condoId]);
            await pool.query("DELETE FROM zonas WHERE nombre LIKE 'TEST-%' AND condominio_id = $1", [condoId]);
            await pool.query("DELETE FROM fondos WHERE nombre LIKE '[TEST]%' AND condominio_id = $1", [condoId]);
            await pool.query("DELETE FROM cuentas_bancarias WHERE apodo LIKE '[TEST]%' AND condominio_id = $1", [condoId]);

            // 2. Crear 3 Cuentas Bancarias
            const cuenta1 = await pool.query(
                "INSERT INTO cuentas_bancarias (condominio_id, numero_cuenta, nombre_banco, apodo, tipo, nombre_titular, cedula_rif, telefono, es_predeterminada) VALUES ($1, '01020000111122223333', 'Banco de Venezuela', '[TEST] Cuenta Principal (2 Fondos)', 'Corriente', 'Junta de Condominio', 'J-12345678-9', '0414-1234567', true) RETURNING id", 
                [condoId]
            );
            const cuenta2 = await pool.query(
                "INSERT INTO cuentas_bancarias (condominio_id, numero_cuenta, nombre_banco, apodo, tipo, nombre_titular, cedula_rif, telefono, es_predeterminada) VALUES ($1, '01340000111122223333', 'Banesco', '[TEST] Cuenta Reserva (1 Fondo)', 'Ahorros', 'Junta de Condominio', 'J-12345678-9', '0414-1234567', false) RETURNING id", 
                [condoId]
            );
            const cuenta3 = await pool.query(
                "INSERT INTO cuentas_bancarias (condominio_id, numero_cuenta, nombre_banco, apodo, tipo, nombre_titular, cedula_rif, telefono, es_predeterminada) VALUES ($1, 'Zelle', 'Bank of America', '[TEST] Cuenta Zelle (0 Fondos)', 'Extranjera', 'Administrador', 'V-12345678', '0412-1234567', false) RETURNING id", 
                [condoId]
            );
            
            const idC1 = cuenta1.rows[0].id;
            const idC2 = cuenta2.rows[0].id;

            // 3. Crear Fondos y asociarlos a las cuentas
            // Cuenta 1 (2 Fondos: 1 Operativo, 1 Reserva)
            await pool.query(
                "INSERT INTO fondos (condominio_id, cuenta_bancaria_id, nombre, moneda, porcentaje_asignacion, saldo_actual, es_operativo) VALUES ($1, $2, '[TEST] Fondo Operativo Principal', 'BS', 0, 5000, true)", 
                [condoId, idC1]
            );
            await pool.query(
                "INSERT INTO fondos (condominio_id, cuenta_bancaria_id, nombre, moneda, porcentaje_asignacion, saldo_actual, es_operativo) VALUES ($1, $2, '[TEST] Fondo Prestaciones Empleados', 'BS', 10, 1500, false)", 
                [condoId, idC1]
            );

            // Cuenta 2 (1 Fondo de Reserva USD)
            await pool.query(
                "INSERT INTO fondos (condominio_id, cuenta_bancaria_id, nombre, moneda, porcentaje_asignacion, saldo_actual, es_operativo) VALUES ($1, $2, '[TEST] Fondo Reserva Ascensores', 'USD', 5, 300, false)", 
                [condoId, idC2]
            );

            // 4. Crear 2 Zonas
            const zA = await pool.query("INSERT INTO zonas (condominio_id, nombre) VALUES ($1, 'TEST-Torre A') RETURNING id", [condoId]);
            const zB = await pool.query("INSERT INTO zonas (condominio_id, nombre) VALUES ($1, 'TEST-Torre B') RETURNING id", [condoId]);
            const idZa = zA.rows[0].id;
            const idZb = zB.rows[0].id;

            // 5. Crear 8 Propiedades
            const props = [];
            const propConfigs = [
                { iden: 'TEST-1A', zona: idZa, saldo: 0 },
                { iden: 'TEST-1B', zona: idZa, saldo: 50 },
                { iden: 'TEST-2A', zona: idZa, saldo: -30 },
                { iden: 'TEST-2B', zona: idZa, saldo: 0 },
                { iden: 'TEST-3A', zona: idZb, saldo: 120 },
                { iden: 'TEST-3B', zona: idZb, saldo: 0 },
                { iden: 'TEST-4A', zona: idZb, saldo: -10 },
                { iden: 'TEST-4B', zona: idZb, saldo: 0 }
            ];

            for (const pc of propConfigs) {
                const p = await pool.query(
                    "INSERT INTO propiedades (condominio_id, identificador, alicuota, zona_id, saldo_actual) VALUES ($1, $2, 12.50, $3, $4) RETURNING id",
                    [condoId, pc.iden, pc.zona, pc.saldo]
                );
                const nuevaPropId = p.rows[0].id;
                props.push(nuevaPropId);
                
                await pool.query("INSERT INTO propiedades_zonas (propiedad_id, zona_id) VALUES ($1, $2)", [nuevaPropId, pc.zona]);
                
                if (pc.saldo !== 0) {
                    await pool.query(
                        "INSERT INTO historial_saldos_inmuebles (propiedad_id, tipo, monto, nota, fecha) VALUES ($1, 'SALDO_INICIAL', $2, $3, CURRENT_DATE)",
                        [nuevaPropId, Math.abs(pc.saldo), pc.saldo > 0 ? 'Saldo Inicial (DEUDA)' : 'Saldo Inicial (FAVOR)']
                    );
                }
            }

            // 6. Crear 2 Proveedores
            const prov1 = await pool.query(
                "INSERT INTO proveedores (condominio_id, identificador, nombre, rubro, estado_venezuela, direccion, telefono1) VALUES ($1, 'J111111111', '[TEST] Empresa de Limpieza', 'Limpieza', 'Distrito Capital', 'Sede Principal', '0412-0000000') RETURNING id", 
                [condoId]
            );
            const prov2 = await pool.query(
                "INSERT INTO proveedores (condominio_id, identificador, nombre, rubro, estado_venezuela, direccion, telefono1) VALUES ($1, 'J222222222', '[TEST] Mantenimiento Técnico', 'Mantenimiento', 'Miranda', 'Taller Central', '0414-1111111') RETURNING id", 
                [condoId]
            );
            const idProv1 = prov1.rows[0].id;
            const idProv2 = prov2.rows[0].id;

            // 7. Crear 12 Gastos
            const gastosConfig = [
                { prov: idProv1, concepto: '[TEST] Limpieza de pasillos comunes', usd: 100, tipo: 'Comun', zona: null, prop: null },
                { prov: idProv1, concepto: '[TEST] Insumos de conserjería', usd: 40, tipo: 'Comun', zona: null, prop: null },
                { prov: idProv2, concepto: '[TEST] Revisión de portón principal', usd: 150, tipo: 'Comun', zona: null, prop: null },
                { prov: idProv1, concepto: '[TEST] Recolección de basura', usd: 60, tipo: 'Comun', zona: null, prop: null },
                { prov: idProv2, concepto: '[TEST] Mantenimiento cuarto de bombas', usd: 80, tipo: 'Comun', zona: null, prop: null },
                
                { prov: idProv1, concepto: '[TEST] Limpieza profunda Torre A', usd: 50, tipo: 'Zona', zona: idZa, prop: null },
                { prov: idProv2, concepto: '[TEST] Falla eléctrica ascensor Torre A', usd: 120, tipo: 'Zona', zona: idZa, prop: null },
                { prov: idProv1, concepto: '[TEST] Pintura lobby Torre B', usd: 90, tipo: 'Zona', zona: idZb, prop: null },
                { prov: idProv2, concepto: '[TEST] Reparación puerta Torre B', usd: 45, tipo: 'Zona', zona: idZb, prop: null },
                
                { prov: idProv2, concepto: '[TEST] Destape cañería Apto 1A', usd: 25, tipo: 'Individual', zona: null, prop: props[0] },
                { prov: idProv2, concepto: '[TEST] Reparación filtración Apto 3B', usd: 75, tipo: 'Individual', zona: null, prop: props[5] },
                { prov: idProv1, concepto: '[TEST] Limpieza especial post-mudanza Apto 4A', usd: 30, tipo: 'Individual', zona: null, prop: props[6] }
            ];

            for (const g of gastosConfig) {
                const gas = await pool.query(
                    "INSERT INTO gastos (condominio_id, proveedor_id, concepto, monto_bs, tasa_cambio, monto_usd, total_cuotas, tipo, zona_id, propiedad_id, fecha_gasto) VALUES ($1, $2, $3, $4, 40, $5, 1, $6, $7, $8, CURRENT_DATE) RETURNING id",
                    [condoId, g.prov, g.concepto, g.usd * 40, g.usd, g.tipo, g.zona, g.prop]
                );
                await pool.query(
                    "INSERT INTO gastos_cuotas (gasto_id, numero_cuota, monto_cuota_usd, mes_asignado, estado) VALUES ($1, 1, $2, $3, 'Pendiente')",
                    [gas.rows[0].id, g.usd, mesActual]
                );
            }

            await pool.query('COMMIT');
            res.json({ status: 'success', message: '📦 Base de datos poblada exitosamente con 3 Cuentas Bancarias, 3 Fondos, 8 Inmuebles, 2 Zonas y 12 Gastos.' });
        } catch (err) {
            await pool.query('ROLLBACK');
            res.status(500).json({ error: err.message });
        }
    });
};

module.exports = { registerDashboardRoutes };
