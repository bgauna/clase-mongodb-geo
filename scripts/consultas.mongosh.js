// Ejecutar con mongosh; este archivo sólo lee datos, no inserta ni elimina documentos.
// mongosh "mongodb://127.0.0.1:27017" --file scripts/consultas.mongosh.js
db = db.getSiblingDB("observatorio_temperaturas");
print("\n1. Documentos recientes de POS-01 (find + sort)");
printjson(
  db.mediciones
    .find({ estacionId: "POS-01" })
    .sort({ fecha: -1, _id: -1 })
    .limit(3)
    .toArray(),
);
print("\n2. Última medición sintética por estación (aggregate)");
printjson(
  db.mediciones
    .aggregate([
      { $match: { origen: "simulado" } },
      { $sort: { estacionId: 1, fecha: -1, _id: -1 } },
      { $group: { _id: "$estacionId", medicion: { $first: "$$ROOT" } } },
      { $replaceRoot: { newRoot: "$medicion" } },
      { $sort: { estacion: 1, estacionId: 1 } },
    ])
    .toArray(),
);
print("\n3. Documentos dentro de 1500 m de Plaza 9 de Julio ($near)");
printjson(
  db.mediciones
    .find({
      ubicacion: {
        $near: {
          $geometry: { type: "Point", coordinates: [-55.8944, -27.3667] },
          $maxDistance: 1500,
        },
      },
    })
    .limit(3)
    .toArray(),
);
print("\n4. Conteos y tipo BSON Date");
printjson({
  total: db.mediciones.countDocuments(),
  sinteticas: db.mediciones.countDocuments({ origen: "simulado" }),
  fechasBsonDate: db.mediciones.countDocuments({ fecha: { $type: "date" } }),
});
print("\n5. Índices (2dsphere y estación/fecha)");
printjson(db.mediciones.getIndexes());
