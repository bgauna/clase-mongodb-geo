"use strict";
const { ObjectId } = require("mongodb");
// Coordenadas aproximadas para enseñanza, no ubicaciones de sensores reales.
const STATIONS = [
  ["POS-01", "Costanera", "Villa Sarita", -55.8955, -27.3537, -0.8],
  ["POS-02", "Plaza 9 de Julio", "Centro", -55.8944, -27.3667, 1.5],
  ["POS-03", "Parque Paraguayo", "Villa Sarita", -55.899, -27.3558, -1.1],
  ["POS-04", "Villa Cabello", "Villa Cabello", -55.934, -27.3637, 0.2],
  ["POS-05", "Jardín Botánico", "El Laurel", -55.909, -27.418, -2.0],
  ["POS-06", "Itaembé Miní", "Itaembé Miní", -55.958, -27.43, 0.6],
  ["POS-07", "Villa Urquiza", "Villa Urquiza", -55.89, -27.386, 0.8],
  ["POS-08", "Miguel Lanús", "Miguel Lanús", -55.8995, -27.434, -0.3],
  ["POS-09", "El Brete", "El Brete", -55.914, -27.354, -1.4],
  ["POS-10", "Itaembé Guazú", "Itaembé Guazú", -56.001, -27.419, 0.4],
];
function generateSeed(now = new Date()) {
  const end = new Date(now);
  end.setUTCMinutes(0, 0, 0);
  const documents = [];
  STATIONS.forEach(
    ([estacionId, estacion, barrio, lng, lat, offset], stationIndex) => {
      for (let hour = 0; hour < 72; hour++) {
        const fecha = new Date(end.getTime() - (71 - hour) * 3600000);
        const localHour = (fecha.getUTCHours() + 21) % 24;
        const temperaturaC =
          Math.round(
            (25 +
              5.5 * Math.sin(((localHour - 9) * Math.PI) / 12) +
              offset +
              Math.sin(hour * 1.7 + stationIndex) * 0.5) *
              10,
          ) / 10;
        const humedad = Math.round(
          Math.max(
            40,
            Math.min(95, 77 - (temperaturaC - 23) * 2 + (stationIndex % 4)),
          ),
        );
        // IDs estables independientes del día: volver a ejecutar nunca pisa un documento ya existente.
        const _id = new ObjectId(
          `0b5e0001${stationIndex.toString(16).padStart(8, "0")}${hour.toString(16).padStart(8, "0")}`,
        );
        const contexto =
          stationIndex % 3 === 0
            ? {
                entorno: "ribera",
                sombra: true,
                vientoKmh: 8 + stationIndex,
                nota: "Serie sintética para práctica universitaria.",
              }
            : stationIndex % 3 === 1
              ? {
                  entorno: "urbano",
                  superficie: "asfalto",
                  trafico: "moderado",
                  nota: "Serie sintética para práctica universitaria.",
                }
              : {
                  entorno: "vegetación",
                  coberturaVerde: 0.72,
                  sensor: { modelo: "SIM-01", virtual: true },
                  nota: "Serie sintética para práctica universitaria.",
                };
        documents.push({
          _id,
          estacionId,
          estacion,
          barrio,
          fecha,
          temperaturaC,
          humedad,
          ubicacion: { type: "Point", coordinates: [lng, lat] },
          contexto,
          origen: "simulado",
        });
      }
    },
  );
  return documents;
}
module.exports = { STATIONS, generateSeed };
