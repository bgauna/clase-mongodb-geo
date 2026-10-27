"use strict";
const { contextBridge, ipcRenderer } = require("electron");

// Un método por operación. El renderer no puede elegir canales ni ejecutar consultas arbitrarias.
contextBridge.exposeInMainWorld(
  "observatorio",
  Object.freeze({
    obtenerPanel: (filters) => ipcRenderer.invoke("panel:obtener", filters),
    obtenerMedicion: (id) => ipcRenderer.invoke("medicion:obtener", id),
    crearMedicion: (input) => ipcRenderer.invoke("medicion:crear", input),
    actualizarMedicion: (id, input) =>
      ipcRenderer.invoke("medicion:actualizar", id, input),
    eliminarMedicion: (id) => ipcRenderer.invoke("medicion:eliminar", id),
    buscarCercanas: (input) => ipcRenderer.invoke("geo:cercanas", input),
    verificarBase: () => ipcRenderer.invoke("base:verificar"),
  }),
);
