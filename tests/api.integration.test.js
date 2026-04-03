const assert = require("node:assert/strict");
const express = require("express");

const { registerRecibosRoutes } = require("../routes/recibos.ts");
const { registerJuntasRoutes } = require("../routes/juntas.ts");

function createMockPool() {
  const condosByAdmin = new Map([
    [101, { id: 1, tipo: "Junta General" }],
    [201, { id: 2, tipo: "Junta Individual" }],
  ]);

  const condosById = new Map([
    [1, { id: 1, nombre: "Junta Demo General", nombre_legal: "Junta Demo General", rif: "J987564321", tipo: "Junta General", estado_venezuela: "Distrito Capital" }],
    [2, { id: 2, nombre: "Torre Norte", nombre_legal: "Torre Norte", rif: "J123456789", tipo: "Junta Individual", estado_venezuela: "Distrito Capital" }],
  ]);

  const recibosRows = [
    {
      id: 999,
      mes_cobro: "2026-04",
      monto_usd: "120.00",
      monto_pagado_usd: "20.00",
      deuda_pendiente: "100.00",
      estado: "Pendiente",
      fecha: "02/04/2026",
      apto: "TH-01",
      propietario: "Propietario Demo",
    },
  ];

  const miembrosRows = [
    {
      id: 10,
      condominio_nombre: "Torre A",
      nombre_referencia: "Torre A",
      condominio_rif: "J111111111",
      rif: "J111111111",
      condominio_individual_id: 100,
      cuota_participacion: "50",
      saldo_usd_generado: "100.00",
      saldo_usd_pagado: "10.00",
      saldo_bs_generado: "10000.00",
      saldo_bs_pagado: "1000.00",
    },
    {
      id: 11,
      condominio_nombre: "Torre B",
      nombre_referencia: "Torre B",
      condominio_rif: "J222222222",
      rif: "J222222222",
      condominio_individual_id: null,
      cuota_participacion: "50",
      saldo_usd_generado: "100.00",
      saldo_usd_pagado: "100.00",
      saldo_bs_generado: "10000.00",
      saldo_bs_pagado: "10000.00",
    },
  ];

  return {
    async query(text, params = []) {
      const sql = String(text || "").toLowerCase();

      if (sql.includes("select id, tipo from condominios where admin_user_id = $1")) {
        const condo = condosByAdmin.get(Number(params[0]));
        return { rows: condo ? [condo] : [] };
      }

      if (
        sql.includes("from condominios") &&
        sql.includes("where id = $1") &&
        sql.includes("limit 1")
      ) {
        const condo = condosById.get(Number(params[0]));
        return { rows: condo ? [condo] : [] };
      }

      if (sql.includes("from recibos r") && sql.includes("where c.admin_user_id = $1")) {
        return { rows: recibosRows };
      }

      if (sql.includes("from junta_general_miembros m")) {
        return { rows: miembrosRows };
      }

      return { rows: [] };
    },
  };
}

function makeVerifyToken() {
  return (req, _res, next) => {
    const userId = Number(req.headers["x-test-user-id"] || 101);
    const condominioId = Number(req.headers["x-test-condominio-id"] || 1);
    req.user = {
      id: userId,
      cedula: "V00000000",
      condominio_id: condominioId,
    };
    next();
  };
}

async function withServer(run) {
  const app = express();
  app.use(express.json());

  const pool = createMockPool();
  const verifyToken = makeVerifyToken();
  registerRecibosRoutes(app, { pool, verifyToken });
  registerJuntasRoutes(app, { pool, verifyToken });

  const server = await new Promise((resolve) => {
    const started = app.listen(0, () => resolve(started));
  });

  const address = server.address();
  const port = Number(address.port);

  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const tests = [
  {
    name: "GET /recibos-historial bloquea Junta General con 403",
    run: async (baseUrl) => {
      const res = await fetch(`${baseUrl}/recibos-historial`, {
        headers: {
          "x-test-user-id": "101",
          "x-test-condominio-id": "1",
        },
      });
      const data = await res.json();
      assert.equal(res.status, 403);
      assert.equal(data.status, "error");
    },
  },
  {
    name: "GET /recibos-historial permite Junta Individual con 200",
    run: async (baseUrl) => {
      const res = await fetch(`${baseUrl}/recibos-historial`, {
        headers: {
          "x-test-user-id": "201",
          "x-test-condominio-id": "2",
        },
      });
      const data = await res.json();
      assert.equal(res.status, 200);
      assert.equal(data.status, "success");
      assert.equal(Array.isArray(data.recibos), true);
      assert.equal(data.recibos.length, 1);
    },
  },
  {
    name: "GET /juntas-generales/resumen bloquea Junta Individual con 403",
    run: async (baseUrl) => {
      const res = await fetch(`${baseUrl}/juntas-generales/resumen`, {
        headers: {
          "x-test-user-id": "201",
          "x-test-condominio-id": "2",
        },
      });
      const data = await res.json();
      assert.equal(res.status, 403);
      assert.equal(data.status, "error");
    },
  },
  {
    name: "GET /juntas-generales/resumen permite Junta General y calcula metricas",
    run: async (baseUrl) => {
      const res = await fetch(`${baseUrl}/juntas-generales/resumen`, {
        headers: {
          "x-test-user-id": "101",
          "x-test-condominio-id": "1",
        },
      });
      const data = await res.json();
      assert.equal(res.status, 200);
      assert.equal(data.status, "success");
      assert.equal(data.data.metricas.total_juntas, 2);
      assert.equal(data.data.metricas.total_vinculadas, 1);
      assert.equal(data.data.metricas.total_usd_generado, 200);
      assert.equal(data.data.metricas.total_usd_pagado, 110);
      assert.equal(data.data.metricas.total_usd_pendiente, 90);
    },
  },
];

async function main() {
  let failures = 0;

  await withServer(async (baseUrl) => {
    for (const t of tests) {
      try {
        await t.run(baseUrl);
        console.log(`PASS: ${t.name}`);
      } catch (error) {
        failures += 1;
        console.error(`FAIL: ${t.name}`);
        console.error(error);
      }
    }
  });

  if (failures > 0) {
    console.error(`\n${failures} prueba(s) de integracion fallaron.`);
    process.exit(1);
  }

  console.log(`\nOK: ${tests.length} pruebas de integracion pasaron.`);
}

main().catch((error) => {
  console.error("FAIL: ejecucion de suite de integracion");
  console.error(error);
  process.exit(1);
});
