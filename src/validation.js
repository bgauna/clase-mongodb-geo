"use strict";

// Este módulo se ejecuta en Node.js. Nunca aceptamos filtros MongoDB enviados por el renderer.
class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "ValidationError";
  }
}
const fail = (message) => {
  throw new ValidationError(message);
};
function object(value, label = "Datos") {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  )
    fail(`${label}: se esperaba un objeto.`);
  return value;
}
function text(value, label, max = 90) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.trim().length > max ||
    /[\x00-\x1f]/.test(value)
  )
    fail(`${label}: ingresá entre 1 y ${max} caracteres válidos.`);
  return value.trim();
}
function number(value, label, min, max) {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < min ||
    value > max
  )
    fail(`${label}: ingresá un número entre ${min} y ${max}.`);
  return value;
}
function date(value) {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.test(
      value,
    )
  )
    fail("La fecha debe ser ISO 8601 con zona horaria.");
  const [year, month, day, hour, minute, second] = value
    .slice(0, 19)
    .split(/[-T:]/)
    .map(Number);
  const calendar = new Date(Date.UTC(year, month - 1, day));
  if (
    calendar.getUTCFullYear() !== year ||
    calendar.getUTCMonth() !== month - 1 ||
    calendar.getUTCDate() !== day ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  )
    fail("Ingresá una fecha y hora válidas.");
  const result = new Date(value);
  if (
    !Number.isFinite(result.getTime()) ||
    result.getUTCFullYear() < 2000 ||
    result.getUTCFullYear() > 2100
  )
    fail("La fecha debe estar entre los años 2000 y 2100.");
  return result;
}
function context(value, depth = 0) {
  if (depth > 5) fail("Contexto: como máximo 5 niveles de anidamiento.");
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (value.length > 1000) fail("Contexto: texto demasiado largo.");
    return value;
  }
  if (typeof value === "number") return number(value, "Contexto", -1e12, 1e12);
  if (Array.isArray(value)) {
    if (value.length > 50)
      fail("Contexto: como máximo 50 elementos por lista.");
    return value.map((item) => context(item, depth + 1));
  }
  object(value, "Contexto");
  if (Object.keys(value).length > 50) fail("Contexto: demasiados atributos.");
  const result = {};
  for (const [key, entry] of Object.entries(value)) {
    if (
      !key ||
      key.length > 80 ||
      /[.$\x00]/.test(key) ||
      ["__proto__", "constructor", "prototype"].includes(key)
    )
      fail(
        "Contexto: una clave no es válida. No uses puntos, $, ni claves de prototipo.",
      );
    result[key] = context(entry, depth + 1);
  }
  return result;
}
function validateMeasurement(input) {
  object(input);
  const estacionId = text(input.estacionId, "ID de estación", 32);
  if (!/^[a-zA-Z0-9_-]+$/.test(estacionId))
    fail("ID de estación: usá letras, números, guiones o guiones bajos.");
  object(input.ubicacion, "Ubicación");
  const coordinates = input.ubicacion.coordinates;
  if (
    input.ubicacion.type !== "Point" ||
    !Array.isArray(coordinates) ||
    coordinates.length !== 2
  )
    fail("Ubicación: usá GeoJSON Point con [longitud, latitud].");
  const longitude = number(coordinates[0], "Longitud", -180, 180);
  const latitude = number(coordinates[1], "Latitud", -90, 90);
  const contexto = context(object(input.contexto, "Contexto"));
  if (Buffer.byteLength(JSON.stringify(contexto), "utf8") > 8192)
    fail("Contexto: el límite es 8 KB.");
  return {
    estacionId,
    estacion: text(input.estacion, "Estación"),
    barrio: text(input.barrio, "Barrio"),
    fecha: date(input.fecha),
    temperaturaC: number(input.temperaturaC, "Temperatura", -30, 60),
    humedad: number(input.humedad, "Humedad", 0, 100),
    ubicacion: { type: "Point", coordinates: [longitude, latitude] },
    contexto,
    // Las altas desde este laboratorio son siempre ejercicios sintéticos.
    origen: "simulado",
  };
}
function validateId(id) {
  if (typeof id !== "string" || !/^[a-f\d]{24}$/i.test(id))
    fail("Identificador de documento inválido.");
  return id;
}
function validateFilters(input = {}) {
  object(input, "Filtros");
  const output = {};
  for (const key of ["estacionId", "barrio"])
    if (input[key] !== undefined && input[key] !== "")
      output[key] = text(input[key], key, key === "estacionId" ? 32 : 90);
  for (const key of ["desde", "hasta"])
    if (input[key]) output[key] = date(input[key]);
  for (const key of ["min", "max"])
    if (input[key] !== undefined && input[key] !== null && input[key] !== "")
      output[key] = number(input[key], "Rango térmico", -30, 60);
  if (output.desde && output.hasta && output.desde >= output.hasta)
    fail("La fecha inicial debe ser anterior a la final.");
  if (
    output.min !== undefined &&
    output.max !== undefined &&
    output.min > output.max
  )
    fail("El mínimo térmico no puede superar al máximo.");
  output.pagina =
    input.pagina === undefined ? 1 : number(input.pagina, "Página", 1, 1000000);
  if (!Number.isInteger(output.pagina)) fail("La página debe ser entera.");
  return output;
}
function validateNear(input) {
  object(input);
  return {
    longitud: number(input.longitud, "Longitud", -180, 180),
    latitud: number(input.latitud, "Latitud", -90, 90),
    radio: number(input.radio, "Radio en metros", 50, 20000),
  };
}
module.exports = {
  ValidationError,
  validateMeasurement,
  validateFilters,
  validateId,
  validateNear,
};
