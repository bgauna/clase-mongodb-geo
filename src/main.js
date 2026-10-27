"use strict";
const { app, BrowserWindow, ipcMain, protocol, session } = require("electron");
const path = require("node:path");
const fs = require("node:fs/promises");
const { Database } = require("./database");

const APP_URL = "observatorio://app/index.html";
const RENDERER_ROOT = path.join(__dirname, "renderer");
protocol.registerSchemesAsPrivileged([
  {
    scheme: "observatorio",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
]);
let window;
const database = new Database();
let reading = false;

function validateSender(event) {
  // Se exige el WebContents y frame principal exactos de nuestra única ventana local.
  if (
    !window ||
    window.isDestroyed() ||
    event.sender !== window.webContents ||
    event.senderFrame !== window.webContents.mainFrame ||
    event.senderFrame.url.split("#")[0] !== APP_URL
  )
    throw new Error("UNTRUSTED_SENDER");
}
function publicError(error) {
  if (error.name === "ValidationError")
    return { code: "VALIDACION", message: error.message };
  if (error.message === "UNTRUSTED_SENDER")
    return { code: "EMISOR", message: "Emisor de IPC no autorizado." };
  if (error.code === 121)
    return {
      code: "DOCUMENTO",
      message: "MongoDB rechazó el documento: revisá los campos y sus tipos.",
    };
  if (error.code === 16755 || /geo.*key|geo.*index/i.test(error.message))
    return {
      code: "INDICE",
      message:
        "Revisá en Compass las coordenadas GeoJSON y el índice 2dsphere.",
    };
  if (error.code === 50 || /time.*out|exceeded time/i.test(error.message))
    return {
      code: "TIEMPO",
      message: "La consulta tardó demasiado. Se reintentará automáticamente.",
    };
  return {
    code: "CONEXION",
    message:
      "No se pudo consultar MongoDB local. Verificá que el servicio MongoDB esté iniciado en 127.0.0.1:27017.",
  };
}
function handle(channel, operation) {
  ipcMain.handle(channel, async (event, ...args) => {
    try {
      validateSender(event);
      return { ok: true, data: await operation(...args) };
    } catch (error) {
      return { ok: false, error: publicError(error) };
    }
  });
}
function registerIPC() {
  handle("panel:obtener", async (filters) => {
    if (reading) return { ocupado: true };
    reading = true;
    try {
      return await database.snapshot(filters);
    } finally {
      reading = false;
    }
  });
  handle("medicion:obtener", (id) => database.findById(id));
  handle("medicion:crear", (input) => database.insert(input));
  handle("medicion:actualizar", (id, input) => database.update(id, input));
  handle("medicion:eliminar", (id) => database.remove(id));
  handle("geo:cercanas", (input) => database.near(input));
  handle("base:verificar", () => database.inspect());
}
async function createWindow() {
  window = new BrowserWindow({
    title: "Observatorio de Temperaturas Urbanas",
    width: 1510,
    height: 1030,
    minWidth: 1000,
    minHeight: 740,
    backgroundColor: "#f4f6f8",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      backgroundThrottling: false,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.webContents.on("will-attach-webview", (event) =>
    event.preventDefault(),
  );
  await window.loadURL(APP_URL);
}
app
  .whenReady()
  .then(async () => {
    protocol.handle("observatorio", async (request) => {
      const url = new URL(request.url);
      if (request.method !== "GET" || url.hostname !== "app")
        return new Response("Prohibido", { status: 403 });
      let filename;
      try {
        filename = path.resolve(
          RENDERER_ROOT,
          "." + decodeURIComponent(url.pathname),
        );
      } catch {
        return new Response("Ruta inválida", { status: 400 });
      }
      if (!filename.startsWith(RENDERER_ROOT + path.sep))
        return new Response("Prohibido", { status: 403 });
      const types = {
        ".html": "text/html; charset=utf-8",
        ".js": "text/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".png": "image/png",
        ".svg": "image/svg+xml",
      };
      const type = types[path.extname(filename)];
      if (!type) return new Response("Prohibido", { status: 403 });
      try {
        return new Response(await fs.readFile(filename), {
          headers: {
            "Content-Type": type,
            "X-Content-Type-Options": "nosniff",
          },
        });
      } catch {
        return new Response("Archivo no encontrado", { status: 404 });
      }
    });
    session.defaultSession.setPermissionRequestHandler(
      (_webContents, _permission, callback) => callback(false),
    );
    session.defaultSession.setPermissionCheckHandler(() => false);
    // Ni siquiera una imagen puede contactar otro destino distinto de las teselas autorizadas.
    session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
      const allowed =
        details.url.startsWith("observatorio://app/") ||
        (details.resourceType === "image" &&
          /^https:\/\/tile\.openstreetmap\.org\/\d+\/\d+\/\d+\.png$/.test(
            details.url,
          ));
      callback({ cancel: !allowed });
    });
    registerIPC();
    await createWindow();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  })
  .catch((error) => {
    console.error("No se pudo iniciar el observatorio:", error.message);
    app.quit();
  });
app.on("window-all-closed", () => app.quit());
app.on("before-quit", () => {
  database.close().catch(() => {});
});
