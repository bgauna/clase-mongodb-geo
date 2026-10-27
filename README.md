# Observatorio de Temperaturas Urbanas

Aplicación de escritorio para aprender MongoDB, documentos NoSQL y georreferenciación con estaciones **simuladas en Posadas, Misiones**. Incluye mapa, filtros, series temporales, tabla paginada, CRUD y ejemplos para el aula.

**Las 720 mediciones iniciales son sintéticas. Las coordenadas son aproximadas. No son registros meteorológicos reales, pronósticos ni sensores oficiales.** El seed genera 10 estaciones con 72 mediciones horarias cada una, terminando en la hora de su primera ejecución.

## Inicio rápido en Windows

Requisitos: Windows 10/11 de 64 bits, Node.js **22.14 o posterior** con npm, MongoDB Community Server **8.x**, y opcionalmente MongoDB Compass y mongosh. Se recomienda una versión LTS vigente de Node.js. La primera instalación necesita Internet para npm y Electron. El mapa usa teselas de OpenStreetMap por HTTPS; la base de datos y el CRUD son locales.

En PowerShell, dentro de esta carpeta:

```powershell
npm install
npm run seed
npm start
```

`npm start` compila Tailwind, copia Leaflet desde `node_modules` y abre Electron. No hay que abrir `index.html` en un navegador. No se necesita servidor web, puertos HTTP ni API REST.

Para instalaciones posteriores reproducibles con el lockfile incluido, se puede usar `npm ci` en lugar de `npm install`.

## 1. Instalar MongoDB Community Server

