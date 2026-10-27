"use strict";
const { MongoClient, ObjectId } = require("mongodb");
const { createHash } = require("node:crypto");
const {
  validateMeasurement,
  validateFilters,
  validateId,
  validateNear,
} = require("./validation");

const URI = "mongodb://127.0.0.1:27017";
const DB_NAME = "observatorio_temperaturas";
const PAGE_SIZE = 10;
const SCHEMA = {
  bsonType: "object",
  required: [
    "estacionId",
    "estacion",
    "barrio",
    "fecha",
    "temperaturaC",
    "humedad",
    "ubicacion",
    "contexto",
    "origen",
  ],
  properties: {
    estacionId: { bsonType: "string", minLength: 1, maxLength: 32 },
    estacion: { bsonType: "string", minLength: 1, maxLength: 90 },
    barrio: { bsonType: "string", minLength: 1, maxLength: 90 },
    fecha: { bsonType: "date" },
    temperaturaC: {
      bsonType: ["double", "int", "long", "decimal"],
      minimum: -30,
      maximum: 60,
    },
    humedad: {
      bsonType: ["double", "int", "long", "decimal"],
      minimum: 0,
      maximum: 100,
    },
    ubicacion: {
      bsonType: "object",
      required: ["type", "coordinates"],
      properties: {
        type: { enum: ["Point"] },
        coordinates: {
          bsonType: "array",
          minItems: 2,
          maxItems: 2,
          items: { bsonType: ["double", "int", "long", "decimal"] },
        },
      },
    },
    contexto: { bsonType: "object" },
    origen: { bsonType: "string", minLength: 1 },
  },
};

