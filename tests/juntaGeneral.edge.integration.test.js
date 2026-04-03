const assert = require("node:assert/strict");
const express = require("express");

const { registerJuntasRoutes } = require("../routes/juntas.ts");

function createMockPool() {
  const condominios = new Map([
    [1, { id: 1, admin_user_id: 101, nombre: "General Demo", nombre_legal: "General Demo", rif: "J111111111", tipo: "Junta General", estado_venezuela: "Distrito Capital", junta_general_id: null, cuota_participacion: null }],
    [2, { id: 2, admin_user_id: 201, nombre: "Torre Norte", nombre_legal: "Torre Norte", rif: "J200000000", tipo: "Junta Individual", estado_venezuela: "Miranda", junta_general_id: null, cuota_participacion: null }],
    [3, { id: 3, admin_user_id: 301, nombre: "Torre Sur", nombre_legal: "Torre Sur", rif: "J999999999", tipo: "Junta Individual", estado_venezuela: "Miranda", junta_general_id: null, cuota_participacion: null }],
  ]);

  const miembros = new Map([
    [10, { id: 10, junta_general_id: 1, condominio_individual_id: null, nombre_referencia: "Torre Norte", rif: "J200000000", cuota_participacion: "50", activo: true, es_fantasma: true, codigo_invitacion: "VALID123", codigo_expira_at: new Date(Date.now() + 3 * 86400000).toISOString(), vinculado_at: null }],
    [11, { id: 11, junta_general_id: 1, condominio_individual_id: null, nombre_referencia: "Torre Expirada", rif: "J300000000", cuota_participacion: "25", activo: true, es_fantasma: true, codigo_invitacion: "EXPIRED1", codigo_expira_at: new Date(Date.now() - 86400000).toISOString(), vinculado_at: null }],
    [12, { id: 12, junta_general_id: 1, condominio_individual_id: null, nombre_referencia: "Torre Mismatch", rif: "J400000000", cuota_participacion: "25", activo: true, es_fantasma: true, codigo_invitacion: "MISMATCH1", codigo_expira_at: new Date(Date.now() + 3 * 86400000).toISOString(), vinculado_at: null }],
    [20, { id: 20, junta_general_id: 1, condominio_individual_id: null, nombre_referencia: "Con Historial", rif: "J500000000", cuota_participacion: "10", activo: true, es_fantasma: true, codigo_invitacion: null, codigo_expira_at: null, vinculado_at: null }],
  ]);

  const historialPorMiembro = new Map([[20, 1]]);
  const proveedores = [];
  let proveedorSeq = 1;

  return {
    getState() {
      return { condominios, miembros, proveedores };
    },
    async query(text, params = []) {
      const sql = String(text || "").toLowerCase().trim();

      if (
        sql.startsWith("create table") ||
        sql.startsWith("create index") ||
        sql.startsWith("create or replace function") ||
        sql.startsWith("drop trigger") ||
        sql.startsWith("create trigger") ||
        sql.startsWith("alter table")
      ) {
        return { rows: [], rowCount: 0 };
      }

      if (sql === "begin" || sql === "commit" || sql === "rollback") {
        return { rows: [], rowCount: 0 };
      }

      if (sql.includes("from condominios") && sql.includes("where id = $1") && sql.includes("limit 1")) {
        const condo = condominios.get(Number(params[0]));
        return { rows: condo ? [condo] : [], rowCount: condo ? 1 : 0 };
      }

      if (sql.includes("from condominios") && sql.includes("where admin_user_id = $1") && sql.includes("limit 1")) {
        const adminId = Number(params[0]);
        const condo = Array.from(condominios.values()).find((c) => c.admin_user_id === adminId);
        return { rows: condo ? [condo] : [], rowCount: condo ? 1 : 0 };
      }

      if (sql.includes("from junta_general_miembros") && sql.includes("where id = $1") && sql.includes("junta_general_id = $2") && sql.includes("limit 1")) {
        const id = Number(params[0]);
        const juntaGeneralId = Number(params[1]);
        const member = miembros.get(id);
        const ok = member && member.junta_general_id === juntaGeneralId;
        return { rows: ok ? [member] : [], rowCount: ok ? 1 : 0 };
      }

      if (sql.includes("from junta_general_aviso_detalles") && sql.includes("where miembro_id = $1")) {
        const id = Number(params[0]);
        const total = String(historialPorMiembro.get(id) || 0);
        return { rows: [{ total }], rowCount: 1 };
      }

      if (sql.startsWith("delete from junta_general_miembros")) {
        const id = Number(params[0]);
        const juntaGeneralId = Number(params[1]);
        const member = miembros.get(id);
        if (member && member.junta_general_id === juntaGeneralId) {
          miembros.delete(id);
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }

      if (sql.includes("from junta_general_miembros m") && sql.includes("where m.codigo_invitacion = $1")) {
        const code = String(params[0] || "").trim().toUpperCase();
        const member = Array.from(miembros.values()).find((m) => String(m.codigo_invitacion || "").toUpperCase() === code);
        if (!member) return { rows: [], rowCount: 0 };
        const general = condominios.get(member.junta_general_id);
        return {
          rows: [{
            id: member.id,
            junta_general_id: member.junta_general_id,
            cuota_participacion: member.cuota_participacion,
            codigo_expira_at: member.codigo_expira_at,
            activo: member.activo,
            nombre_referencia: member.nombre_referencia,
            rif: member.rif,
            general_nombre: general?.nombre || null,
            general_nombre_legal: general?.nombre_legal || null,
            general_rif: general?.rif || null,
            general_estado: general?.estado_venezuela || null,
          }],
          rowCount: 1,
        };
      }

      if (sql.startsWith("update junta_general_miembros") && sql.includes("set condominio_individual_id = $1")) {
        const condominioIndividualId = Number(params[0]);
        const nombre = String(params[1] || "");
        const rif = String(params[2] || "");
        const id = Number(params[3]);
        const member = miembros.get(id);
        if (!member) return { rows: [], rowCount: 0 };
        member.condominio_individual_id = condominioIndividualId;
        member.es_fantasma = false;
        member.vinculado_at = new Date().toISOString();
        member.codigo_invitacion = null;
        member.codigo_expira_at = null;
        member.nombre_referencia = nombre || member.nombre_referencia;
        member.rif = rif || member.rif;
        miembros.set(id, member);
        return { rows: [], rowCount: 1 };
      }

      if (sql.includes("from junta_general_miembros") && sql.includes("where id = $1") && sql.includes("limit 1")) {
        const id = Number(params[0]);
        const member = miembros.get(id);
        return { rows: member ? [member] : [], rowCount: member ? 1 : 0 };
      }

      if (sql.startsWith("update condominios") && sql.includes("set junta_general_id = $1")) {
        const juntaGeneralId = Number(params[0]);
        const cuota = params[1];
        const condoId = Number(params[2]);
        const condo = condominios.get(condoId);
        if (!condo) return { rows: [], rowCount: 0 };
        condo.junta_general_id = juntaGeneralId;
        condo.tipo = condo.tipo === "Junta General" ? condo.tipo : "Junta Individual";
        if (condo.cuota_participacion == null) condo.cuota_participacion = cuota;
        condominios.set(condoId, condo);
        return { rows: [], rowCount: 1 };
      }

      if (sql.includes("from proveedores") && sql.includes("where condominio_id = $1")) {
        const condominioId = Number(params[0]);
        const identificador = String(params[1] || "").replace(/-/g, "").toUpperCase();
        const existing = proveedores.find(
          (p) => p.condominio_id === condominioId && String(p.identificador).replace(/-/g, "").toUpperCase() === identificador
        );
        return { rows: existing ? [{ id: existing.id }] : [], rowCount: existing ? 1 : 0 };
      }

      if (sql.startsWith("insert into proveedores") && sql.includes("returning id")) {
        const [condominioId, identificador, nombre, estadoVenezuela] = params;
        const row = {
          id: proveedorSeq++,
          condominio_id: Number(condominioId),
          identificador: String(identificador),
          nombre: String(nombre),
          estado_venezuela: String(estadoVenezuela),
        };
        proveedores.push(row);
        return { rows: [{ id: row.id }], rowCount: 1 };
      }

      if (sql.startsWith("insert into junta_general_notificaciones") || sql.startsWith("insert into junta_general_auditoria_eventos")) {
        return { rows: [], rowCount: 1 };
      }

      return { rows: [], rowCount: 0 };
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
  registerJuntasRoutes(app, { pool, verifyToken });

  const server = await new Promise((resolve) => {
    const started = app.listen(0, () => resolve(started));
  });
  const port = Number(server.address().port);

  try {
    await run(`http://127.0.0.1:${port}`, pool);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const tests = [
  {
    name: "DELETE /juntas-generales/miembros/:id bloquea eliminación con historial",
    run: async (baseUrl) => {
      const res = await fetch(`${baseUrl}/juntas-generales/miembros/20`, {
        method: "DELETE",
        headers: {
          "x-test-user-id": "101",
          "x-test-condominio-id": "1",
        },
      });
      const data = await res.json();
      assert.equal(res.status, 409);
      assert.equal(data.status, "error");
    },
  },
  {
    name: "POST /juntas-generales/aceptar-invitacion bloquea código expirado",
    run: async (baseUrl) => {
      const res = await fetch(`${baseUrl}/juntas-generales/aceptar-invitacion`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-test-user-id": "201",
          "x-test-condominio-id": "2",
        },
        body: JSON.stringify({ codigo_invitacion: "EXPIRED1" }),
      });
      const data = await res.json();
      assert.equal(res.status, 400);
      assert.equal(data.status, "error");
    },
  },
  {
    name: "POST /juntas-generales/aceptar-invitacion bloquea mismatch de RIF",
    run: async (baseUrl) => {
      const res = await fetch(`${baseUrl}/juntas-generales/aceptar-invitacion`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-test-user-id": "301",
          "x-test-condominio-id": "3",
        },
        body: JSON.stringify({ codigo_invitacion: "MISMATCH1" }),
      });
      const data = await res.json();
      assert.equal(res.status, 409);
      assert.equal(data.status, "error");
      assert.match(String(data.message || ""), /RIF/i);
    },
  },
  {
    name: "POST /juntas-generales/aceptar-invitacion vincula y crea proveedor Junta General",
    run: async (baseUrl, pool) => {
      const res = await fetch(`${baseUrl}/juntas-generales/aceptar-invitacion`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-test-user-id": "201",
          "x-test-condominio-id": "2",
        },
        body: JSON.stringify({ codigo_invitacion: "VALID123" }),
      });
      const data = await res.json();
      assert.equal(res.status, 200);
      assert.equal(data.status, "success");

      const state = pool.getState();
      const condo2 = state.condominios.get(2);
      assert.equal(condo2.junta_general_id, 1);
      assert.equal(state.proveedores.length, 1);
      assert.equal(state.proveedores[0].identificador, "J111111111");
    },
  },
];

async function main() {
  let failures = 0;
  await withServer(async (baseUrl, pool) => {
    for (const t of tests) {
      try {
        await t.run(baseUrl, pool);
        console.log(`PASS: ${t.name}`);
      } catch (error) {
        failures += 1;
        console.error(`FAIL: ${t.name}`);
        console.error(error);
      }
    }
  });

  if (failures > 0) {
    console.error(`\n${failures} prueba(s) de casos borde fallaron.`);
    process.exit(1);
  }

  console.log(`\nOK: ${tests.length} pruebas de casos borde pasaron.`);
}

main().catch((error) => {
  console.error("FAIL: ejecución suite casos borde");
  console.error(error);
  process.exit(1);
});
