// Frontend de la aplicación de consulta de stock y precios.
//
// Esta versión utiliza funciones serverless alojadas en `/api` dentro del mismo
// proyecto para comunicarse con ChessERP. De este modo el navegador no
// realiza peticiones cruzadas (CORS) hacia `simpledistribuciones.chesserp.com`,
// sino que todas las llamadas se hacen a nuestro propio dominio. Las
// funciones del directorio `api` manejan la autenticación y las llamadas a
// ChessERP en el servidor, evitando los problemas de CORS.

// Lista de artículos en memoria para autocompletar
let articlesList = null;

// Conjuntos de claves conocidos que devuelve la API de ChessERP. El objetivo
// es hacer el código más tolerante a las variaciones entre endpoints
// (por ejemplo `desArticulo` vs `descripcion`).
const ARTICLE_CONTAINER_KEYS = [
  'articulo',
  'articulos',
  'eArticulos',
  'data',
  'items',
  'results',
  'lista',
  'value',
];
const PRICE_CONTAINER_KEYS = [
  'articulos',
  'articulo',
  'precios',
  'items',
  'lista',
  'detalle',
  'data',
  'resultado',
  'resultados',
];
const STOCK_CONTAINER_KEYS = [
  'stock',
  'stocks',
  'eStockFisico',
  'existencias',
  'items',
  'data',
  'detalle',
  'resultado',
  'resultados',
];

const ARTICLE_ID_KEYS = [
  'idarticulo',
  'id_articulo',
  'idArticulo',
  'articulo',
  'codarticulo',
  'codArticulo',
];
const DESCRIPTION_KEYS = [
  'desarticulo',
  'desArticulo',
  'dsarticulo',
  'dsArticulo',
  'descripcion',
  'descripcionarticulo',
  'descripcionArticulo',
  'desCortaArticulo',
  'descArticulo',
  'descripcionCorta',
];
const UNITS_PER_PACK_KEYS = [
  'unidadesbulto',
  'unidadesBulto',
  'unibulto',
  'uniBulto',
  'unidadbulto',
  'unidadBulto',
  'cantxbulto',
  'cantXBulto',
  'cantbulto',
  'cantBulto',
  'cantidadxbulto',
  'cantidadXBulto',
  'cantidadbulto',
  'cantidadBulto',
  'cantidadBultos',
  'presentacion',
];
const PRICE_BASE_KEYS = [
  'preciobase',
  'precioBase',
  'preciolista',
  'precioLista',
  'precio',
  'precioSinIva',
  'importeBase',
  'importe',
];
const PRICE_FINAL_KEYS = [
  'preciofinal',
  'precioFinal',
  'precioneto',
  'precioNeto',
  'precioconiva',
  'precioConIva',
  'precio',
  'importeFinal',
  'importeConIva',
];
const STOCK_BULTOS_KEYS = [
  'cantbultos',
  'cantBultos',
  'cantbulto',
  'cantBulto',
  'stockbultos',
  'stockBultos',
  'stockbulto',
  'stockBulto',
  'bultos',
  'cantidadBultos',
];
const STOCK_UNITS_KEYS = [
  'cantunidades',
  'cantUnidades',
  'stockunidades',
  'stockUnidades',
  'unidades',
  'cantidadUnidades',
  'existencia',
  'existencias',
  'stock',
  'cantidad',
];

/**
 * Devuelve el primer valor no vacío de un objeto que coincida con las claves
 * especificadas. Se realiza la comparación de forma case-insensitive y, si no
 * se encuentra un match exacto, se buscan claves que contengan el nombre
 * proporcionado (por ejemplo `cantidadXBulto`).
 * @param {object|null|undefined} source
 * @param {string[]} keys
 * @returns {*|undefined}
 */
function pickField(source, keys) {
  if (!source || typeof source !== 'object') return undefined;
  const entries = Object.entries(source);
  const loweredEntries = entries.map(([k, v]) => [k.toLowerCase(), v]);
  for (const key of keys) {
    const lowerKey = key.toLowerCase();
    const directMatch = loweredEntries.find(([entryKey]) => entryKey === lowerKey);
    if (directMatch) {
      const value = directMatch[1];
      if (value !== undefined && value !== null && value !== '') return value;
    }
  }
  // Segundo intento: coincidencia parcial (útil para claves como `cantidadXBulto`).
  for (const key of keys) {
    const lowerKey = key.toLowerCase();
    const partialMatch = entries.find(([entryKey, value]) => {
      if (value === undefined || value === null || value === '') return false;
      return entryKey.toLowerCase().includes(lowerKey);
    });
    if (partialMatch) {
      return partialMatch[1];
    }
  }
  return undefined;
}

