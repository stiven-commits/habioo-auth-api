-- Backfill: agrega clasificacion a gastos dentro de snapshot_jsonb de recibos existentes
-- Nota: solo toca recibos que ya tienen snapshot_jsonb.gastos como arreglo.
UPDATE recibos r
SET snapshot_jsonb = jsonb_set(
  r.snapshot_jsonb,
  '{gastos}',
  COALESCE(
    (
      SELECT jsonb_agg(
        jsonb_set(
          gasto_item,
          '{clasificacion}',
          to_jsonb(COALESCE(g.clasificacion, 'Variable')),
          true
        )
        ORDER BY ord
      )
      FROM jsonb_array_elements(
        COALESCE(
          CASE
            WHEN jsonb_typeof(r.snapshot_jsonb->'gastos') = 'array' THEN r.snapshot_jsonb->'gastos'
            ELSE NULL
          END,
          '[]'::jsonb
        )
      ) WITH ORDINALITY AS e(gasto_item, ord)
      LEFT JOIN gastos g
        ON g.id = CASE
          WHEN (e.gasto_item->>'id') ~ '^[0-9]+$' THEN (e.gasto_item->>'id')::integer
          ELSE NULL
        END
    ),
    '[]'::jsonb
  ),
  true
)
WHERE r.snapshot_jsonb IS NOT NULL
  AND r.snapshot_jsonb ? 'gastos'
  AND jsonb_typeof(r.snapshot_jsonb->'gastos') = 'array';
