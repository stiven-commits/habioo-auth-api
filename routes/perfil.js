"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express = require('express');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const sharp = require('sharp');
const { pool } = require('../config/db');
const { verifyToken } = require('../middleware/verifyToken');
const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });
const UPLOAD_DIR = path.join(__dirname, '..', 'uploads', 'perfil');
if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}
const getAuthUser = (req) => {
    const authUser = req.user;
    if (!authUser || typeof authUser.id !== 'number')
        return null;
    return authUser;
};
const resolveCondominioIdFromToken = (req) => {
    const authUser = getAuthUser(req);
    if (!authUser)
        return null;
    const condominioId = authUser.condominio_id;
    if (typeof condominioId !== 'number' || !Number.isFinite(condominioId))
        return null;
    return condominioId;
};
const hasColumn = async (columnName) => {
    const colsRes = await pool.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'condominios'
        AND column_name = $1
      LIMIT 1
    `, [columnName]);
    return colsRes.rows.length > 0;
};
router.get('/', verifyToken, async (req, res) => {
    try {
        const condominioId = resolveCondominioIdFromToken(req);
        if (!condominioId) {
            res.status(400).json({ status: 'error', message: 'No se encontro condominio_id en el token.' });
            return;
        }
        const result = await pool.query(`
        SELECT
          id,
          nombre,
          nombre_legal,
          rif,
          direccion,
          porcentaje_morosidad,
          admin_nombre,
          admin_rif,
          admin_representante,
          admin_telefono,
          admin_correo,
          logo_url,
          firma_url,
          aviso_msg_1,
          aviso_msg_2,
          aviso_msg_3,
          aviso_msg_4,
          tipo,
          junta_general_id,
          tasa_interes,
          created_at,
          metodo_division,
          cuota_participacion,
          estado_venezuela,
          mes_actual,
          admin_user_id
        FROM condominios
        WHERE id = $1
        LIMIT 1
      `, [condominioId]);
        if (result.rows.length === 0) {
            res.status(404).json({ status: 'error', message: 'Condominio no encontrado.' });
            return;
        }
        res.json({ status: 'success', data: result.rows[0] });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Error inesperado al obtener el perfil.';
        res.status(500).json({ status: 'error', message });
    }
});
router.put('/', verifyToken, async (req, res) => {
    try {
        const condominioId = resolveCondominioIdFromToken(req);
        if (!condominioId) {
            res.status(400).json({ status: 'error', message: 'No se encontro condominio_id en el token.' });
            return;
        }
        const { nombre, nombre_legal, rif, direccion, porcentaje_morosidad, admin_nombre, admin_rif, admin_representante, admin_telefono, admin_correo, aviso_msg_1, aviso_msg_2, aviso_msg_3, aviso_msg_4, tipo, junta_general_id, tasa_interes, metodo_division, cuota_participacion, estado_venezuela, mes_actual, } = req.body;
        await pool.query(`
        UPDATE condominios
        SET nombre = $1,
            nombre_legal = $2,
            rif = $3,
            direccion = $4,
            porcentaje_morosidad = $5,
            admin_nombre = $6,
            admin_rif = $7,
            admin_representante = $8,
            admin_telefono = $9,
            admin_correo = $10,
            aviso_msg_1 = $11,
            aviso_msg_2 = $12,
            aviso_msg_3 = $13,
            aviso_msg_4 = $14,
            tipo = $15,
            junta_general_id = $16,
            tasa_interes = $17,
            metodo_division = $18,
            cuota_participacion = $19,
            estado_venezuela = $20,
            mes_actual = $21
        WHERE id = $22
      `, [
            nombre ?? nombre_legal ?? null,
            nombre_legal ?? nombre ?? null,
            rif ?? null,
            direccion ?? null,
            porcentaje_morosidad ?? null,
            admin_nombre ?? null,
            admin_rif ?? null,
            admin_representante ?? null,
            admin_telefono ?? null,
            admin_correo ?? null,
            aviso_msg_1 ?? null,
            aviso_msg_2 ?? null,
            aviso_msg_3 ?? null,
            aviso_msg_4 ?? null,
            tipo ?? null,
            junta_general_id ?? null,
            tasa_interes ?? null,
            metodo_division ?? null,
            cuota_participacion ?? null,
            estado_venezuela ?? null,
            mes_actual ?? null,
            condominioId,
        ]);
        res.json({ status: 'success', message: 'Perfil actualizado correctamente.' });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Error inesperado al actualizar el perfil.';
        res.status(500).json({ status: 'error', message });
    }
});
router.put('/password', verifyToken, async (req, res) => {
    try {
        const authUser = getAuthUser(req);
        if (!authUser) {
            res.status(401).json({ status: 'error', message: 'Usuario no autenticado.' });
            return;
        }
        const { nueva_password } = req.body;
        if (!nueva_password || !nueva_password.trim()) {
            res.status(400).json({ status: 'error', message: 'Debe enviar nueva_password.' });
            return;
        }
        const hashed = await bcrypt.hash(nueva_password, 10);
        const updateRes = await pool.query('UPDATE users SET password = $1 WHERE id = $2', [hashed, authUser.id]);
        if (updateRes.rowCount === 0) {
            res.status(404).json({ status: 'error', message: 'Usuario no encontrado para actualizar password.' });
            return;
        }
        res.json({ status: 'success', message: 'Password actualizada correctamente.' });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Error inesperado al actualizar la password.';
        res.status(500).json({ status: 'error', message });
    }
});
router.post('/upload/:tipo', verifyToken, upload.any(), async (req, res) => {
    try {
        const condominioId = resolveCondominioIdFromToken(req);
        if (!condominioId) {
            res.status(400).json({ status: 'error', message: 'No se encontro condominio_id en el token.' });
            return;
        }
        const tipo = String(req.params.tipo || '').toLowerCase();
        if (tipo !== 'logo' && tipo !== 'firma') {
            res.status(400).json({ status: 'error', message: "Parametro :tipo invalido. Use 'logo' o 'firma'." });
            return;
        }
        const files = req.files ?? [];
        const file = files[0];
        if (!file) {
            res.status(400).json({ status: 'error', message: 'Debe enviar una imagen multipart/form-data.' });
            return;
        }
        const filename = `${tipo}-${condominioId}-${Date.now()}.webp`;
        const absolutePath = path.join(UPLOAD_DIR, filename);
        const publicUrl = `/uploads/perfil/${filename}`;
        if (tipo === 'firma') {
            const rgba = await sharp(file.buffer)
                .rotate()
                .ensureAlpha()
                .raw()
                .toBuffer({ resolveWithObject: true });
            const { data, info } = rgba;
            const threshold = 245;
            for (let i = 0; i < data.length; i += info.channels) {
                const r = data[i];
                const g = data[i + 1];
                const b = data[i + 2];
                if (r >= threshold && g >= threshold && b >= threshold) {
                    data[i + 3] = 0;
                }
            }
            await sharp(data, {
                raw: {
                    width: info.width,
                    height: info.height,
                    channels: info.channels,
                },
            })
                .resize({ width: 500, withoutEnlargement: true })
                .webp({ quality: 90, alphaQuality: 100 })
                .toFile(absolutePath);
        }
        else {
            await sharp(file.buffer)
                .rotate()
                .resize({ width: 500, withoutEnlargement: true })
                .webp({ quality: 85 })
                .toFile(absolutePath);
        }
        const column = tipo === 'logo' ? 'logo_url' : 'firma_url';
        const exists = await hasColumn(column);
        if (!exists) {
            res.status(400).json({ status: 'error', message: `La columna ${column} no existe en condominios.` });
            return;
        }
        await pool.query(`UPDATE condominios SET ${column} = $1 WHERE id = $2`, [publicUrl, condominioId]);
        res.json({
            status: 'success',
            data: {
                tipo,
                url: publicUrl,
            },
            message: `${tipo} actualizado correctamente.`,
        });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Error inesperado al subir la imagen.';
        res.status(500).json({ status: 'error', message });
    }
});
module.exports = router;
//# sourceMappingURL=perfil.js.map