function hasRelevantInfo(candidate) {
  if (!candidate || typeof candidate !== 'object') return false;
  const keyGroups = [
    ARTICLE_ID_KEYS,
    DESCRIPTION_KEYS,
    UNITS_PER_PACK_KEYS,
    PRICE_BASE_KEYS,
    PRICE_FINAL_KEYS,
    STOCK_BULTOS_KEYS,
    STOCK_UNITS_KEYS,
  ];
  return keyGroups.some((keys) => pickField(candidate, keys) !== undefined);
}

/**
 * Dado un payload con estructura variable, intenta obtener el elemento
 * principal (primer artículo, precio o stock). Se exploran las claves
 * indicadas y cualquier otro valor que contenga objetos o arrays.
 * @param {*} payload
 * @param {string[]} containerKeys
 * @returns {object|null}
 */
function resolvePrimaryEntry(payload, containerKeys = []) {
  if (!payload) return null;
  if (Array.isArray(payload)) {
    for (const item of payload) {
      const resolved = resolvePrimaryEntry(item, containerKeys);
      if (resolved) return resolved;
    }
    return null;
  }
  if (typeof payload !== 'object') return null;

  if (hasRelevantInfo(payload)) {
    return payload;
  }

  for (const key of containerKeys) {
    const directKey = Object.keys(payload).find(
      (entryKey) => entryKey.toLowerCase() === key.toLowerCase()
    );
    if (directKey !== undefined) {
      const resolved = resolvePrimaryEntry(payload[directKey], containerKeys);
      if (resolved && hasRelevantInfo(resolved)) return resolved;
    }
  }

  for (const value of Object.values(payload)) {
    if (value && typeof value === 'object') {
      const resolved = resolvePrimaryEntry(value, containerKeys);
      if (resolved && hasRelevantInfo(resolved)) return resolved;
    }
  }

  return null;
}

/**
 * Convierte un payload arbitrario en una lista de elementos para autocompletado.
 * Busca arrays en las claves indicadas y, si no encuentra ninguno, devuelve un
 * array con el propio payload (cuando contiene información útil).
 * @param {*} payload
 * @param {string[]} containerKeys
 * @returns {object[]}
 */
function unwrapArray(payload, containerKeys = []) {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;

  for (const key of containerKeys) {
    if (payload[key] !== undefined) {
      const nested = unwrapArray(payload[key], containerKeys);
      if (nested.length) return nested;
    }
  }

  for (const value of Object.values(payload)) {
    if (Array.isArray(value)) {
      return value;
    }
  }

  return typeof payload === 'object' ? [payload] : [];
}

/**
 * Devuelve un valor formateado o 'N/D' si está vacío.
 * @param {*} value
 * @returns {string|number}
 */
function displayValue(value) {
  return value === undefined || value === null || value === '' ? 'N/D' : value;
}

/**
 * Descarga la lista de artículos desde el servidor backend (`/api/articulos`).
 * Este endpoint devuelve todos los artículos no anulados. Se almacena en
 * `articlesList` para reutilizar en las sugerencias.
 */
async function loadAllArticles() {
  if (articlesList) return;
  const response = await fetch('/api/articulos');
  if (!response.ok) {
    throw new Error('Error al obtener artículos');
  }
  const data = await response.json();
  const rawList = unwrapArray(data, ARTICLE_CONTAINER_KEYS);
  articlesList = rawList
    .map((item) => resolvePrimaryEntry(item, ARTICLE_CONTAINER_KEYS) || item)
    .filter((item) => item && typeof item === 'object');
}

/**
 * Solicita los datos de un artículo por su ID al servidor backend.
 * @param {string|number} articleId
 */
async function fetchArticle(articleId) {
  const response = await fetch(`/api/articulo?id=${encodeURIComponent(articleId)}`);
  if (!response.ok) {
    throw new Error('Error consultando artículo');
  }
  return response.json();
}

/**
 * Solicita el stock de un artículo al servidor backend. El depósito predeterminado
 * se define en la función del backend.
 * @param {string|number} articleId
 */
async function fetchStock(articleId) {
  const response = await fetch(`/api/stock?id=${encodeURIComponent(articleId)}`);
  if (!response.ok) {
    throw new Error('Error consultando stock');
  }
  return response.json();
}

/**
 * Solicita el precio de un artículo al servidor backend. Por defecto utiliza
 * la lista de precios 4 y la fecha actual.
 * @param {string|number} articleId
 */
async function fetchPrice(articleId) {
  const response = await fetch(`/api/precio?id=${encodeURIComponent(articleId)}`);
  if (!response.ok) {
    throw new Error('Error consultando precio');
  }
  return response.json();
}

