"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { MongoClient } = require("mongodb");
const { Database, URI } = require("../src/database");
const { generateSeed } = require("../scripts/seed-data");

test(
  "MongoDB standalone: CRUD, agregación, filtros, cambios externos, geografía y seed idempotente",
  { timeout: 30000 },
  async () => {
    const name = `observatorio_test_${process.pid}_${Date.now()}`;
    const database = new Database(name);
    const external = new MongoClient(URI);
    try {
      await database.ready();
      await external.connect();
      const collection = external.db(name).collection("mediciones");
      const indexes = await collection.listIndexes().toArray();
      assert.deepEqual(
        indexes.find((index) => index.name === "ubicacion_2dsphere").key,
        { ubicacion: "2dsphere" },
      );
      assert.deepEqual(
        indexes.find((index) => index.name === "estacion_fecha").key,
        { estacionId: 1, fecha: -1 },
      );
      const doc = {
        estacionId: "LAB-01",
        estacion: "Prueba",
        barrio: "Centro",
        fecha: "2026-10-27T12:00:00Z",
        temperaturaC: 25,
        humedad: 70,
        ubicacion: { type: "Point", coordinates: [-55.8944, -27.3667] },
        contexto: { ensayo: true },
      };
      const old = await database.insert(doc);
      const latest = await database.insert({
        ...doc,
        fecha: "2026-10-27T13:00:00Z",
        temperaturaC: 30,
      });
      let snapshot = await database.snapshot({});
      assert.equal(snapshot.estadisticas.total, 2);
      assert.equal(snapshot.estaciones.length, 1);
      assert.equal(snapshot.estaciones[0]._id, latest.id);
      assert.equal(snapshot.estadisticas.promedio, 27.5);
      assert.equal(snapshot.historia.length, 2);
      const version = snapshot.version;
      // Esta conexión independiente representa cambios hechos desde Compass, sin pasar por IPC.
      const { ObjectId } = require("mongodb");
      await collection.updateOne(
        { _id: new ObjectId(latest.id) },
        {
          $set: {
            temperaturaC: 35,
            "contexto.cambioExterno": true,
            campoExtra: "conservar",
          },
        },
      );
      snapshot = await database.snapshot({});
      assert.notEqual(snapshot.version, version);
      assert.equal(snapshot.estaciones[0].temperaturaC, 35);
      assert.equal(snapshot.estadisticas.maxima, 35);
      assert.equal(snapshot.recientes[0].temperaturaC, 35);
      assert.equal(snapshot.historia.at(-1).temperaturaC, 35);
      const filtered = await database.snapshot({
        estacionId: "LAB-01",
        min: 24,
        max: 26,
      });
      assert.equal(filtered.estaciones[0]._id, old.id);
      assert.equal(filtered.estadisticas.total, 1);
      assert.equal(
        (
          await database.snapshot({
            desde: "2026-10-27T12:00:00Z",
            hasta: "2026-10-27T13:00:00Z",
          })
        ).estadisticas.total,
        1,
      );
      assert.equal(
        (await database.snapshot({ barrio: "Otro" })).estadisticas.total,
        0,
      );
      assert.equal(
        (
          await database.near({
            longitud: -55.8944,
            latitud: -27.3667,
            radio: 100,
          })
        ).documentos.length,
        2,
      );
      assert.equal(
        (await database.near({ longitud: -56.1, latitud: -27.5, radio: 100 }))
          .documentos.length,
        0,
      );
      await database.update(latest.id, {
        ...doc,
        fecha: "2026-10-27T13:00:00Z",
        temperaturaC: 31,
        contexto: { reemplazado: true },
      });
      assert.equal(
        (await database.findById(latest.id)).campoExtra,
        "conservar",
      );
      await collection.deleteOne({ _id: new ObjectId(latest.id) });
      snapshot = await database.snapshot({});
      assert.equal(snapshot.estaciones[0]._id, old.id);
      assert.equal(snapshot.estadisticas.total, 1);
      await database.remove(old.id);
      snapshot = await database.snapshot({});
      assert.equal(snapshot.estaciones.length, 0);
      assert.equal(snapshot.estadisticas.promedio, null);
      assert.equal((await database.update(old.id, doc)).encontrado, false);
      assert.equal((await database.remove(old.id)).eliminado, false);
      await assert.rejects(
        collection.insertOne({ ...doc, fecha: "texto" }),
        (error) => error.code === 121,
      );

      const seed = generateSeed(new Date("2026-10-27T15:00:00Z"));
      const seedOperations = (docs) =>
        docs.map((item) => ({
          updateOne: {
            filter: { _id: item._id },
            update: { $setOnInsert: item },
            upsert: true,
          },
        }));
      await collection.bulkWrite(seedOperations(seed));
      await collection.updateOne(
        { _id: seed[0]._id },
        { $set: { temperaturaC: 42, "contexto.compass": true } },
      );
      const repeated = await collection.bulkWrite(
        seedOperations(generateSeed(new Date("2026-11-01T15:00:00Z"))),
      );
      assert.equal(repeated.upsertedCount, 0);
      assert.equal(await collection.countDocuments(), 720);
      assert.equal(
        (await collection.findOne({ _id: seed[0]._id })).temperaturaC,
        42,
      );
      assert.equal(
        (await collection.findOne({ _id: seed[0]._id })).fecha.getTime(),
        seed[0].fecha.getTime(),
      );
      const anotherConnection = new Database(name);
      await collection.deleteOne({ _id: seed[1]._id });
      try {
        await anotherConnection.ready();
        assert.equal(await collection.countDocuments(), 719);
      } finally {
        await anotherConnection.close();
      }
    } finally {
      // Sólo se borra la base temporal cuyo nombre se construyó en esta prueba.
      assert.match(name, /^observatorio_test_\d+_\d+$/);
      await external
        .db(name)
        .dropDatabase()
        .catch(() => {});
      await external.close();
      await database.close();
    }
  },
);