function buildMatch(filters) {
  const match = {};
  for (const field of ["estacionId", "barrio"])
    if (filters[field]) match[field] = filters[field];
  if (filters.desde || filters.hasta) {
    match.fecha = {};
    if (filters.desde) match.fecha.$gte = filters.desde;
    if (filters.hasta) match.fecha.$lt = filters.hasta;
  }
  if (filters.min !== undefined || filters.max !== undefined) {
    match.temperaturaC = {};
    if (filters.min !== undefined) match.temperaturaC.$gte = filters.min;
    if (filters.max !== undefined) match.temperaturaC.$lte = filters.max;
  }
  return match;
}
// Cada marcador se obtiene en MongoDB: ordenar -> agrupar por estación -> tomar el primero.
const latestStages = () => [
  { $sort: { estacionId: 1, fecha: -1, _id: -1 } },
  { $group: { _id: "$estacionId", medicion: { $first: "$$ROOT" } } },
  { $replaceRoot: { newRoot: "$medicion" } },
  { $sort: { estacion: 1, estacionId: 1 } },
];
function buildSnapshotPipeline(filters) {
  const match = { $match: buildMatch(filters) };
  return [
    {
      $facet: {
        catalogo: [
          ...latestStages(),
          { $project: { estacionId: 1, estacion: 1, barrio: 1, ubicacion: 1 } },
        ],
        estaciones: [match, ...latestStages()],
        estadisticas: [
          match,
          {
            $group: {
              _id: null,
              total: { $sum: 1 },
              maxima: { $max: "$temperaturaC" },
              minima: { $min: "$temperaturaC" },
              promedio: { $avg: "$temperaturaC" },
              sinteticas: {
                $sum: { $cond: [{ $eq: ["$origen", "simulado"] }, 1, 0] },
              },
            },
          },
        ],
        recientes: [
          match,
          { $sort: { fecha: -1, _id: -1 } },
          { $skip: (filters.pagina - 1) * PAGE_SIZE },
          { $limit: PAGE_SIZE },
        ],
        // Por estación: cada medición. Todas las estaciones: promedio por hora.
        historia: [
          match,
          ...(filters.estacionId
            ? [
                { $sort: { fecha: -1, _id: -1 } },
                { $limit: 480 },
                { $sort: { fecha: 1, _id: 1 } },
                { $project: { fecha: 1, temperaturaC: 1 } },
              ]
            : [
                {
                  $group: {
                    _id: {
                      $dateTrunc: {
                        date: "$fecha",
                        unit: "hour",
                        timezone: "America/Argentina/Buenos_Aires",
                      },
                    },
                    temperaturaC: { $avg: "$temperaturaC" },
                    cantidad: { $sum: 1 },
                  },
                },
                { $sort: { _id: -1 } },
                { $limit: 480 },
                { $sort: { _id: 1 } },
                {
                  $project: {
                    _id: 0,
                    fecha: "$_id",
                    temperaturaC: 1,
                    cantidad: 1,
                  },
                },
              ]),
        ],
      },
    },
  ];
}
function dto(doc) {
  if (!doc) return null;
  const normalized = { ...doc };
  // Compass permite varios tipos numéricos BSON; los controles reciben números de JavaScript.
  for (const key of ["temperaturaC", "humedad"])
    if (normalized[key] !== undefined)
      normalized[key] = Number(normalized[key].toString());
  if (doc.ubicacion?.coordinates)
    normalized.ubicacion = {
      ...doc.ubicacion,
      coordinates: doc.ubicacion.coordinates.map((value) =>
        Number(value.toString()),
      ),
    };
  // El renderer recibe objetos simples, nunca instancias del driver ni BSON ejecutable.
  return JSON.parse(
    JSON.stringify({
      ...normalized,
      _id: doc._id?.toString(),
      fecha: doc.fecha instanceof Date ? doc.fecha.toISOString() : doc.fecha,
    }),
  );
}
class Database {
  constructor(name = DB_NAME) {
    this.client = new MongoClient(URI, {
      serverSelectionTimeoutMS: 1500,
      connectTimeoutMS: 1500,
      maxPoolSize: 5,
      timeoutMS: 7000,
      appName: "ObservatorioTemperaturas",
    });
    this.db = this.client.db(name);
    this.collection = this.db.collection("mediciones");
    this.initializing = null;
  }
  async ready() {
    if (!this.initializing) {
      this.initializing = this.initialize().catch((error) => {
        this.initializing = null;
        throw error;
      });
    }
    return this.initializing;
  }
  async initialize() {
    await this.client.connect();
    try {
      await this.db.createCollection("mediciones", {
        validator: { $jsonSchema: SCHEMA },
        validationLevel: "strict",
        validationAction: "error",
      });
    } catch (error) {
      if (error.code !== 48) throw error;
    }
    // Sólo se crean índices; el arranque jamás inserta, reemplaza ni repone mediciones.
    await this.collection.createIndexes([
      { key: { ubicacion: "2dsphere" }, name: "ubicacion_2dsphere" },
      { key: { estacionId: 1, fecha: -1 }, name: "estacion_fecha" },
    ]);
  }
  async snapshot(input) {
    const filters = validateFilters(input);
    await this.ready();
    const [result] = await this.collection
      .aggregate(buildSnapshotPipeline(filters), {
        maxTimeMS: 5000,
        allowDiskUse: true,
      })
      .toArray();
    const panel = result;
    const stats = panel.estadisticas[0];
    if (stats)
      for (const field of [
        "total",
        "maxima",
        "minima",
        "promedio",
        "sinteticas",
      ])
        stats[field] = Number(stats[field].toString());
    const snapshot = {
      catalogo: result.catalogo.map(dto),
      estaciones: panel.estaciones.map(dto),
      estadisticas: stats
        ? { ...stats, _id: undefined }
        : {
            total: 0,
            maxima: null,
            minima: null,
            promedio: null,
            sinteticas: 0,
          },
      recientes: panel.recientes.map(dto),
      historia: panel.historia.map(dto),
      pagina: filters.pagina,
      porPagina: PAGE_SIZE,
      limiteHistoria: 480,
    };
    // No se usa count como detector: el hash incluye valores y documentos, por lo que detecta updates y deletes.
    const version = createHash("sha256")
      .update(JSON.stringify(snapshot))
      .digest("hex");
    return { ...snapshot, version, consultadoEn: new Date().toISOString() };
  }
  async findById(id) {
    const _id = new ObjectId(validateId(id));
    await this.ready();
    return dto(await this.collection.findOne({ _id }));
  }
  async insert(input) {
    const document = validateMeasurement(input);
    await this.ready();
    const result = await this.collection.insertOne(document);
    return { id: result.insertedId.toHexString() };
  }
  async update(id, input) {
    const _id = new ObjectId(validateId(id));
    const document = validateMeasurement(input);
    await this.ready();
    // $set conserva campos adicionales que alguien haya agregado desde Compass.
    const result = await this.collection.updateOne({ _id }, { $set: document });
    return {
      encontrado: result.matchedCount === 1,
      modificado: result.modifiedCount === 1,
    };
  }
  async remove(id) {
    const _id = new ObjectId(validateId(id));
    await this.ready();
    return {
      eliminado: (await this.collection.deleteOne({ _id })).deletedCount === 1,
    };
  }
  async near(input) {
    const { longitud, latitud, radio } = validateNear(input);
    await this.ready();
    // $near pertenece a find (no a $match en aggregate). Distancias en metros y orden por cercanía.
    const rows = await this.collection
      .find({
        ubicacion: {
          $near: {
            $geometry: { type: "Point", coordinates: [longitud, latitud] },
            $maxDistance: radio,
          },
        },
      })
      .limit(101)
      .toArray();
    return {
      documentos: rows.slice(0, 100).map(dto),
      limitado: rows.length > 100,
    };
  }
  async inspect() {
    await this.ready();
    const indexes = await this.collection.listIndexes().toArray();
    return {
      base: DB_NAME,
      coleccion: "mediciones",
      documentos: await this.collection.countDocuments(),
      indices: indexes.map((index) => ({
        nombre: index.name,
        clave: index.key,
      })),
    };
  }
  async close() {
    await this.client.close();
  }
}
module.exports = {
  Database,
  URI,
  DB_NAME,
  SCHEMA,
  PAGE_SIZE,
  latestStages,
  buildMatch,
  buildSnapshotPipeline,
};
