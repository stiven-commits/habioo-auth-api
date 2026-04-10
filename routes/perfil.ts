import type { NextFunction, Request, Response } from 'express';
import type { Pool } from 'pg';

const express: typeof import('express') = require('express');
const fs: typeof import('fs') = require('fs');
const path: typeof import('path') = require('path');
const bcrypt: typeof import('bcryptjs') = require('bcryptjs');
const multer: typeof import('multer') = require('multer');
const sharp: typeof import('sharp') = require('sharp');

const { pool }: { pool: Pool } = require('../config/db');
const { verifyToken }: {
  verifyToken: (req: Request, res: Response, next: NextFunction) => void | Promise<void>;
} = require('../middleware/verifyToken');

interface AuthUserPayload {
  id: number;
  condominio_id?: number;
}

interface ApiOk<T = Record<string, unknown>> {
  status: 'success';
  data?: T;
  message?: string;
}

interface ApiErr {
  status: 'error';
  message: string;
}

type ApiRes<T = Record<string, unknown>> = ApiOk<T> | ApiErr;

interface PerfilCondominioRow {
  id: number;
  nombre: string | null;
  nombre_legal: string | null;
  rif: string | null;
  direccion: string | null;
  porcentaje_morosidad: string | number | null;
  admin_nombre: string | null;
  admin_rif: string | null;
  admin_representante: string | null;
  admin_telefono: string | null;
  admin_correo: string | null;
  logo_url: string | null;
  logo_condominio_url: string | null;
  firma_url: string | null;
  aviso_msg_1: string | null;
  aviso_msg_2: string | null;
  aviso_msg_3: string | null;
  aviso_msg_4: string | null;
  tipo: string | null;
  junta_general_id: number | null;
  tasa_interes: string | number | null;
  created_at: string | Date | null;
  metodo_division: string | null;
  cuota_participacion: string | number | null;
  estado_venezuela: string | null;
  mes_actual: string | null;
  admin_user_id: number | null;
}

interface PerfilJerarquiaRow {
  id: number;
  rif: string | null;
  tipo: string | null;
  junta_general_id: number | null;
  cuota_participacion: string | number | null;
}

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads', 'perfil');
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const getAuthUser = (req: Request): AuthUserPayload | null => {
  const authUser = req.user as AuthUserPayload | undefined;
  if (!authUser || typeof authUser.id !== 'number') return null;
  return authUser;
};

const resolveCondominioIdFromToken = (req: Request): number | null => {
  const authUser = getAuthUser(req);
  if (!authUser) return null;
  const condominioId = authUser.condominio_id;
  if (typeof condominioId !== 'number' || !Number.isFinite(condominioId)) return null;
  return condominioId;
};

const getPerfilColumnByTipo = (tipo: string): 'logo_url' | 'logo_condominio_url' | 'firma_url' | null => {
  if (tipo === 'logo') return 'logo_url';
  if (tipo === 'logo-condominio') return 'logo_condominio_url';
  if (tipo === 'firma') return 'firma_url';
  return null;
};

const hasColumn = async (columnName: string): Promise<boolean> => {
  const colsRes = await pool.query<{ column_name: string }>(
    `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'condominios'
        AND column_name = $1
      LIMIT 1
    `,
    [columnName],
  );
  return colsRes.rows.length > 0;
};

