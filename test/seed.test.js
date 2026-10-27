"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { generateSeed } = require("../scripts/seed-data");
const { validateMeasurement } = require("../src/validation");
test("produce 10 estaciones de Posadas con 72 mediciones sintéticas válidas cada una", () => {
  const docs = generateSeed(new Date("2026-10-27T15:42:00Z"));
  assert.equal(docs.length, 720);
  assert.equal(new Set(docs.map((doc) => doc.estacionId)).size, 10);
  assert.equal(new Set(docs.map((doc) => doc._id.toHexString())).size, 720);
  for (const doc of docs) {
    assert.equal(doc.origen, "simulado");
    assert.ok(doc.temperaturaC >= 16 && doc.temperaturaC <= 34);
    assert.ok(
      doc.ubicacion.coordinates[0] > -56.1 &&
        doc.ubicacion.coordinates[0] < -55.8,
    );
    assert.ok(
      doc.ubicacion.coordinates[1] > -27.5 &&
        doc.ubicacion.coordinates[1] < -27.3,
    );
    validateMeasurement({ ...doc, fecha: doc.fecha.toISOString() });
  }
});
test("los IDs permanecen estables aunque el seed se ejecute otro día", () => {
  const first = generateSeed(new Date("2026-10-27T15:00:00Z"));
  const second = generateSeed(new Date("2026-11-01T15:00:00Z"));
  assert.deepEqual(
    first.map((doc) => doc._id.toHexString()),
    second.map((doc) => doc._id.toHexString()),
  );
  assert.notEqual(first[0].fecha.getTime(), second[0].fecha.getTime());
});
