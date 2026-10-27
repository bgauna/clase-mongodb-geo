"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  validateMeasurement,
  validateFilters,
  validateNear,
  validateId,
} = require("../src/validation");
function measurement() {
  return {
    estacionId: "TEST-01",
    estacion: "<img src=x onerror=alert(1)>",
    barrio: "Centro",
    fecha: "2026-10-27T12:00:00-03:00",
    temperaturaC: 29.5,
    humedad: 61,
    ubicacion: { type: "Point", coordinates: [-55.8944, -27.3667] },
    contexto: {
      sensor: { virtual: true },
      materiales: ["asfalto", "hormigón"],
    },
  };
}
test("convierte fecha a BSON Date y conserva el contexto variable y texto literal", () => {
  const result = validateMeasurement(measurement());
  assert.ok(result.fecha instanceof Date);
  assert.equal(result.fecha.toISOString(), "2026-10-27T15:00:00.000Z");
  assert.equal(result.origen, "simulado");
  assert.equal(result.contexto.sensor.virtual, true);
  assert.equal(result.estacion, "<img src=x onerror=alert(1)>");
});
test("rechaza operadores en filtros, tipos incorrectos y coordenadas inválidas", () => {
  assert.throws(() => validateFilters({ barrio: { $ne: null } }));
  assert.throws(() =>
    validateMeasurement({ ...measurement(), temperaturaC: "29" }),
  );
  assert.throws(() => validateMeasurement({ ...measurement(), humedad: 101 }));
  assert.throws(() =>
    validateMeasurement({
      ...measurement(),
      ubicacion: { type: "Point", coordinates: [181, -27] },
    }),
  );
  assert.throws(() =>
    validateMeasurement({
      ...measurement(),
      ubicacion: { type: "LineString", coordinates: [55, 27] },
    }),
  );
  assert.throws(() =>
    validateMeasurement({ ...measurement(), fecha: "2026-10-27" }),
  );
  assert.throws(() =>
    validateMeasurement({ ...measurement(), fecha: "2026-02-30T12:00:00Z" }),
  );
  assert.throws(() =>
    validateNear({ longitud: -55, latitud: NaN, radio: 1000 }),
  );
  assert.throws(() => validateId("{$ne:null}"));
});
test("rechaza contaminación de prototipos, claves MongoDB y contexto excesivo", () => {
  for (const contexto of [
    JSON.parse('{"__proto__":{"admin":true}}'),
    { $where: "code" },
    { "sensor.id": 3 },
    { texto: "x".repeat(1001) },
    { a: { b: { c: { d: { e: { f: {} } } } } } },
  ])
    assert.throws(() => validateMeasurement({ ...measurement(), contexto }));
});
test("valida rangos térmicos, fechas y paginación sin aceptar filtros arbitrarios", () => {
  const result = validateFilters({
    estacionId: "POS-01",
    min: 24,
    max: 32,
    desde: "2026-10-25T00:00:00-03:00",
    hasta: "2026-10-28T00:00:00-03:00",
    $where: "arbitrary",
  });
  assert.equal(result.pagina, 1);
  assert.equal(result.$where, undefined);
  assert.ok(result.desde instanceof Date);
  assert.throws(() => validateFilters({ min: 30, max: 20 }));
  assert.throws(() => validateFilters({ pagina: 1.5 }));
  assert.throws(() =>
    validateFilters({
      desde: "2026-10-28T00:00:00Z",
      hasta: "2026-10-27T00:00:00Z",
    }),
  );
});
