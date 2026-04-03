const assert = require("node:assert/strict");

const {
  normalizeRif,
  isJuntaGeneralTipo,
  isJuntaIndividualTipo,
  resolveMetodoDivisionAutomatico,
} = require("../services/juntaGeneral.ts");

const tests = [
  {
    name: "normalizeRif conserva prefijo y numeros",
    run: () => {
      assert.equal(normalizeRif("j-98.765.432-1"), "J987654321");
      assert.equal(normalizeRif("  V-18.143.262 "), "V18143262");
      assert.equal(normalizeRif(""), "");
    },
  },
  {
    name: "isJuntaGeneralTipo detecta junta general",
    run: () => {
      assert.equal(isJuntaGeneralTipo("Junta General"), true);
      assert.equal(isJuntaGeneralTipo("  junta general "), true);
      assert.equal(isJuntaGeneralTipo("Junta Individual"), false);
    },
  },
  {
    name: "isJuntaIndividualTipo detecta junta individual",
    run: () => {
      assert.equal(isJuntaIndividualTipo("Junta Individual"), true);
      assert.equal(isJuntaIndividualTipo(" junta individual "), true);
      assert.equal(isJuntaIndividualTipo("Junta General"), false);
    },
  },
  {
    name: "resolveMetodoDivisionAutomatico usa Alicuota con cuotas distintas",
    run: () => {
      const result = resolveMetodoDivisionAutomatico([20, 30, 50], "Partes Iguales");
      assert.equal(result, "Alicuota");
    },
  },
  {
    name: "resolveMetodoDivisionAutomatico usa Partes Iguales con cuotas iguales",
    run: () => {
      const result = resolveMetodoDivisionAutomatico([25, 25, 25, 25], "Alicuota");
      assert.equal(result, "Partes Iguales");
    },
  },
  {
    name: "resolveMetodoDivisionAutomatico respeta metodo actual si no hay cuotas",
    run: () => {
      assert.equal(resolveMetodoDivisionAutomatico([], "Partes Iguales"), "Partes Iguales");
      assert.equal(resolveMetodoDivisionAutomatico([], "Alicuota"), "Alicuota");
      assert.equal(resolveMetodoDivisionAutomatico([], null), "Alicuota");
    },
  },
];

let failures = 0;

for (const unit of tests) {
  try {
    unit.run();
    console.log(`PASS: ${unit.name}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL: ${unit.name}`);
    console.error(error);
  }
}

if (failures > 0) {
  console.error(`\n${failures} prueba(s) fallaron.`);
  process.exit(1);
}

console.log(`\nOK: ${tests.length} pruebas unitarias pasaron.`);