const hasOwn = (obj: Record<string, unknown>, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(obj, key);

const normalizeComparableText = (value: unknown): string =>
  String(value ?? '').trim().toLowerCase();

const toNullableInt = (value: unknown): number | null => {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const n = Number.parseInt(String(value), 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
};

const toNullableDecimal = (value: unknown): number | null => {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const n = Number.parseFloat(String(value).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

router.get('/', verifyToken, async (req: Request, res: Response<ApiRes<PerfilCondominioRow>>): Promise<void> => {
  try {
    const condominioId = resolveCondominioIdFromToken(req);
    if (!condominioId) {
      res.status(400).json({ status: 'error', message: 'No se encontro condominio_id en el token.' });
      return;
    }

    const result = await pool.query<PerfilCondominioRow>(
      `
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
          logo_condominio_url,
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
      `,
      [condominioId],
    );

    if (result.rows.length === 0) {
      res.status(404).json({ status: 'error', message: 'Condominio no encontrado.' });
      return;
    }

    res.json({ status: 'success', data: result.rows[0] });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error inesperado al obtener el perfil.';
    res.status(500).json({ status: 'error', message });
  }
});

router.put('/', verifyToken, async (req: Request, res: Response<ApiRes>): Promise<void> => {
  try {
    const condominioId = resolveCondominioIdFromToken(req);
    if (!condominioId) {
      res.status(400).json({ status: 'error', message: 'No se encontro condominio_id en el token.' });
      return;
    }

    const body = (req.body as Record<string, unknown>) || {};

    const currentRes = await pool.query<PerfilJerarquiaRow>(
      `
        SELECT id, rif, tipo, junta_general_id, cuota_participacion
        FROM condominios
        WHERE id = $1
        LIMIT 1
      `,
      [condominioId],
    );
    const current = currentRes.rows[0];
    if (!current) {
      res.status(404).json({ status: 'error', message: 'Condominio no encontrado.' });
      return;
    }

    const attemptedTipo = hasOwn(body, 'tipo') ? normalizeComparableText(body.tipo) : normalizeComparableText(current.tipo);
    const attemptedJuntaGeneralId = hasOwn(body, 'junta_general_id') ? toNullableInt(body.junta_general_id) : current.junta_general_id;
    const attemptedCuota = hasOwn(body, 'cuota_participacion') ? toNullableDecimal(body.cuota_participacion) : toNullableDecimal(current.cuota_participacion);

    const currentTipo = normalizeComparableText(current.tipo);
    const currentJuntaGeneralId = current.junta_general_id;
    const currentCuota = toNullableDecimal(current.cuota_participacion);

    const cuotaChanged = (() => {
      if (attemptedCuota === null && currentCuota === null) return false;
      if (attemptedCuota === null || currentCuota === null) return true;
      return Math.abs(attemptedCuota - currentCuota) > 0.000001;
    })();

    if (
      attemptedTipo !== currentTipo ||
      attemptedJuntaGeneralId !== currentJuntaGeneralId ||
      cuotaChanged
    ) {
      res.status(403).json({
        status: 'error',
        message: 'La jerarquia de la junta no se puede editar desde Perfil. Usa el flujo de vinculacion autorizado.',
      });
      return;
    }

    const {
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
      aviso_msg_1,
      aviso_msg_2,
      aviso_msg_3,
      aviso_msg_4,
      tasa_interes,
      metodo_division,
      estado_venezuela,
      mes_actual,
    } = body;

    await pool.query(
      `
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
      `,
      [
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
        current.tipo ?? null,
        current.junta_general_id ?? null,
        tasa_interes ?? null,
        metodo_division ?? null,
        current.cuota_participacion ?? null,
        estado_venezuela ?? null,
        mes_actual ?? null,
        condominioId,
      ],
    );

    res.json({ status: 'success', message: 'Perfil actualizado correctamente.' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error inesperado al actualizar el perfil.';
    res.status(500).json({ status: 'error', message });
  }
});

router.put('/password', verifyToken, async (req: Request, res: Response<ApiRes>): Promise<void> => {
  try {
    const authUser = getAuthUser(req);
    if (!authUser) {
      res.status(401).json({ status: 'error', message: 'Usuario no autenticado.' });
      return;
    }

    const { nueva_password } = req.body as { nueva_password?: string };
    if (!nueva_password || !nueva_password.trim()) {
      res.status(400).json({ status: 'error', message: 'Debe enviar nueva_password.' });
      return;
    }

    const hashed = await bcrypt.hash(nueva_password, 10);
    const updateRes = await pool.query(
      'UPDATE users SET password = $1, debe_cambiar_password = false WHERE id = $2',
      [hashed, authUser.id]
    );
    if (updateRes.rowCount === 0) {
      res.status(404).json({ status: 'error', message: 'Usuario no encontrado para actualizar password.' });
      return;
    }

    res.json({ status: 'success', message: 'Password actualizada correctamente.' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error inesperado al actualizar la password.';
    res.status(500).json({ status: 'error', message });
  }
});

router.post('/upload/:tipo', verifyToken, upload.any(), async (req: Request, res: Response<ApiRes>): Promise<void> => {
  try {
    const condominioId = resolveCondominioIdFromToken(req);
    if (!condominioId) {
      res.status(400).json({ status: 'error', message: 'No se encontro condominio_id en el token.' });
      return;
    }

    const tipo = String(req.params.tipo || '').toLowerCase();
    const column = getPerfilColumnByTipo(tipo);
    if (!column) {
      res.status(400).json({ status: 'error', message: "Parametro :tipo invalido. Use 'logo', 'logo-condominio' o 'firma'." });
      return;
    }

    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
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
    } else {
      await sharp(file.buffer)
        .rotate()
        .resize({ width: 500, withoutEnlargement: true })
        .webp({ quality: 85 })
        .toFile(absolutePath);
    }

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
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error inesperado al subir la imagen.';
    res.status(500).json({ status: 'error', message });
  }
});

router.delete('/upload/:tipo', verifyToken, async (req: Request, res: Response<ApiRes>): Promise<void> => {
  try {
    const condominioId = resolveCondominioIdFromToken(req);
    if (!condominioId) {
      res.status(400).json({ status: 'error', message: 'No se encontro condominio_id en el token.' });
      return;
    }

    const tipo = String(req.params.tipo || '').toLowerCase();
    const column = getPerfilColumnByTipo(tipo);
    if (!column) {
      res.status(400).json({ status: 'error', message: "Parametro :tipo invalido. Use 'logo', 'logo-condominio' o 'firma'." });
      return;
    }

    const exists = await hasColumn(column);
    if (!exists) {
      res.status(400).json({ status: 'error', message: `La columna ${column} no existe en condominios.` });
      return;
    }

    const currentValueRes = await pool.query<{ file_url: string | null }>(
      `SELECT ${column} AS file_url FROM condominios WHERE id = $1 LIMIT 1`,
      [condominioId],
    );

    if (currentValueRes.rows.length === 0) {
      res.status(404).json({ status: 'error', message: 'Condominio no encontrado.' });
      return;
    }

    const currentUrl = String(currentValueRes.rows[0]?.file_url || '').trim();
    await pool.query(`UPDATE condominios SET ${column} = NULL WHERE id = $1`, [condominioId]);

    if (currentUrl.startsWith('/uploads/perfil/')) {
      const filename = path.basename(currentUrl);
      const absolutePath = path.join(UPLOAD_DIR, filename);
      if (fs.existsSync(absolutePath)) {
        await fs.promises.unlink(absolutePath);
      }
    }

    res.json({
      status: 'success',
      message: `${tipo} eliminado correctamente.`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error inesperado al eliminar la imagen.';
    res.status(500).json({ status: 'error', message });
  }
});

module.exports = router;
