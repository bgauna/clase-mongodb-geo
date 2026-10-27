"use strict";
// Prueba de la aplicación real con su preload, protocolo y políticas de seguridad de producción.
const { app, BrowserWindow } = require("electron");
const { MongoClient } = require("mongodb");
const fs = require("node:fs/promises");
const path = require("node:path");
const assert = require("node:assert/strict");
const { URI } = require("../src/database");
const external = new MongoClient(URI);
const stationId = `E2E-${Date.now()}`;
const rendererErrors = [];
let window;
let collection;
app.on("web-contents-created", (_event, contents) => {
  contents.on("console-message", (details) => {
    if (
      details.level === "error" &&
      !/tile\.openstreetmap|ERR_INTERNET|ERR_NETWORK/.test(details.message)
    )
      rendererErrors.push(details.message);
  });
});
require("../src/main");
const pause = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));
async function evaluate(code) {
  return window.webContents.executeJavaScript(code, true);
}
async function waitFor(code, label, timeout = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await evaluate(code)) return;
    await pause(200);
  }
  throw new Error(`Tiempo de espera agotado: ${label}`);
}
async function screenshot(name) {
  // Esperar una composición evita capturar el frame anterior a un cambio de diálogo.
  await evaluate(
    "new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
  );
  await pause(250);
  const directory = path.resolve(__dirname, "../artifacts");
  await fs.mkdir(directory, { recursive: true });
  const image = await window.webContents.capturePage();
  await fs.writeFile(path.join(directory, name), image.toPNG());
}
app.whenReady().then(async () => {
  try {
    window = BrowserWindow.getAllWindows()[0];
    if (window.webContents.isLoadingMainFrame())
      await new Promise((resolve) =>
        window.webContents.once("did-finish-load", resolve),
      );
    await waitFor(
      `document.querySelector('#connection-status')?.textContent.includes('conectado')`,
      "conexión a MongoDB",
    );
    await evaluate(`document.querySelector('a[href="#map-section"]').click();`);
    const afterAnchor = await evaluate("window.observatorio.verificarBase()");
    assert.equal(afterAnchor.ok, true);
    assert.equal(await evaluate("typeof window.require"), "undefined");
    assert.equal(
      await evaluate("typeof window.observatorio.invoke"),
      "undefined",
    );
    const preferences = window.webContents.getLastWebPreferences();
    assert.equal(preferences.contextIsolation, true);
    assert.equal(preferences.nodeIntegration, false);
    assert.equal(preferences.sandbox, true);
    await external.connect();
    collection = external
      .db("observatorio_temperaturas")
      .collection("mediciones");
    const previousTotal = await collection.countDocuments();
    const now = new Date();
    const olderDate = new Date(now.getTime() - 1000);
    const base = {
      estacionId: stationId,
      estacion: "Estación de prueba Electron",
      barrio: "Ensayo temporal",
      fecha: olderDate,
      temperaturaC: 27.1,
      humedad: 60,
      ubicacion: { type: "Point", coordinates: [-55.903, -27.37] },
      contexto: { prueba: "temporal" },
      origen: "simulado",
    };
    const older = await collection.insertOne({ ...base });
    const latest = await collection.insertOne({
      ...base,
      fecha: now,
      temperaturaC: 31.4,
    });
    await waitFor(
      `document.querySelector('#record-count').textContent.replace(/\\D/g,'') === '${previousTotal + 2}'`,
      "inserción externa en el panel",
    );
    await evaluate(
      `document.querySelector('#filter-station').value = ${JSON.stringify(stationId)}; document.querySelector('#filter-form').requestSubmit();`,
    );
    await waitFor(
      `document.querySelector('#record-count').textContent === '2' && document.querySelector('#stat-max').textContent === '31,4'`,
      "filtros y agregación por estación",
    );
    // Zoom y centro mediante los controles públicos del mapa, sin exponer el objeto L.Map a la ventana.
    await evaluate(
      `document.querySelector('.leaflet-control-zoom-in').click();`,
    );
    const mapTransform = await evaluate(
      `document.querySelector('.leaflet-map-pane').style.transform`,
    );
    const zoomDisabled = await evaluate(
      `document.querySelector('.leaflet-control-zoom-in').className`,
    );
    await collection.updateOne(
      { _id: latest.insertedId },
      {
        $set: {
          temperaturaC: 40.2,
          estacion: '<img src=x onerror="window.__xss=true">',
        },
      },
    );
    await waitFor(
      `document.querySelector('#stat-max').textContent === '40,2' && document.querySelector('.marker-label')?.textContent === '40,2°'`,
      "update externo y marcador",
    );
    assert.equal(await evaluate("window.__xss"), undefined);
    assert.equal(
      await evaluate(`document.querySelector('#station-list img')`),
      null,
    );
    assert.equal(
      await evaluate(
        `document.querySelector('.leaflet-map-pane').style.transform`,
      ),
      mapTransform,
    );
    assert.equal(
      await evaluate(
        `document.querySelector('.leaflet-control-zoom-in').className`,
      ),
      zoomDisabled,
    );
    assert.ok(
      await evaluate(
        `document.querySelector('#chart svg').getAttribute('aria-label').startsWith('2 puntos')`,
      ),
    );
    assert.ok(
      await evaluate(
        `document.querySelector('.station-name').textContent.startsWith('<img')`,
      ),
    );
    await collection.deleteOne({ _id: latest.insertedId });
    await waitFor(
      `document.querySelector('#record-count').textContent === '1' && document.querySelector('.marker-label')?.textContent === '27,1°'`,
      "delete externo y regreso a la medición previa",
    );
    // Crear desde el formulario usa el puente real de Electron y el driver oficial.
    await evaluate(
      `document.querySelector('#new-measurement').click(); (() => { const f = document.querySelector('#measurement-form'); f.elements.temperaturaC.value = '29.8'; f.elements.humedad.value = '67'; f.requestSubmit(); })();`,
    );
    await waitFor(
      `!document.querySelector('#measurement-dialog').open && document.querySelector('#record-count').textContent === '2'`,
      "insertOne desde formulario",
    );
    const created = await collection.findOne({
      estacionId: stationId,
      _id: { $ne: older.insertedId },
    });
    assert.equal(created.temperaturaC, 29.8);
    await evaluate(
      `document.querySelector('#measurements-table .icon-button').click();`,
    );
    await waitFor(
      `document.querySelector('#measurement-dialog').open`,
      "apertura de edición",
    );
    await evaluate(
      `(() => { const f = document.querySelector('#measurement-form'); f.elements.temperaturaC.value='32.6'; f.elements.contexto.value='{"prueba":"editada"}'; f.requestSubmit(); })();`,
    );
    await waitFor(
      `!document.querySelector('#measurement-dialog').open && document.querySelector('#stat-max').textContent === '32,6'`,
      "updateOne desde formulario",
    );
    assert.equal(
      (await collection.findOne({ _id: created._id })).contexto.prueba,
      "editada",
    );
    await evaluate(
      `document.querySelector('#measurements-table .delete').click(); document.querySelector('#confirm-delete').click();`,
    );
    await waitFor(
      `!document.querySelector('#delete-dialog').open && document.querySelector('#record-count').textContent === '1'`,
      "deleteOne desde formulario",
    );
    const bad = await evaluate(
      `window.observatorio.crearMedicion({estacionId:{$ne:null}})`,
    );
    assert.equal(bad.ok, false);
    assert.equal(bad.error.code, "VALIDACION");
    const outsider = new BrowserWindow({
      show: false,
      webPreferences: {
        preload: path.resolve(__dirname, "../src/preload.js"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    await outsider.loadURL("observatorio://app/index.html");
    const rejected = await outsider.webContents.executeJavaScript(
      `window.observatorio.verificarBase()`,
    );
    assert.equal(rejected.error.code, "EMISOR");
    outsider.destroy();
    await evaluate(
      `document.querySelector('#near-map').click(); document.querySelector('#near-form').requestSubmit();`,
    );
    await waitFor(
      `document.querySelector('#near-status').textContent.includes('documentos ·')`,
      "búsqueda con $near",
    );
    await evaluate(
      `document.querySelector('#near-dialog .close-dialog').click(); document.querySelector('#inspect-db').click();`,
    );
    await waitFor(
      `document.querySelector('#inspect-result').textContent.includes('ubicacion_2dsphere')`,
      "índices reales",
    );
    await evaluate(
      `document.querySelector('#inspect-dialog .close-dialog').click();`,
    );
    await collection.deleteMany({ estacionId: stationId });
    await waitFor(
      `document.querySelector('#record-count').textContent === '0'`,
      "eliminación de toda una estación",
    );
    await evaluate(`document.querySelector('#reset-filters').click();`);
    await waitFor(
      `document.querySelector('#record-count').textContent.replace(/\\D/g,'') === '${previousTotal}'`,
      "restaurar filtros",
    );
    await pause(1200);
    await evaluate(
      `document.querySelector('#toast').hidden = true; document.querySelector('#fit-map').click(); window.scrollTo({top:0,behavior:'instant'});`,
    );
    await screenshot("observatorio-desktop.png");
    await evaluate(
      `document.querySelector('#map-section').scrollIntoView({behavior:'instant',block:'start'});`,
    );
    await screenshot("observatorio-mapa.png");
    await evaluate(
      `document.querySelector('.chart-panel').scrollIntoView({behavior:'instant',block:'start'});`,
    );
    await screenshot("observatorio-mediciones.png");
    await evaluate(
      `document.querySelector('#open-learning').click(); document.querySelector('[data-example="aggregate"]').click();`,
    );
    await screenshot("observatorio-aula.png");
    await evaluate(
      `document.querySelector('#learning-dialog .close-dialog').click();`,
    );
    window.setSize(1024, 850);
    await pause(400);
    await evaluate(`window.scrollTo({top:0,behavior:'instant'});`);
    await screenshot("observatorio-compacto.png");
    assert.equal(
      await evaluate(
        "document.documentElement.scrollWidth <= window.innerWidth",
      ),
      true,
    );
    assert.deepEqual(rendererErrors, []);
    console.log(
      "OK Electron: aislamiento, IPC autorizado, filtros, CRUD, polling externo insert/update/delete, XSS, mapa estable, gráfico, geografía, índices y diseño compacto.",
    );
    console.log(
      "Capturas: artifacts/observatorio-desktop.png, artifacts/observatorio-aula.png, artifacts/observatorio-compacto.png",
    );
  } catch (error) {
    console.error(error.stack);
    if (rendererErrors.length)
      console.error("Errores del renderer:", rendererErrors);
    if (window && !window.isDestroyed())
      await screenshot("electron-error.png").catch(() => {});
    process.exitCode = 1;
  } finally {
    if (collection)
      await collection.deleteMany({ estacionId: stationId }).catch(() => {});
    await external.close();
    app.exit(process.exitCode || 0);
  }
});
