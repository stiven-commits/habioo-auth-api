-- Generado automaticamente desde: C:/Users/stive/Downloads/carga manual.xlsx
-- Fecha de generacion: 2026-04-04T14:59:56.346Z
-- Registros incluidos: 44
-- Registros descartados: 1

BEGIN;
SET TIME ZONE 'America/Caracas';

CREATE TEMP TABLE tmp_carga_pagos (
  fecha_operacion date NOT NULL,
  referencia text NOT NULL,
  inmueble text NOT NULL,
  tasa_bcv numeric(18,6) NOT NULL,
  banco_abrev text NOT NULL,
  monto_distribuible_bs numeric(14,2),
  monto_operativo_bs numeric(14,2)
) ON COMMIT DROP;

INSERT INTO tmp_carga_pagos (fecha_operacion, referencia, inmueble, tasa_bcv, banco_abrev, monto_distribuible_bs, monto_operativo_bs)
VALUES
    (DATE '2026-03-04', '4819', '19-6', 425.674100, 'NAC. CREDITO', 7926.08, 3988.53),
    (DATE '2026-03-05', '4821', '18-2', 427.930200, 'VENEZUELA', 50273.24, 9816.72),
    (DATE '2026-03-05', '4823', '4-6', 427.930200, 'VENEZUELA', 7274.81, 0.00),
    (DATE '2026-03-05', '4825', '5-2', 427.930200, 'VENEZUELA', 9059.64, 4908.36),
    (DATE '2026-03-05', '4827', '4-1', 427.930200, 'MERCANTIL', 12988.80, 2139.65),
    (DATE '2026-03-05', '4829', '4-1', 427.930200, 'MERCANTIL', 10325.15, 2139.65),
    (DATE '2026-03-06', '4839', '7-6', 427.930200, 'PROVINCIAL', 43730.61, 8019.40),
    (DATE '2026-03-07', '4840', '20-1', 431.011300, 'BANESCO', 7827.15, 3586.00),
    (DATE '2026-03-07', '4842', '13-4', 431.011300, 'VENEZUELA', 6499.66, 3586.00),
    (DATE '2026-03-09', '4846', '3-1', 433.166400, 'MERCANTIL', 6653.50, 3603.97),
    (DATE '2026-03-09', '4848', '19-4', 433.166400, 'VENEZUELA', 7070.03, 3603.97),
    (DATE '2026-03-09', '4850', '5-4', 433.166400, 'BANESCO', 7659.03, 3603.97),
    (DATE '2026-03-10', '4854', '19-2', 436.241900, 'BANESCO', 9392.33, 5003.67),
    (DATE '2026-03-10', '4862', '17-2', 436.241900, 'MERCANTIL', 9235.27, 5003.67),
    (DATE '2026-03-11', '4864', '15-1', 438.205000, 'VENEZUELA', 7254.09, 3645.91),
    (DATE '2026-03-11', '4866', '15-5', 438.205000, 'BANCARIBE', 21498.22, 10052.54),
    (DATE '2026-03-11', '4868', '6-3', 425.674100, 'MERCANTIL', 135.84, 0.00),
    (DATE '2026-03-11', '4870', '16-5', 438.205000, 'VENEZUELA', 9947.46, 10052.54),
    (DATE '2026-03-11', '4872', '11-4', 443.258700, 'BANESCO', 12595.59, 3687.92),
    (DATE '2026-03-12', '4874', '13-6', 440.965700, 'MERCANTIL', 7624.10, 4131.89),
    (DATE '2026-03-12', '4876', '12-1', 440.965700, 'VENEZUELA', 7527.10, 3668.87),
    (DATE '2026-03-12', '4878', '9-3', 440.965700, 'BANESCO', 7568.11, 4131.89),
    (DATE '2026-03-12', '4880', '8-3', 440.965700, 'BANESCO', 7775.11, 4131.89),
    (DATE '2026-03-12', '4882', '8-3 puesto', 440.965700, 'BANESCO', 20.25, 626.18),
    (DATE '2026-03-12', '4884', '5-5', 440.965700, 'VENEZUELA', 9409.80, 5057.88),
    (DATE '2026-03-12', '4886', '5-6', 440.965700, 'VENEZUELA', 7685.20, 4131.85),
    (DATE '2026-03-13', '4896', '2-4', 443.258700, 'PROVINCIAL', 6809.25, 3690.75),
    (DATE '2026-03-13', '4897', '4-1', 443.258700, 'MERCANTIL', 15106.24, 4742.88),
    (DATE '2026-03-13', '4899', '4-1', 443.258700, 'MERCANTIL', 10413.61, 4742.88),
    (DATE '2026-03-13', '4901', '1-1', 443.258700, 'PROVINCIAL', 6312.08, 3687.92),
    (DATE '2026-03-13', '4905', '2-5', 443.258700, 'MERCANTIL', 8319.81, 5084.19),
    (DATE '2026-03-13', '4907', '4-3', 443.258700, 'MERCANTIL', 24034.59, 2965.41),
    (DATE '2026-03-14', '4909', '3-6', 443.258700, 'PROVINCIAL', 7637.83, 4153.35),
    (DATE '2026-03-14', '4910', '7-2', 443.258700, 'VENEZUELA', 9383.82, 5084.19),
    (DATE '2026-03-14', '4912', '7-4', 443.258700, 'BFC', 6808.45, 3687.92),
    (DATE '2026-03-14', '4914', '7-5', 443.258700, 'BANESCO', 15515.81, 5084.19),
    (DATE '2026-03-14', '4916', '9-4', 443.258700, 'VENEZUELA', 6808.47, 3687.92),
    (DATE '2026-03-14', '4918', '20-3', 443.258700, 'VENEZUELA', 10846.65, 4153.35),
    (DATE '2026-03-14', '4920', '1-5', 443.258700, 'BANESCO', 11232.16, 5084.19),
    (DATE '2026-03-15', '4922', '18-1', 443.258700, 'BANESCO', 37544.00, 7375.84),
    (DATE '2026-03-15', '4924', '11-1', 443.258700, 'VENEZUELA', 6808.45, 3687.92),
    (DATE '2026-03-15', '4926', '12-4', 443.258700, 'VENEZUELA', 8865.71, 0.00),
    (DATE '2026-03-15', '4928', '6-2', 443.258700, 'VENEZUELA', 8936.00, 0.00),
    (DATE '2026-03-15', '4930', '6-2', 443.258700, 'VZLANO CRED', 4745.41, 5084.19);