1. Descargá el instalador MSI de [MongoDB Community Server](https://www.mongodb.com/try/download/community). Seguí la [guía oficial para Windows](https://www.mongodb.com/docs/manual/tutorial/install-mongodb-on-windows/).
2. Elegí instalación completa y **Install MongoDB as a Service**. El nombre predeterminado del servicio es `MongoDB`.
3. Mantené el servidor vinculado a la interfaz local (`127.0.0.1`) y el puerto predeterminado `27017`. Esta práctica no necesita publicar MongoDB en la red.
4. Comprobá el servicio:

```powershell
Get-Service MongoDB
Test-NetConnection 127.0.0.1 -Port 27017
```

Si está detenido, en PowerShell como administrador:

```powershell
Start-Service MongoDB
```

MongoDB funciona como **standalone**. No hay que configurar replica sets ni Change Streams. Si elegiste no instalar un servicio, iniciá `mongod` con su archivo de configuración antes de ejecutar la aplicación.

## 2. Instalar Compass y mongosh

Descargá [MongoDB Compass](https://www.mongodb.com/try/download/compass), instalalo y creá una conexión con:

```text
mongodb://127.0.0.1:27017
```

Compass es una herramienta externa: no se integra dentro del renderer. La aplicación y Compass editan la misma base local.

Para ejecutar los ejemplos de shell podés usar el shell de Compass, cuando esté disponible en tu versión, o instalar [MongoDB Shell (mongosh)](https://www.mongodb.com/try/download/shell). `mongosh` es una instalación separada del servidor y no es necesario para `npm start`.

## 3. Base, documentos e índices

| Elemento | Valor |
| --- | --- |
| URI | `mongodb://127.0.0.1:27017` |
| Base | `observatorio_temperaturas` |
| Colección | `mediciones` |
| Índice geoespacial | `{ ubicacion: "2dsphere" }`, nombre `ubicacion_2dsphere` |
| Índice de apoyo | `{ estacionId: 1, fecha: -1 }`, nombre `estacion_fecha` |

Ejemplo en sintaxis mongosh:

```javascript
{
  estacionId: "POS-01",
  estacion: "Costanera",
  barrio: "Villa Sarita",
  fecha: ISODate("2026-10-27T15:00:00Z"),
  temperaturaC: 29.2,
  humedad: 65,
  ubicacion: { type: "Point", coordinates: [-55.8955, -27.3537] },
  contexto: {
    entorno: "ribera",
    sombra: true,
    vientoKmh: 8,
    nota: "Ejemplo sintético"
  },
  origen: "simulado"
}
```

`fecha` es **BSON Date**, los valores térmicos y coordenadas son numéricos, y `contexto` es un documento anidado que admite atributos variables. Una estación urbana puede tener `superficie` y `trafico`; otra, `coberturaVerde` y un documento `sensor`. No se necesita repetir exactamente las mismas claves.

GeoJSON utiliza **[longitud, latitud]**; Leaflet recibe **[latitud, longitud]**. La conversión está comentada en el renderer. El índice geoespacial también valida la geometría y los límites terrestres de las coordenadas.

Al crear una colección nueva se instala un validador `$jsonSchema`. Se exigen campos y tipos básicos, manteniendo flexible el documento `contexto`. Si la colección ya existía, no se cambia su validador ni se migran sus documentos automáticamente. Conservá el esquema requerido al editar desde Compass. No guardes fechas como strings.

## 4. Seed idempotente y preservación de cambios

```powershell
npm run seed
```

El seed utiliza `_id` estables y `updateOne` con `$setOnInsert` y `upsert: true`. Si un documento ya existe, **no cambia ninguno de sus valores**, aunque el script se ejecute otro día. No reemplaza temperaturas, fechas, coordenadas ni contexto que hayas editado desde Compass.

**El arranque de la aplicación nunca ejecuta el seed.** Si borrás un documento o toda la colección desde Compass, abrir Electron no repone esos datos. Ejecutar explícitamente `npm run seed` sí inserta los documentos iniciales que falten. No recalcula las fechas de documentos existentes: el historial permanece estable. Para agregar información de un nuevo día, creá nuevas mediciones desde el formulario o Compass.

## 5. Usar el panel

- **Filtros:** estación, barrio, fecha desde/hasta y mínimo/máximo térmico; presioná **Aplicar**. Las fechas se interpretan en Argentina, UTC−3. Ambos días están incluidos; internamente se usa un intervalo `[inicio, día siguiente al final)`.
- **Tarjetas:** máximo, mínimo y promedio de **todas las mediciones que cumplen los filtros**, no solamente de los marcadores visibles.
- **Mapa:** muestra la medición más reciente de cada estación **dentro del período y los demás filtros**. Una temperatura de una medición anterior puede convertirse en la visible si la última queda fuera del rango térmico. No se usan coordenadas ni temperaturas estáticas en el renderer.
- **Estaciones:** seleccioná una para filtrar el panel y ver cada una de sus mediciones en el gráfico. En el popup del mapa también hay un botón para ver su evolución.
- **Gráfico:** para todas las estaciones, muestra el promedio por hora de los documentos filtrados; con una estación, muestra cada medición. Se limita a los **480 puntos más recientes**, ordenados por fecha. Posá el cursor sobre un punto para ver su valor. No se inventan valores para horas sin datos.
- **Tabla:** 10 documentos por página, ordenados por fecha descendente, con botones de edición y eliminación. Los empates se resuelven por `_id`.
- **CRUD:** **Nueva medición** permite completar datos desde una estación existente o crear otra. El campo `contexto` admite JSON válido. Las altas y ediciones de este laboratorio se guardan con `origen: "simulado"`. Editar una medición cambia ese documento, no todos los documentos de su estación.
- **Geografía:** **Buscar cerca del centro** abre una consulta `$near`. Devuelve documentos históricos, ordenados por distancia, hasta 100 resultados; no es un listado de estaciones únicas. Esta consulta es independiente de los filtros generales.
- **Aula MongoDB:** ofrece ejemplos de documentos, `find`, CRUD, `aggregate`, índices y `$near`.
- **Ver índices:** consulta realmente `listIndexes()` y `countDocuments()` en MongoDB.

Los colores del mapa representan `< 22 °C`, `22 a < 28 °C`, `28 a < 32 °C` y `≥ 32 °C`. Son categorías visuales didácticas, sin implicar alertas meteorológicas.

## 6. Modificar una temperatura desde Compass

1. Abrí `observatorio_temperaturas` → `mediciones` → **Documents**.
2. En el filtro ingresá `{ estacionId: "POS-01" }` y ordená con `{ fecha: -1, _id: -1 }`.
3. Abrí el primer documento. Es la medición más reciente de esa estación.
4. Cambiá `temperaturaC`, por ejemplo, a **34.8**, manteniendo el tipo numérico. Guardá con **Update**.
5. En Electron, quitá filtros incompatibles. En aproximadamente **2 segundos**, al terminar la siguiente consulta, el marcador mostrará el nuevo valor y cambiará su color. La tabla y el gráfico también reflejarán la modificación. Las tarjetas cambian si el valor afecta su máximo, mínimo o promedio.
6. Modificá `contexto`, `humedad` o las coordenadas y observá la actualización correspondiente.
7. Eliminá esa medición desde Compass: el mapa pasa a mostrar la anterior de la estación. Si eliminás todas las mediciones de una estación, desaparece su marcador.
8. Insertá una medición con fecha posterior: pasa a ser la más reciente. Usá **BSON Date**, no texto. En el editor Extended JSON de Compass podés representar la fecha como `{ "$date": "2026-10-27T15:00:00Z" }`; ajustá esa fecha al momento de la práctica.

Si editás una medición histórica, el marcador cambia solamente si el documento pasa a ser el más reciente dentro de los filtros. El gráfico y las estadísticas sí usan el historial filtrado. Desplazá el mapa o cambiá su zoom durante la prueba: la actualización automática conserva ambos valores.

## 7. Cómo funciona la actualización automática

El renderer ejecuta `obtenerPanel(filtros)` cada **2000 ms**. El preload invoca un canal IPC específico. El proceso principal valida el emisor y los datos, consulta MongoDB y devuelve objetos simples.

Un único `aggregate` con `$facet` obtiene catálogo de estaciones, últimas mediciones, estadísticas, página de tabla e historial. Las ramas filtradas usan `$match`. Para los marcadores:

```javascript
db.mediciones.aggregate([
  { $match: { barrio: "Villa Sarita" } },
  { $sort: { estacionId: 1, fecha: -1, _id: -1 } },
  { $group: { _id: "$estacionId", medicion: { $first: "$$ROOT" } } },
  { $replaceRoot: { newRoot: "$medicion" } },
  { $sort: { estacion: 1, estacionId: 1 } }
])
```

Se calcula un hash del resultado completo del panel, no sólo de la cantidad de documentos. Así se detectan cambios en valores, inserciones y eliminaciones que afecten la vista. Si el resultado no cambia, se evita redibujar. Se muestra la hora de la última consulta exitosa. Las modificaciones fuera de los filtros se verán al ajustar la selección correspondiente.

Hay un guard en el renderer y otro en el proceso principal para evitar superponer lecturas del panel. Si la consulta tarda más de 2 segundos, el tick intermedio se omite. Si cambian los filtros mientras hay una consulta pendiente, su respuesta anterior se descarta y se consulta la selección nueva. No se recarga la ventana ni se reconstruye el mapa. Ante una desconexión, se conserva la última vista, se indica el error y se reintenta automáticamente.

Este es un laboratorio con volumen pequeño. El `$facet` inicial recorre la colección; no se afirma que cada rama aproveche un índice. El índice compuesto apoya las consultas directas por estación y fecha de los ejemplos. Para grandes volúmenes convendría diseñar consultas y paginación específicas, conservando la corrección de los resultados.

## 8. Consultas listas para ejecutar

Conectate con:

```powershell
mongosh "mongodb://127.0.0.1:27017/observatorio_temperaturas"
```

### find y filtros temporales

```javascript
db.mediciones.find({ estacionId: "POS-01" })
  .sort({ fecha: -1, _id: -1 }).limit(10)

db.mediciones.find({
  fecha: {
    $gte: ISODate("2026-10-26T03:00:00Z"),
    $lt: ISODate("2026-10-28T03:00:00Z")
  },
  temperaturaC: { $gte: 25, $lte: 35 }
})

db.mediciones.find({ "contexto.sombra": true })
```

Los ejemplos de fechas son fijos: ajustalos a las fechas que veas en tus documentos.

### insertOne, updateOne y deleteOne

Este ejercicio crea un documento sintético nuevo y guarda su identificador para modificarlo y eliminarlo sin afectar otros documentos:

```javascript
const creada = db.mediciones.insertOne({
  estacionId: "LAB-01", estacion: "Estación de práctica", barrio: "Centro",
  fecha: new Date(), temperaturaC: 28.5, humedad: 68,
  ubicacion: { type: "Point", coordinates: [-55.8944, -27.3667] },
  contexto: { actividad: "CRUD", virtual: true }, origen: "simulado"
})

db.mediciones.find({ _id: creada.insertedId })

db.mediciones.updateOne(
  { _id: creada.insertedId },
  { $set: { temperaturaC: 32.1, "contexto.observacion": "Cambio desde Compass" } }
)

// Observá el panel antes de ejecutar la eliminación:
db.mediciones.deleteOne({ _id: creada.insertedId })
```

### $near e índice 2dsphere

```javascript
db.mediciones.createIndex(
  { ubicacion: "2dsphere" }, { name: "ubicacion_2dsphere" }
)

db.mediciones.find({
  ubicacion: {
    $near: {
      $geometry: { type: "Point", coordinates: [-55.8944, -27.3667] },
      $maxDistance: 1500
    }
  }
}).limit(20)
```

`$near` se utiliza en `find`, no dentro de `$match` de una agregación. El radio es de 1500 metros; aparecen mediciones históricas cercanas, posiblemente varias por estación. Más información en la [documentación de consultas geoespaciales de MongoDB](https://www.mongodb.com/docs/manual/geospatial-queries/).

### Verificar documentos, tipos e índices

```javascript
db.mediciones.countDocuments()
db.mediciones.findOne()
db.mediciones.countDocuments({ origen: "simulado" })
db.mediciones.countDocuments({ fecha: { $type: "date" } })
db.mediciones.getIndexes()
db.getCollectionInfos({ name: "mediciones" })

db.mediciones.find({ estacionId: "POS-01" })
  .sort({ fecha: -1 }).explain("executionStats")
```

Después del primer seed, en una colección inicialmente vacía, los primeros recuentos deben ser **720** y todos los documentos deben tener `fecha` de tipo `date` y `origen: "simulado"`. Además del índice `_id_`, deben figurar `ubicacion_2dsphere` y `estacion_fecha`. En Compass, comprobá las pestañas **Documents**, **Schema**, **Indexes** y **Validation**.

También podés ejecutar el archivo de consultas de lectura:

```powershell
mongosh "mongodb://127.0.0.1:27017" --file scripts/consultas.mongosh.js
```

## 9. Arquitectura y seguridad

```text
CAPA 1: Aplicación cliente de escritorio (Electron)
  HTML + CSS3 + Tailwind compilado + JavaScript Vanilla + Leaflet
       ↓ API específica window.observatorio
  preload.js → contextBridge → IPC
       ↓ validación de emisor y parámetros
  main.js → database.js → driver oficial de MongoDB para Node.js
       ↓ conexión local directa
CAPA 2: MongoDB Community Server standalone
  observatorio_temperaturas.mediciones
       ↑ edición externa desde MongoDB Compass
```

Los procesos de Electron forman parte de la misma aplicación de escritorio, no son capas de despliegue adicionales. No se utilizan Express, una API REST, frameworks de frontend ni TypeScript.

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, `webSecurity: true`.
- Protocolo local seguro `observatorio://app/` con acceso restringido a archivos del renderer.
- IPC limitado a siete métodos específicos. No se exponen `ipcRenderer`, `MongoClient`, objetos del driver ni un método genérico de consultas.
- Se verifica el WebContents, el frame principal y la URL exactos del emisor.
- Se construyen filtros en el proceso principal a partir de campos permitidos; nunca se ejecuta un filtro ni operador arbitrario recibido del renderer.
- Temperaturas, humedad, fechas, ObjectId, rangos y coordenadas se validan antes de llamar al driver. `contexto` tiene límites de tamaño y profundidad y rechaza claves de operadores/prototipos.
- El contenido de documentos se agrega con `textContent` y nodos DOM, incluido el popup de Leaflet. No se interpola texto de usuarios en HTML.
- CSP restringida, sin scripts, fuentes ni CSS remotos. Leaflet y Tailwind se empaquetan localmente. Las únicas peticiones remotas permitidas son imágenes de teselas HTTPS de `tile.openstreetmap.org`.
- Se deniegan permisos, navegación externa, ventanas nuevas y webviews.
- La conexión local no contiene credenciales ni se envía al renderer. No se guardan secretos en el proyecto.

La configuración sigue las [recomendaciones oficiales de seguridad de Electron](https://www.electronjs.org/docs/latest/tutorial/security/). El laboratorio usa una base local; si adaptás la conexión a un servidor autenticado, mantené sus secretos exclusivamente en el proceso principal.

## 10. Archivos principales

```text
package.json / package-lock.json     Dependencias y comandos reproducibles
src/main.js                        Ventana, protocolo seguro y emisores IPC
src/preload.js                     Puente con métodos específicos
src/database.js                    Driver, índices y consultas MongoDB
src/validation.js                  Validación independiente del renderer
src/renderer/index.html            Panel y formularios
src/renderer/styles.css            Diseño de la interfaz
src/renderer/tailwind.input.css    Entrada de Tailwind
src/renderer/app.js                Mapa, gráfico, CRUD y polling
scripts/build.js                   Compila CSS y copia Leaflet localmente
scripts/seed-data.js / seed.js      Datos sintéticos y carga idempotente
scripts/consultas.mongosh.js        Ejemplos de lectura ejecutables
scripts/smoke-electron.js           Verificación con la ventana real
test/                              Pruebas unitarias e integración real
```

`vendor/` y `tailwind.css` se generan con `npm run build`, que también se ejecuta antes de abrir la aplicación.

## 11. Verificación

```powershell
npm test
npm run test:integration
npm run test:electron
```

Las pruebas unitarias verifican validación e IDs estables del seed. La integración requiere MongoDB activo y usa una base temporal `observatorio_test_...` que elimina al finalizar. Verifica CRUD, filtros, índices, `$near`, agregación, preservación del seed y cambios desde una conexión independiente.

La prueba Electron abre ventanas de prueba con las protecciones de producción y crea una estación temporal `E2E-...` en la base del observatorio. Verifica polling de cambios externos, CRUD del formulario, filtros, texto potencialmente malicioso, rechazo de IPC ajeno, gráfico, mapa, geografía e índices. Elimina sus documentos al terminar y genera capturas en `artifacts/`. No modifica las estaciones del seed. Evitá editar la estación temporal mientras corre esta prueba.

## Problemas frecuentes

| Síntoma | Cómo resolverlo |
| --- | --- |
| “Sin conexión” | Iniciá el servicio MongoDB y comprobá `127.0.0.1:27017`. Electron reintenta sin recargar. |
| Colección vacía | Ejecutá `npm run seed` explícitamente o creá una medición. |
| Compass cambia un documento y el marcador no cambia | Comprobá filtros y orden por fecha. El marcador muestra la última medición que cumple los filtros. |
| “Document failed validation” en Compass | Conservá los campos obligatorios, los números y el tipo BSON Date de `fecha`. |
| Índice geográfico no se puede crear | Revisá Point, el orden longitud/latitud y las coordenadas de documentos existentes. |
| Fondo del mapa sin calles | Las teselas requieren Internet. El panel sigue consultando la base local y muestra un aviso. |
| Electron descarga su binario al primer inicio | Esperá la descarga inicial de Electron; necesitás acceso a Internet. |
| PowerShell impide `npm.ps1` | Usá `npm.cmd install`, `npm.cmd run seed` y `npm.cmd start`. |
| Fecha inesperada | El panel y formularios usan hora de Argentina; BSON Date guarda el instante en UTC. |

El mapa acredita a [OpenStreetMap y sus colaboradores](https://www.openstreetmap.org/copyright). Tailwind se compila con la [CLI oficial](https://tailwindcss.com/docs/installation/tailwind-cli), sin CDN en ejecución.
