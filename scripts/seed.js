"use strict";
const { Database } = require("../src/database");
const { generateSeed } = require("./seed-data");
async function main() {
  const database = new Database();
  try {
    await database.ready();
    const result = await database.collection.bulkWrite(
      generateSeed().map((document) => ({
        updateOne: {
          filter: { _id: document._id },
          update: { $setOnInsert: document },
          upsert: true,
        },
      })),
      { ordered: false },
    );
    console.log(
      `Seed sintético: ${result.upsertedCount} insertados; ${result.matchedCount} existentes conservados.`,
    );
    console.log(
      "10 estaciones aproximadas de Posadas · 72 mediciones por estación · origen: simulado.",
    );
    console.log(
      "No se sobrescribieron documentos existentes. El arranque de la app no ejecuta este script.",
    );
  } finally {
    await database.close();
  }
}
if (require.main === module)
  main().catch((error) => {
    console.error("No se pudo ejecutar el seed:", error.message);
    process.exitCode = 1;
  });
module.exports = { main };