DO $$
DECLARE
  v_condominio_id integer;
  v_cuenta_principal_id integer;
  v_propiedad_id integer;
  v_tasa numeric;
  v_banco_origen text;
  v_monto_distribuible_usd numeric;
  v_monto_operativo_usd numeric;
  v_pago_id integer;
  v_historial_id integer;
  v_fondo_operativo_id integer;
  v_nota_oper text;
  v_tipo_mov_distribucion text;
  v_fondo_row record;
  v_monto_parte_bs numeric;
  v_acumulado_bs numeric;
  v_remanente_bs numeric;
  v_ultimo_no_oper_id integer;
  v_inmueble_norm text;
  r record;
BEGIN
  SELECT c.id INTO v_condominio_id FROM condominios c WHERE c.rif = 'J310273421' LIMIT 1;
  IF v_condominio_id IS NULL THEN
    RAISE EXCEPTION 'No se encontro condominio con RIF J310273421';
  END IF;

  SELECT cb.id INTO v_cuenta_principal_id
  FROM cuentas_bancarias cb
  WHERE cb.condominio_id = v_condominio_id AND cb.activo = true AND cb.es_predeterminada = true
  ORDER BY cb.id DESC LIMIT 1;

  IF v_cuenta_principal_id IS NULL THEN
    RAISE EXCEPTION 'No se encontro cuenta principal activa para el condominio %', v_condominio_id;
  END IF;

  SELECT CASE
    WHEN pg_get_constraintdef(oid) ILIKE '%INGRESO_PAGO%' THEN 'INGRESO_PAGO'
    WHEN pg_get_constraintdef(oid) ILIKE '%INGRESO%' THEN 'INGRESO'
    WHEN pg_get_constraintdef(oid) ILIKE '%ABONO%' THEN 'ABONO'
    WHEN pg_get_constraintdef(oid) ILIKE '%ENTRADA%' THEN 'ENTRADA'
    ELSE 'AJUSTE_INICIAL'
  END INTO v_tipo_mov_distribucion
  FROM pg_constraint
  WHERE conname = 'movimientos_fondos_tipo_check'
  LIMIT 1;

  IF v_tipo_mov_distribucion IS NULL THEN
    v_tipo_mov_distribucion := 'AJUSTE_INICIAL';
  END IF;

  FOR r IN SELECT * FROM tmp_carga_pagos ORDER BY fecha_operacion, referencia LOOP
    BEGIN
      v_inmueble_norm := UPPER(REGEXP_REPLACE(BTRIM(r.inmueble), '\s+', ' ', 'g'));
      IF v_inmueble_norm ~ '^[0-9]{1,2}-(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)$' THEN
        v_inmueble_norm := REPLACE(v_inmueble_norm, '-JAN', '-1');
        v_inmueble_norm := REPLACE(v_inmueble_norm, '-FEB', '-2');
        v_inmueble_norm := REPLACE(v_inmueble_norm, '-MAR', '-3');
        v_inmueble_norm := REPLACE(v_inmueble_norm, '-APR', '-4');
        v_inmueble_norm := REPLACE(v_inmueble_norm, '-MAY', '-5');
        v_inmueble_norm := REPLACE(v_inmueble_norm, '-JUN', '-6');
        v_inmueble_norm := REPLACE(v_inmueble_norm, '-JUL', '-7');
        v_inmueble_norm := REPLACE(v_inmueble_norm, '-AUG', '-8');
        v_inmueble_norm := REPLACE(v_inmueble_norm, '-SEP', '-9');
        v_inmueble_norm := REPLACE(v_inmueble_norm, '-OCT', '-10');
        v_inmueble_norm := REPLACE(v_inmueble_norm, '-NOV', '-11');
        v_inmueble_norm := REPLACE(v_inmueble_norm, '-DEC', '-12');
      END IF;

      SELECT p.id
        INTO v_propiedad_id
        FROM propiedades p
       WHERE p.condominio_id = v_condominio_id
         AND (
           UPPER(REGEXP_REPLACE(BTRIM(p.identificador), '\s+', ' ', 'g')) =
           v_inmueble_norm
           OR
           REGEXP_REPLACE(UPPER(REGEXP_REPLACE(BTRIM(p.identificador), '\s+', ' ', 'g')), '\s+PUESTO$', '', 'g') =
           REGEXP_REPLACE(v_inmueble_norm, '\s+PUESTO$', '', 'g')
         )
       ORDER BY
         CASE
           WHEN UPPER(REGEXP_REPLACE(BTRIM(p.identificador), '\s+', ' ', 'g')) =
                v_inmueble_norm
           THEN 0
           ELSE 1
         END,
         p.created_at DESC,
         p.id DESC
       LIMIT 1;

      IF v_propiedad_id IS NULL THEN
        RAISE EXCEPTION 'No se encontro inmueble % (normalizado: %) en condominio %', r.inmueble, v_inmueble_norm, v_condominio_id;
      END IF;

      v_tasa := r.tasa_bcv;

      v_banco_origen := CASE UPPER(BTRIM(r.banco_abrev))
        WHEN 'NAC. CREDITO' THEN 'Banco Nacional de Credito (BNC)'
        WHEN 'VENEZUELA' THEN 'Banco de Venezuela (BDV)'
        WHEN 'MERCANTIL' THEN 'Banco Mercantil'
        WHEN 'PROVINCIAL' THEN 'BBVA Provincial'
        WHEN 'BANESCO' THEN 'Banesco Banco Universal'
        WHEN 'BANCARIBE' THEN 'Banco del Caribe (Bancaribe)'
        WHEN 'BFC' THEN 'Banco Fondo Comun (BFC)'
        ELSE BTRIM(r.banco_abrev)
      END;

      IF COALESCE(r.monto_distribuible_bs, 0) > 0 THEN
        v_monto_distribuible_usd := ROUND((r.monto_distribuible_bs / v_tasa)::numeric, 2);

        INSERT INTO pagos (
          propiedad_id, recibo_id, cuenta_bancaria_id, monto_origen, tasa_cambio, monto_usd,
          moneda, referencia, fecha_pago, metodo, estado, nota, banco_origen, es_ajuste_historico
        ) VALUES (
          v_propiedad_id, NULL, v_cuenta_principal_id, r.monto_distribuible_bs, v_tasa, v_monto_distribuible_usd,
          'BS', r.referencia, r.fecha_operacion, 'Transferencia', 'Validado',
          'Pago validado | Ref origen: ' || r.referencia || ' | Banco origen: ' || v_banco_origen,
          v_banco_origen, false
        ) RETURNING id INTO v_pago_id;

        UPDATE propiedades SET saldo_actual = COALESCE(saldo_actual, 0) - v_monto_distribuible_usd WHERE id = v_propiedad_id;

        v_acumulado_bs := 0;
        v_ultimo_no_oper_id := NULL;

        FOR v_fondo_row IN
          SELECT f.id, COALESCE(f.porcentaje_asignacion, 0)::numeric AS pct
          FROM fondos f
          WHERE f.cuenta_bancaria_id = v_cuenta_principal_id AND f.activo = true AND f.es_operativo = false
          ORDER BY f.id ASC
        LOOP
          v_monto_parte_bs := ROUND((r.monto_distribuible_bs * v_fondo_row.pct / 100.0)::numeric, 2);
          v_acumulado_bs := ROUND((v_acumulado_bs + v_monto_parte_bs)::numeric, 2);
          v_ultimo_no_oper_id := v_fondo_row.id;

          IF v_monto_parte_bs > 0 THEN
            UPDATE fondos SET saldo_actual = COALESCE(saldo_actual, 0) + v_monto_parte_bs WHERE id = v_fondo_row.id;
            INSERT INTO movimientos_fondos (fondo_id, tipo, monto, referencia_id, tasa_cambio, nota, fecha)
            VALUES (
              v_fondo_row.id, v_tipo_mov_distribucion, v_monto_parte_bs, v_pago_id, v_tasa,
              'Abono distribuible de pago #' || v_pago_id || ' (' || r.referencia || ')',
              (r.fecha_operacion + time '12:00:00')
            );
          END IF;
        END LOOP;

        v_remanente_bs := ROUND((r.monto_distribuible_bs - v_acumulado_bs)::numeric, 2);

        SELECT f.id INTO v_fondo_operativo_id
        FROM fondos f
        WHERE f.cuenta_bancaria_id = v_cuenta_principal_id AND f.activo = true AND f.es_operativo = true
        ORDER BY f.id ASC
        LIMIT 1;

        IF v_remanente_bs <> 0 THEN
          IF v_fondo_operativo_id IS NOT NULL THEN
            UPDATE fondos SET saldo_actual = COALESCE(saldo_actual, 0) + v_remanente_bs WHERE id = v_fondo_operativo_id;
            INSERT INTO movimientos_fondos (fondo_id, tipo, monto, referencia_id, tasa_cambio, nota, fecha)
            VALUES (
              v_fondo_operativo_id, v_tipo_mov_distribucion, v_remanente_bs, v_pago_id, v_tasa,
              'Abono distribuible de pago #' || v_pago_id || ' (' || r.referencia || ')',
              (r.fecha_operacion + time '12:00:00')
            );
          ELSIF v_ultimo_no_oper_id IS NOT NULL THEN
            UPDATE fondos SET saldo_actual = COALESCE(saldo_actual, 0) + v_remanente_bs WHERE id = v_ultimo_no_oper_id;
            INSERT INTO movimientos_fondos (fondo_id, tipo, monto, referencia_id, tasa_cambio, nota, fecha)
            VALUES (
              v_ultimo_no_oper_id, v_tipo_mov_distribucion, v_remanente_bs, v_pago_id, v_tasa,
              'Abono distribuible de pago #' || v_pago_id || ' (' || r.referencia || ')',
              (r.fecha_operacion + time '12:00:00')
            );
          END IF;
        END IF;
      END IF;

      IF COALESCE(r.monto_operativo_bs, 0) > 0 THEN
        v_monto_operativo_usd := ROUND((r.monto_operativo_bs / v_tasa)::numeric, 2);

        UPDATE propiedades SET saldo_actual = COALESCE(saldo_actual, 0) - v_monto_operativo_usd WHERE id = v_propiedad_id;

        v_nota_oper :=
        'Pago validado | [bs_raw:' || r.monto_operativo_bs || '] | [tasa_raw:' || v_tasa || '] | Ref origen: ' || r.referencia || ' | Banco origen: ' || v_banco_origen;

        INSERT INTO historial_saldos_inmuebles (propiedad_id, tipo, monto, monto_bs, tasa_cambio, nota, fecha)
        VALUES (
          v_propiedad_id, 'AGREGAR_FAVOR', v_monto_operativo_usd, r.monto_operativo_bs, v_tasa, v_nota_oper,
          (r.fecha_operacion + time '12:00:00')
        ) RETURNING id INTO v_historial_id;

        SELECT f.id INTO v_fondo_operativo_id
        FROM fondos f
        WHERE f.cuenta_bancaria_id = v_cuenta_principal_id AND f.activo = true
        ORDER BY f.es_operativo DESC, f.id ASC
        LIMIT 1;

        IF v_fondo_operativo_id IS NOT NULL THEN
          UPDATE fondos SET saldo_actual = COALESCE(saldo_actual, 0) + r.monto_operativo_bs WHERE id = v_fondo_operativo_id;
          INSERT INTO movimientos_fondos (fondo_id, tipo, monto, tasa_cambio, nota, fecha)
          VALUES (
            v_fondo_operativo_id, 'AJUSTE_INICIAL', r.monto_operativo_bs, v_tasa,
            v_nota_oper || ' | ajuste_historial_id:' || v_historial_id,
            (r.fecha_operacion + time '12:00:00')
          );
        END IF;
      END IF;
    EXCEPTION
      WHEN OTHERS THEN
        RAISE EXCEPTION 'Error en referencia %, inmueble %, fecha %: %', r.referencia, r.inmueble, r.fecha_operacion, SQLERRM;
    END;
  END LOOP;
END $$;

COMMIT;