/**
 * Muestra en pantalla la información del artículo, precio y stock recibidos.
 * Si no hay datos, oculta el div de resultados.
 */
function renderResult(data) {
  const resultDiv = document.getElementById('result');
  if (!data) {
    resultDiv.style.display = 'none';
    return;
  }

  const article = resolvePrimaryEntry(data.article, ARTICLE_CONTAINER_KEYS) || null;
  const price = resolvePrimaryEntry(data.price, PRICE_CONTAINER_KEYS) || null;
  const stock = resolvePrimaryEntry(data.stock, STOCK_CONTAINER_KEYS) || null;

  const description = pickField(article, DESCRIPTION_KEYS) || 'Artículo sin descripción';
  let unitsPerPack = pickField(article, UNITS_PER_PACK_KEYS);
  if (unitsPerPack === undefined) {
    const presentacion = pickField(article, ['presentacion']);
    if (presentacion && typeof presentacion === 'object') {
      unitsPerPack = pickField(presentacion, [
        'cantidad',
        'cantidadBulto',
        'cantidadXBulto',
        'cantXBulto',
      ]);
    }
  }
  const priceBase = pickField(price, PRICE_BASE_KEYS);
  const priceFinal = pickField(price, PRICE_FINAL_KEYS);
  const stockBultos = pickField(stock, STOCK_BULTOS_KEYS);
  const stockUnidades = pickField(stock, STOCK_UNITS_KEYS);

  resultDiv.innerHTML = `
    <h3>${description}</h3>
    <p><strong>Unidades por bulto:</strong> ${displayValue(unitsPerPack)}</p>
    <p><strong>Precio base:</strong> ${displayValue(priceBase)}</p>
    <p><strong>Precio final:</strong> ${displayValue(priceFinal)}</p>
    <p><strong>Stock en bultos:</strong> ${displayValue(stockBultos)}</p>
    <p><strong>Stock en unidades:</strong> ${displayValue(stockUnidades)}</p>
  `;
  resultDiv.style.display = 'block';
}

/**
 * Maneja el evento de búsqueda. Obtiene el ID ingresado, solicita datos al
 * backend y muestra los resultados.
 */
async function handleSearch(event) {
  event.preventDefault();
  const articleId = document.getElementById('articleInput').value.trim();
  if (!articleId) return;
  try {
    const [articulosResp, priceResp, stockResp] = await Promise.all([
      fetchArticle(articleId),
      fetchPrice(articleId),
      fetchStock(articleId),
    ]);
    const article =
      resolvePrimaryEntry(articulosResp, ARTICLE_CONTAINER_KEYS) ||
      (Array.isArray(articulosResp) ? articulosResp[0] : articulosResp);
    const price =
      resolvePrimaryEntry(priceResp, PRICE_CONTAINER_KEYS) ||
      (Array.isArray(priceResp) ? priceResp[0] || null : priceResp);
    const stock =
      resolvePrimaryEntry(stockResp, STOCK_CONTAINER_KEYS) ||
      (Array.isArray(stockResp) ? stockResp[0] || null : stockResp);
    renderResult({ article, price, stock });
  } catch (err) {
    alert(err.message);
    console.error(err);
    renderResult(null);
  }
}

// Asignamos el manejador al formulario de búsqueda
document.getElementById('searchForm').addEventListener('submit', handleSearch);

// Listener para autocompletado: cuando el usuario escribe, filtramos la lista
// de artículos y mostramos las primeras 5 coincidencias en el datalist. Si
// todavía no hemos descargado la lista completa la solicitamos al backend.
document.getElementById('articleInput').addEventListener('input', async (e) => {
  const term = e.target.value.trim().toLowerCase();
  const datalist = document.getElementById('articleSuggestions');
  if (!term) {
    datalist.innerHTML = '';
    return;
  }
  try {
    await loadAllArticles();
    const matches = articlesList
      .map((item) => resolvePrimaryEntry(item, ARTICLE_CONTAINER_KEYS) || item)
      .filter((item) => {
        const desc = (pickField(item, DESCRIPTION_KEYS) || '').toLowerCase();
        return desc.includes(term);
      })
      .slice(0, 5);
    datalist.innerHTML = matches
      .map((item) => {
        const label = pickField(item, DESCRIPTION_KEYS) || '';
        const value = pickField(item, ARTICLE_ID_KEYS) || '';
        if (!value && !label) return '';
        return `<option value="${value}" label="${label}"></option>`;
      })
      .join('');
  } catch (err) {
    console.error(err);
    datalist.innerHTML = '';
  }
});
