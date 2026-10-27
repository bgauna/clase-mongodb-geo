"use strict";
(() => {
  const $ = (selector) => document.querySelector(selector);
  const api = window.observatorio;
  const TIMEZONE = "America/Argentina/Buenos_Aires";
  const dateFormat = new Intl.DateTimeFormat("es-AR", {
    timeZone: TIMEZONE,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const timeFormat = new Intl.DateTimeFormat("es-AR", {
    timeZone: TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const shortFormat = new Intl.DateTimeFormat("es-AR", {
    timeZone: TIMEZONE,
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const numberFormat = new Intl.NumberFormat("es-AR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
  const state = {
    busy: false,
    queued: false,
    revision: 0,
    filters: { pagina: 1 },
    snapshot: null,
    version: null,
    catalog: [],
    markers: new Map(),
    fitted: false,
    editing: null,
    deleting: null,
    timer: null,
  };
  let map;
  let toastTimer;

  function el(tag, classes, content) {
    const node = document.createElement(tag);
    if (classes) node.className = classes;
    if (content !== undefined) node.textContent = content;
    return node;
  }
  function icon(name) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "icon");
    svg.setAttribute("aria-hidden", "true");
    const use = document.createElementNS(svg.namespaceURI, "use");
    use.setAttribute("href", `#i-${name}`);
    svg.append(use);
    return svg;
  }
  function temp(value) {
    return Number.isFinite(Number(value)) && value !== null
      ? numberFormat.format(Number(value))
      : "—";
  }
  function formatDate(value, formatter = dateFormat) {
    const date = new Date(value);
    return Number.isFinite(date.getTime())
      ? formatter.format(date)
      : "Fecha inválida";
  }
  function color(value) {
    return value < 22
      ? "#51a69b"
      : value < 28
        ? "#c8a64e"
        : value < 32
          ? "#e38c53"
          : "#d96659";
  }
  function toast(message, error = false) {
    clearTimeout(toastTimer);
    $("#toast").textContent = message;
    $("#toast").classList.toggle("error", error);
    $("#toast").hidden = false;
    toastTimer = setTimeout(() => {
      $("#toast").hidden = true;
    }, 4500);
  }
  async function call(promise) {
    const result = await promise;
    if (!result.ok) {
      const error = new Error(result.error.message);
      error.code = result.error.code;
      throw error;
    }
    return result.data;
  }
  function showConnection(connected, message) {
    const status = $("#connection-status");
    status.replaceChildren(
      el("span", "connection-dot"),
      document.createTextNode(
        connected ? "MongoDB conectado" : "Sin conexión · reintentando",
      ),
    );
    status.classList.toggle("offline", !connected);
    $("#sidebar-status").style.backgroundColor = connected
      ? "#65b99d"
      : "#d07c67";
    $("#error-banner").hidden = connected;
    if (message) $("#error-banner").textContent = message;
  }
  function initializeMap() {
    map = L.map("map", {
      zoomControl: false,
      attributionControl: true,
    }).setView([-27.391, -55.941], 12);
    L.control.zoom({ position: "topright" }).addTo(map);
    const tiles = L.tileLayer(
      "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
      {
        maxZoom: 19,
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      },
    ).addTo(map);
    tiles.on("tileerror", () => {
      $("#tile-warning").hidden = false;
    });
    // El mapa nunca se reconstruye al recibir cambios; así conserva centro y zoom.
    new ResizeObserver(() => map.invalidateSize({ pan: false })).observe(
      $("#map"),
    );
    $("#fit-map").addEventListener("click", fitMap);
    $("#near-map").addEventListener("click", () => {
      const center = map.getCenter();
      const form = $("#near-form");
      form.elements.longitud.value = center.lng.toFixed(6);
      form.elements.latitud.value = center.lat.toFixed(6);
      $("#near-status").textContent =
        "Indicá un radio y ejecutá la consulta. Se incluyen mediciones históricas.";
      $("#near-results").replaceChildren();
      $("#near-dialog").showModal();
    });
  }
  function fitMap() {
    const markers = [...state.markers.values()].map((item) => item.marker);
    if (markers.length)
      map.fitBounds(L.featureGroup(markers).getBounds(), {
        padding: [42, 42],
        maxZoom: 14,
        animate: false,
      });
  }
  function markerPopup(doc) {
    const node = el("div");
    node.append(
      el("div", "popup-title", doc.estacion),
      el("p", "popup-detail", `${doc.estacionId} · ${doc.barrio}`),
      el("p", "popup-temp", `${temp(doc.temperaturaC)} °C`),
      el(
        "p",
        "popup-detail",
        `${formatDate(doc.fecha)} · humedad ${temp(doc.humedad)} %`,
      ),
      el(
        "p",
        "popup-detail",
        doc.origen === "simulado"
          ? "Dato sintético · ubicación aproximada"
          : `Origen declarado: ${doc.origen}`,
      ),
    );
    const button = el(
      "button",
      "popup-action",
      "Ver evolución de esta estación →",
    );
    button.addEventListener("click", () => selectStation(doc.estacionId));
    node.append(button);
    return node;
  }
  function drawMap(stations) {
    const remaining = new Set();
    for (const doc of stations) {
      const coords = doc.ubicacion?.coordinates;
      if (
        !Array.isArray(coords) ||
        coords.length !== 2 ||
        !coords.every(Number.isFinite) ||
        Math.abs(coords[0]) > 180 ||
        Math.abs(coords[1]) > 90
      )
        continue;
      remaining.add(doc.estacionId);
      const fingerprint = JSON.stringify(doc);
      const current = state.markers.get(doc.estacionId);
      if (current?.fingerprint === fingerprint) continue;
      const badge = el("span", "marker-label", `${temp(doc.temperaturaC)}°`);
      badge.style.backgroundColor = color(doc.temperaturaC);
      const markerIcon = L.divIcon({
        className: "temperature-marker",
        html: badge,
        iconSize: [48, 31],
        iconAnchor: [24, 32],
        popupAnchor: [0, -30],
      });
      const marker =
        current?.marker ||
        L.marker([coords[1], coords[0]], {
          keyboard: true,
          title: `${doc.estacion}: ${temp(doc.temperaturaC)} °C`,
        }).addTo(map);
      marker.setLatLng([coords[1], coords[0]]).setIcon(markerIcon);
      if (current) marker.setPopupContent(markerPopup(doc));
      else marker.bindPopup(markerPopup(doc));
      state.markers.set(doc.estacionId, { marker, fingerprint });
    }
    for (const [id, current] of state.markers)
      if (!remaining.has(id)) {
        current.marker.remove();
        state.markers.delete(id);
      }
    $("#map-empty").hidden = remaining.size > 0;
    if (!state.fitted && remaining.size) {
      fitMap();
      state.fitted = true;
    }
  }
  function fillSelect(select, values, placeholder) {
    const previous = select.value;
    const options = [
      new Option(placeholder, ""),
      ...values.map(([value, label]) => new Option(label, value)),
    ];
    // Conservar filtros activos aun si Compass elimina la última medición de esa estación/barrio.
    if (previous && !values.some(([value]) => value === previous))
      options.push(new Option(`${previous} (sin documentos)`, previous));
    select.replaceChildren(...options);
    select.value = previous;
  }
  function drawCatalog(catalog) {
    state.catalog = catalog;
    fillSelect(
      $("#filter-station"),
      catalog.map((doc) => [doc.estacionId, doc.estacion]),
      "Todas las estaciones",
    );
    fillSelect(
      $("#filter-neighborhood"),
      [...new Set(catalog.map((doc) => doc.barrio))]
        .sort((a, b) => a.localeCompare(b, "es"))
        .map((value) => [value, value]),
      "Todos los barrios",
    );
    fillSelect(
      $("#station-template"),
      catalog.map((doc) => [
        doc.estacionId,
        `${doc.estacionId} · ${doc.estacion}`,
      ]),
      "Nueva estación / valores propios",
    );
  }
  function drawStationList(stations) {
    $("#station-count").textContent = stations.length;
    const rows = stations.map((doc) => {
      const button = el(
        "button",
        `station-item${state.filters.estacionId === doc.estacionId ? " selected" : ""}`,
      );
      const dot = el("span", "station-color");
      dot.style.backgroundColor = color(doc.temperaturaC);
      const details = el("span", "station-text");
      details.append(
        el("span", "station-name", doc.estacion),
        el("span", "station-neighborhood", doc.barrio),
      );
      const value = el("span", "station-temp", temp(doc.temperaturaC));
      value.append(el("span", "", " °C"));
      button.append(dot, details, value);
      button.title = `${doc.estacionId} · ${formatDate(doc.fecha)} · ${doc.origen}`;
      button.addEventListener("click", () => selectStation(doc.estacionId));
      return button;
    });
    $("#station-list").replaceChildren(
      ...(rows.length
        ? rows
        : [el("p", "empty-placeholder", "No hay estaciones en la selección.")]),
    );
  }
  function svgNode(tag, attributes = {}, value) {
    const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const [key, entry] of Object.entries(attributes))
      node.setAttribute(key, entry);
    if (value !== undefined) node.textContent = value;
    return node;
  }
  function drawChart(rows) {
    const selected = state.catalog.find(
      (doc) => doc.estacionId === state.filters.estacionId,
    );
    const name = selected?.estacion || state.filters.estacionId;
    $("#chart-subtitle").textContent = name
      ? `${name} · cada medición dentro de los filtros · hora de Argentina`
      : "Promedio por hora · todas las estaciones filtradas · hora de Argentina";
    $("#chart-key-label").textContent = name || "Promedio horario";
    const points = rows
      .map((row) => ({
        date: new Date(row.fecha).getTime(),
        temperature: Number(row.temperaturaC),
      }))
      .filter(
        (point) =>
          Number.isFinite(point.date) && Number.isFinite(point.temperature),
      );
    if (!points.length) {
      $("#chart").replaceChildren(
        el(
          "p",
          "empty-placeholder",
          "No hay mediciones para graficar. Ajustá los filtros o ejecutá npm run seed.",
        ),
      );
      $("#chart-period").textContent = "Sin mediciones";
      return;
    }
    const width = Math.max(500, $("#chart").clientWidth - 40),
      height = 180;
    const left = 36,
      right = width - 16,
      top = 10,
      bottom = height - 33;
    const minimum = Math.floor(
      Math.min(...points.map((point) => point.temperature)) - 1,
    );
    const maximum = Math.ceil(
      Math.max(...points.map((point) => point.temperature)) + 1,
    );
    const first = points[0].date,
      last = points.at(-1).date;
    const x = (value) =>
      first === last
        ? (left + right) / 2
        : left + ((value - first) / (last - first)) * (right - left);
    const y = (value) =>
      bottom - ((value - minimum) / (maximum - minimum)) * (bottom - top);
    const svg = svgNode("svg", {
      viewBox: `0 0 ${width} ${height}`,
      class: "chart-svg",
      role: "img",
      "aria-label": `${points.length} puntos de temperatura entre ${formatDate(first)} y ${formatDate(last)}.`,
    });
    const definitions = svgNode("defs");
    const gradient = svgNode("linearGradient", {
      id: "temperature-area",
      x1: "0",
      y1: "0",
      x2: "0",
      y2: "1",
    });
    gradient.append(
      svgNode("stop", {
        offset: "0%",
        "stop-color": "#62a697",
        "stop-opacity": ".19",
      }),
      svgNode("stop", {
        offset: "100%",
        "stop-color": "#62a697",
        "stop-opacity": "0",
      }),
    );
    definitions.append(gradient);
    svg.append(definitions);
    for (let tick = 0; tick <= 4; tick++) {
      const value = minimum + ((maximum - minimum) * tick) / 4;
      const position = y(value);
      svg.append(
        svgNode("line", {
          x1: left,
          x2: right,
          y1: position,
          y2: position,
          class: "axis-line",
        }),
        svgNode(
          "text",
          { x: left - 10, y: position + 3, "text-anchor": "end" },
          temp(value),
        ),
      );
    }
    const line = points
      .map(
        (point, index) =>
          `${index ? "L" : "M"}${x(point.date).toFixed(2)},${y(point.temperature).toFixed(2)}`,
      )
      .join(" ");
    if (points.length > 1)
      svg.append(
        svgNode("path", {
          d: `${line} L${x(last)},${bottom} L${x(first)},${bottom} Z`,
          fill: "url(#temperature-area)",
        }),
      );
    svg.append(
      svgNode("path", {
        d: line,
        fill: "none",
        stroke: "#559c8d",
        "stroke-width": "2",
        "stroke-linejoin": "round",
        "stroke-linecap": "round",
      }),
    );
    for (const point of points) {
      const circle = svgNode("circle", {
        cx: x(point.date),
        cy: y(point.temperature),
        r: points.length > 100 ? 1 : 2.2,
        fill: "#559c8d",
      });
      circle.append(
        svgNode(
          "title",
          {},
          `${formatDate(point.date)} · ${temp(point.temperature)} °C`,
        ),
      );
      svg.append(circle);
    }
    for (let tick = 0; tick <= (first === last ? 0 : 4); tick++) {
      const date = first + ((last - first) * tick) / 4;
      svg.append(
        svgNode(
          "text",
          {
            x: x(date),
            y: height - 8,
            "text-anchor":
              first === last
                ? "middle"
                : tick === 0
                  ? "start"
                  : tick === 4
                    ? "end"
                    : "middle",
          },
          formatDate(date, shortFormat),
        ),
      );
    }
    $("#chart").replaceChildren(svg);
    $("#chart-period").textContent =
      `${points.length} puntos · ${formatDate(first)} — ${formatDate(last)}`;
  }
  function drawTable(snapshot) {
    const rows = snapshot.recientes.map((doc) => {
      const row = el("tr");
      const station = el("td", "", doc.estacion);
      station.append(el("span", "table-station-id", doc.estacionId));
      const temperature = el("td");
      const pill = el(
        "span",
        "temperature-pill",
        `${temp(doc.temperaturaC)} °C`,
      );
      pill.style.color = color(doc.temperaturaC);
      temperature.append(pill);
      const origin = el("td");
      origin.append(
        el(
          "span",
          "origin-pill",
          doc.origen === "simulado" ? "Sintético" : String(doc.origen),
        ),
      );
      const actionsCell = el("td");
      const actions = el("div", "table-actions");
      const edit = el("button", "icon-button");
      edit.title = `Editar ${doc.estacion} del ${formatDate(doc.fecha)}`;
      edit.setAttribute("aria-label", edit.title);
      edit.append(icon("edit"));
      edit.addEventListener("click", () => openEdit(doc._id));
      const remove = el("button", "icon-button delete");
      remove.title = `Eliminar medición de ${doc.estacion}`;
      remove.setAttribute("aria-label", remove.title);
      remove.append(icon("trash"));
      remove.addEventListener("click", () => openDelete(doc));
      actions.append(edit, remove);
      actionsCell.append(actions);
      row.append(
        station,
        el("td", "", doc.barrio),
        el("td", "", formatDate(doc.fecha)),
        temperature,
        el("td", "", `${temp(doc.humedad)} %`),
        origin,
        actionsCell,
      );
      return row;
    });
    if (!rows.length) {
      const row = el("tr"),
        cell = el(
          "td",
          "empty-cell",
          state.catalog.length
            ? "No hay mediciones para estos filtros."
            : "La colección está vacía. Ejecutá npm run seed o creá una medición sintética.",
        );
      cell.colSpan = 7;
      row.append(cell);
      rows.push(row);
    }
    $("#measurements-table").replaceChildren(...rows);
    const total = snapshot.estadisticas.total,
      page = snapshot.pagina,
      size = snapshot.porPagina;
    $("#record-count").textContent = total.toLocaleString("es-AR");
    $("#table-range").textContent = total
      ? `${(page - 1) * size + 1}–${Math.min(page * size, total)} de ${total.toLocaleString("es-AR")} documentos`
      : "0 documentos";
    $("#page-label").textContent = `Página ${page}`;
    $("#page-prev").disabled = page === 1;
    $("#page-next").disabled = page * size >= total;
  }
  function render(snapshot) {
    drawCatalog(snapshot.catalogo);
    const stats = snapshot.estadisticas;
    $("#stat-max").textContent = temp(stats.maxima);
    $("#stat-min").textContent = temp(stats.minima);
    $("#stat-avg").textContent = temp(stats.promedio);
    const extra =
      stats.total && stats.sinteticas !== stats.total
        ? ` · ${stats.sinteticas} sintéticos; otros orígenes declarados sin verificar`
        : " · datos sintéticos";
    $("#filter-summary").textContent =
      `${snapshot.estaciones.length} estaciones · ${stats.total.toLocaleString("es-AR")} mediciones${extra}`;
    drawMap(snapshot.estaciones);
    drawStationList(snapshot.estaciones);
    drawChart(snapshot.historia);
    drawTable(snapshot);
  }
  async function refresh() {
    if (!api || state.busy) return;
    state.busy = true;
    const revision = state.revision;
    try {
      const snapshot = await call(api.obtenerPanel(state.filters));
      if (snapshot.ocupado) return;
      // Una respuesta vieja no debe pisar filtros que el usuario acaba de cambiar.
      if (revision !== state.revision) return;
      showConnection(true);
      const maxPage = Math.max(
        1,
        Math.ceil(snapshot.estadisticas.total / snapshot.porPagina),
      );
      if (state.filters.pagina > maxPage) {
        state.filters.pagina = maxPage;
        state.revision++;
        state.queued = true;
        return;
      }
      state.snapshot = snapshot;
      if (state.version !== snapshot.version) {
        state.version = snapshot.version;
        render(snapshot);
      }
      $("#last-updated").textContent =
        `Última actualización: ${formatDate(snapshot.consultadoEn, timeFormat)} · cada 2 s`;
    } catch (error) {
      if (revision !== state.revision) return;
      showConnection(
        false,
        `${error.message} Se conserva la última vista y se reintenta automáticamente.`,
      );
    } finally {
      state.busy = false;
      if (state.queued) {
        state.queued = false;
        refresh();
      }
    }
  }
  function requestRefresh() {
    state.version = null;
    if (state.busy) state.queued = true;
    else refresh();
  }
  function readFilters() {
    const from = $("#filter-from").value,
      to = $("#filter-to").value;
    const output = {
      pagina: 1,
      estacionId: $("#filter-station").value,
      barrio: $("#filter-neighborhood").value,
    };
    if (from) output.desde = new Date(`${from}T00:00:00-03:00`).toISOString();
    if (to)
      output.hasta = new Date(
        new Date(`${to}T00:00:00-03:00`).getTime() + 86400000,
      ).toISOString();
    for (const key of ["min", "max"])
      if ($(`#filter-${key}`).value !== "")
        output[key] = Number($(`#filter-${key}`).value);
    if (output.desde && output.hasta && output.desde >= output.hasta)
      throw new Error("La fecha inicial debe ser anterior o igual a la final.");
    if (
      output.min !== undefined &&
      output.max !== undefined &&
      output.min > output.max
    )
      throw new Error("El mínimo térmico no puede superar al máximo.");
    return output;
  }
  function applyFilters() {
    try {
      state.filters = readFilters();
      state.revision++;
      requestRefresh();
    } catch (error) {
      toast(error.message, true);
    }
  }
  function selectStation(id) {
    $("#filter-station").value = id;
    applyFilters();
  }
  function localDateInput(value) {
    return new Date(new Date(value).getTime() - 3 * 3600000)
      .toISOString()
      .slice(0, 23);
  }
  function fillMeasurement(doc) {
    const fields = $("#measurement-form").elements;
    for (const key of [
      "estacionId",
      "estacion",
      "barrio",
      "temperaturaC",
      "humedad",
    ])
      fields[key].value = doc[key] ?? "";
    fields.fecha.value = localDateInput(doc.fecha || new Date());
    fields.longitud.value = doc.ubicacion?.coordinates[0] ?? -55.8944;
    fields.latitud.value = doc.ubicacion?.coordinates[1] ?? -27.3667;
    fields.contexto.value = JSON.stringify(
      doc.contexto || {
        entorno: "urbano",
        nota: "Medición sintética de práctica.",
      },
      null,
      2,
    );
  }
  function openNew() {
    state.editing = null;
    $("#form-title").textContent = "Nueva medición sintética";
    $("#form-error").hidden = true;
    $("#station-template").value = "";
    const selected = state.catalog.find(
      (doc) => doc.estacionId === state.filters.estacionId,
    );
    fillMeasurement(selected || {});
    if (selected) $("#station-template").value = selected.estacionId;
    $("#measurement-dialog").showModal();
  }
  async function openEdit(id) {
    try {
      const doc = await call(api.obtenerMedicion(id));
      if (!doc) {
        toast("El documento ya fue eliminado desde otra herramienta.", true);
        requestRefresh();
        return;
      }
      state.editing = id;
      $("#form-title").textContent = "Editar medición sintética";
      $("#form-error").hidden = true;
      $("#station-template").value = doc.estacionId;
      fillMeasurement(doc);
      $("#measurement-dialog").showModal();
    } catch (error) {
      toast(error.message, true);
    }
  }
  async function saveMeasurement(event) {
    event.preventDefault();
    if ($("#save-measurement").disabled) return;
    const fields = event.currentTarget.elements;
    const button = $("#save-measurement");
    try {
      const payload = {
        estacionId: fields.estacionId.value,
        estacion: fields.estacion.value,
        barrio: fields.barrio.value,
        fecha: new Date(
          `${fields.fecha.value.length === 16 ? fields.fecha.value + ":00" : fields.fecha.value}-03:00`,
        ).toISOString(),
        temperaturaC: Number(fields.temperaturaC.value),
        humedad: Number(fields.humedad.value),
        ubicacion: {
          type: "Point",
          coordinates: [
            Number(fields.longitud.value),
            Number(fields.latitud.value),
          ],
        },
        contexto: JSON.parse(fields.contexto.value),
      };
      button.disabled = true;
      button.textContent = "Guardando…";
      const result = await call(
        state.editing
          ? api.actualizarMedicion(state.editing, payload)
          : api.crearMedicion(payload),
      );
      if (state.editing && !result.encontrado)
        throw new Error(
          "El documento fue eliminado desde Compass. Cerrá el formulario y creá uno nuevo si lo necesitás.",
        );
      $("#measurement-dialog").close();
      toast(
        state.editing
          ? "Documento actualizado en MongoDB."
          : "Medición sintética creada en MongoDB.",
      );
      requestRefresh();
    } catch (error) {
      $("#form-error").hidden = false;
      $("#form-error").textContent =
        error instanceof SyntaxError
          ? "Contexto: ingresá JSON válido con comillas dobles y sin comas finales."
          : error.message;
    } finally {
      button.disabled = false;
      button.textContent = "Guardar documento";
    }
  }
  function openDelete(doc) {
    state.deleting = doc._id;
    $("#delete-description").textContent =
      `${doc.estacion} · ${formatDate(doc.fecha)} · ${temp(doc.temperaturaC)} °C`;
    $("#delete-error").hidden = true;
    $("#delete-dialog").showModal();
  }
  async function deleteMeasurement() {
    const button = $("#confirm-delete");
    if (button.disabled) return;
    button.disabled = true;
    try {
      const result = await call(api.eliminarMedicion(state.deleting));
      $("#delete-dialog").close();
      toast(
        result.eliminado
          ? "Documento eliminado de MongoDB."
          : "El documento ya había sido eliminado.",
      );
      requestRefresh();
    } catch (error) {
      $("#delete-error").hidden = false;
      $("#delete-error").textContent = error.message;
    } finally {
      button.disabled = false;
    }
  }
  async function searchNear(event) {
    event.preventDefault();
    const button = $("#near-submit"),
      fields = event.currentTarget.elements;
    if (button.disabled) return;
    button.disabled = true;
    $("#near-status").textContent = "Consultando MongoDB con $near…";
    $("#near-results").replaceChildren();
    try {
      const result = await call(
        api.buscarCercanas({
          longitud: Number(fields.longitud.value),
          latitud: Number(fields.latitud.value),
          radio: Number(fields.radio.value),
        }),
      );
      const count = new Set(result.documentos.map((doc) => doc.estacionId))
        .size;
      $("#near-status").textContent =
        `${result.documentos.length} documentos · ${count} estaciones${result.limitado ? " · se muestran sólo los primeros 100 resultados por cercanía" : ""}. Incluye mediciones históricas; no es un listado de estaciones únicas.`;
      $("#near-results").replaceChildren(
        ...result.documentos.map((doc) => {
          const row = el("div", "near-result"),
            label = el("span", "", doc.estacion);
          label.append(
            el(
              "small",
              "",
              `${doc.barrio} · ${formatDate(doc.fecha)} · ${doc.origen}`,
            ),
          );
          row.append(label, el("strong", "", `${temp(doc.temperaturaC)} °C`));
          return row;
        }),
      );
    } catch (error) {
      $("#near-status").textContent = error.message;
    } finally {
      button.disabled = false;
    }
  }

  const examples = {
    document: [
      "Un documento puede contener un punto geográfico y un contexto con atributos variables. La fecha se almacena como BSON Date, no como texto.",
      `use observatorio_temperaturas\n\ndb.mediciones.findOne({ estacionId: "POS-01" })\n\n// Forma de un documento (todos los valores son sintéticos):\n{\n  estacionId: "POS-01",\n  estacion: "Costanera",\n  barrio: "Villa Sarita",\n  fecha: ISODate("2026-10-27T15:00:00Z"),\n  temperaturaC: 29.2, humedad: 65,\n  ubicacion: { type: "Point", coordinates: [-55.8955, -27.3537] },\n  contexto: { entorno: "ribera", sombra: true },\n  origen: "simulado"\n}`,
    ],
    find: [
      "find filtra documentos. sort y limit permiten leer las últimas mediciones de una estación. Cambiá el identificador y compará el resultado con el panel.",
      `use observatorio_temperaturas\n\ndb.mediciones.find({\n  estacionId: "POS-01",\n  temperaturaC: { $gte: 25, $lte: 35 }\n}).sort({ fecha: -1, _id: -1 }).limit(10)\n\n// Ver documentos con atributos variables:\ndb.mediciones.find({ "contexto.sombra": true })`,
    ],
    crud: [
      "CRUD: crear, leer, actualizar y eliminar. Guardá el insertedId para modificar exactamente el documento de esta práctica.",
      `use observatorio_temperaturas\n\nconst nueva = db.mediciones.insertOne({\n  estacionId: "LAB-01", estacion: "Estación de práctica",\n  barrio: "Centro", fecha: new Date(), temperaturaC: 28.5,\n  humedad: 68,\n  ubicacion: { type: "Point", coordinates: [-55.8944, -27.3667] },\n  contexto: { actividad: "CRUD", virtual: true },\n  origen: "simulado"\n});\n\ndb.mediciones.find({ _id: nueva.insertedId });\ndb.mediciones.updateOne(\n  { _id: nueva.insertedId }, { $set: { temperaturaC: 32.1 } }\n);\n// Observá el panel; luego eliminá sólo la medición de práctica:\ndb.mediciones.deleteOne({ _id: nueva.insertedId });`,
    ],
    aggregate: [
      "El mapa usa esta secuencia: $match selecciona, $sort ordena y $group obtiene la medición más reciente por estación. Se ejecuta en MongoDB cada 2 segundos.",
      `use observatorio_temperaturas\n\ndb.mediciones.aggregate([\n  { $match: { temperaturaC: { $gte: -30, $lte: 60 } } },\n  { $sort: { estacionId: 1, fecha: -1, _id: -1 } },\n  { $group: {\n      _id: "$estacionId", medicion: { $first: "$$ROOT" }\n  } },\n  { $replaceRoot: { newRoot: "$medicion" } },\n  { $sort: { estacion: 1, estacionId: 1 } }\n]);\n\n// Las tarjetas resumen todas las mediciones filtradas:\ndb.mediciones.aggregate([\n  { $group: { _id: null, maxima: { $max: "$temperaturaC" },\n    minima: { $min: "$temperaturaC" },\n    promedio: { $avg: "$temperaturaC" } } }\n]);`,
    ],
    near: [
      "GeoJSON usa [longitud, latitud]. $near encuentra documentos próximos y los ordena por distancia. El radio está expresado en metros; incluye mediciones históricas.",
      `use observatorio_temperaturas\n\ndb.mediciones.createIndex(\n  { ubicacion: "2dsphere" }, { name: "ubicacion_2dsphere" }\n);\ndb.mediciones.createIndex(\n  { estacionId: 1, fecha: -1 }, { name: "estacion_fecha" }\n);\n\ndb.mediciones.find({\n  ubicacion: { $near: {\n    $geometry: { type: "Point", coordinates: [-55.8944, -27.3667] },\n    $maxDistance: 1500\n  } }\n}).limit(20);\n\ndb.mediciones.getIndexes();`,
    ],
    architecture: [
      "Dos capas de despliegue: aplicación Electron y MongoDB local. Compass es una herramienta externa que edita la misma base.",
      `CAPA 1 · APLICACIÓN ELECTRON\n\n  Renderer: HTML + CSS + JavaScript Vanilla + Leaflet\n      ↓ window.observatorio.obtenerPanel(filtros)\n  Preload: contextBridge → método específico → IPC\n      ↓ validación del emisor, frame y parámetros\n  Proceso principal: driver oficial de MongoDB\n      ↓ consulta cada 2 s (sin superposición)\n\nCAPA 2 · MONGODB COMMUNITY LOCAL\n\n  mongodb://127.0.0.1:27017\n  observatorio_temperaturas.mediciones\n      ↑\n  Compass: insertá, modificá o eliminá documentos.\n\nNo hay servidor HTTP ni API REST.\nNo se requieren replica sets ni Change Streams.\nnodeIntegration: false · contextIsolation: true · sandbox: true`,
    ],
  };
  function showExample(name) {
    $("#example-description").textContent = examples[name][0];
    $("#example-code").textContent = examples[name][1];
    document
      .querySelectorAll("[data-example]")
      .forEach((button) =>
        button.classList.toggle("active", button.dataset.example === name),
      );
  }
  function openLearning() {
    showExample("document");
    $("#learning-dialog").showModal();
  }

  document
    .querySelectorAll(".close-dialog")
    .forEach((button) =>
      button.addEventListener("click", () => button.closest("dialog").close()),
    );
  $("#open-learning").addEventListener("click", openLearning);
  $("#open-learning-card").addEventListener("click", openLearning);
  document
    .querySelectorAll("[data-example]")
    .forEach((button) =>
      button.addEventListener("click", () =>
        showExample(button.dataset.example),
      ),
    );
  $("#filter-form").addEventListener("submit", (event) => {
    event.preventDefault();
    applyFilters();
  });
  $("#reset-filters").addEventListener("click", () => {
    $("#filter-form").reset();
    applyFilters();
  });
  $("#new-measurement").addEventListener("click", openNew);
  $("#measurement-form").addEventListener("submit", saveMeasurement);
  $("#confirm-delete").addEventListener("click", deleteMeasurement);
  $("#near-form").addEventListener("submit", searchNear);
  $("#station-template").addEventListener("change", (event) => {
    const doc = state.catalog.find(
      (item) => item.estacionId === event.target.value,
    );
    if (!doc) return;
    const fields = $("#measurement-form").elements;
    for (const key of ["estacionId", "estacion", "barrio"])
      fields[key].value = doc[key];
    fields.longitud.value = doc.ubicacion.coordinates[0];
    fields.latitud.value = doc.ubicacion.coordinates[1];
  });
  for (const [selector, delta] of [
    ["#page-prev", -1],
    ["#page-next", 1],
  ])
    $(selector).addEventListener("click", () => {
      state.filters.pagina += delta;
      state.revision++;
      requestRefresh();
    });
  $("#inspect-db").addEventListener("click", async () => {
    $("#inspect-result").textContent = "Consultando índices…";
    $("#inspect-dialog").showModal();
    try {
      $("#inspect-result").textContent = JSON.stringify(
        await call(api.verificarBase()),
        null,
        2,
      );
    } catch (error) {
      $("#inspect-result").textContent = error.message;
    }
  });
  let resizeTimer;
  new ResizeObserver(() => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (state.snapshot) drawChart(state.snapshot.historia);
    }, 100);
  }).observe($("#chart"));
  if (!api) {
    showConnection(
      false,
      "Abrí esta aplicación con npm start. El acceso a MongoDB requiere el preload seguro de Electron.",
    );
    $("#new-measurement").disabled = true;
    $("#inspect-db").disabled = true;
    return;
  }
  initializeMap();
  refresh();
  // El guard busy evita consultas superpuestas aun si MongoDB demora más de dos segundos.
  state.timer = setInterval(refresh, 2000);
  window.addEventListener("beforeunload", () => clearInterval(state.timer));
})();
