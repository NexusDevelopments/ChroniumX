const MAX_PAGES = 25;
const MAX_ASSETS = 250;
const MAX_FILE_CHARS = 200_000;
const MAX_TOTAL_CHARS = 2_000_000;
const FETCH_TIMEOUT_MS = 12_000;
const RENDER_TIMEOUT_MS = 20_000;

function json(status, payload) {
  return {
    statusCode: status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "content-type",
    },
    body: JSON.stringify(payload),
  };
}

function slugFromHost(hostname) {
  const base = hostname
    .toLowerCase()
    .replace(/^www\./, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return base || "site";
}

function makePagePath(urlObj) {
  const pathname = urlObj.pathname || "/";

  if (pathname === "/") {
    return "index.html";
  }

  if (pathname.endsWith("/")) {
    return `${pathname.slice(1)}index.html`;
  }

  const last = pathname.split("/").pop() || "";
  if (last.includes(".")) {
    return pathname.slice(1);
  }

  return `${pathname.slice(1)}/index.html`;
}

function makeAssetPath(urlObj, sourceOrigin) {
  const cleanPath = (urlObj.pathname || "/").replace(/^\/+/, "") || "index";
  const host = urlObj.host.toLowerCase();

  if (urlObj.origin === sourceOrigin) {
    return cleanPath;
  }

  return `external/${host}/${cleanPath}`;
}

function detectType(pathname) {
  const lower = pathname.toLowerCase();

  if (lower.endsWith(".html") || lower.endsWith(".htm")) return "html";
  if (lower.endsWith(".css")) return "css";
  if (lower.endsWith(".js") || lower.endsWith(".mjs") || lower.endsWith(".cjs")) return "js";
  return "text";
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function extractLinks(html, pageUrl) {
  const pageLinks = [];
  const assetLinks = [];

  const anchorRe = /<a\s+[^>]*href\s*=\s*["']([^"'#]+)["'][^>]*>/gi;
  const styleRe = /<link\s+[^>]*href\s*=\s*["']([^"']+)["'][^>]*>/gi;
  const scriptRe = /<script\s+[^>]*src\s*=\s*["']([^"']+)["'][^>]*>/gi;
  const mediaRe = /<(?:img|source|video|audio|iframe)\s+[^>]*src\s*=\s*["']([^"']+)["'][^>]*>/gi;
  const importFromRe = /\bfrom\s*["']([^"']+)["']/gi;
  const dynamicImportRe = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/gi;
  const cssUrlRe = /url\(\s*["']?([^"')]+)["']?\s*\)/gi;

  let match;

  while ((match = anchorRe.exec(html)) !== null) {
    pageLinks.push(match[1]);
  }

  while ((match = styleRe.exec(html)) !== null) {
    assetLinks.push(match[1]);
  }

  while ((match = scriptRe.exec(html)) !== null) {
    assetLinks.push(match[1]);
  }

  while ((match = mediaRe.exec(html)) !== null) {
    assetLinks.push(match[1]);
  }

  while ((match = importFromRe.exec(html)) !== null) {
    assetLinks.push(match[1]);
  }

  while ((match = dynamicImportRe.exec(html)) !== null) {
    assetLinks.push(match[1]);
  }

  while ((match = cssUrlRe.exec(html)) !== null) {
    assetLinks.push(match[1]);
  }

  const toAbsolute = (value) => {
    try {
      return new URL(value, pageUrl).toString();
    } catch {
      return null;
    }
  };

  return {
    pageLinks: pageLinks.map(toAbsolute).filter(Boolean),
    assetLinks: assetLinks.map(toAbsolute).filter(Boolean),
  };
}

async function fetchText(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
        accept: "text/html,text/css,application/javascript,text/javascript,*/*;q=0.1",
        "accept-language": "en-US,en;q=0.9",
        "cache-control": "no-cache",
        pragma: "no-cache",
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const text = await response.text();
    const contentType = response.headers.get("content-type") || "";

    return { text, contentType };
  } finally {
    clearTimeout(timer);
  }
}

function detectShellHtml(html) {
  const body = String(html || "").toLowerCase();
  const scriptTags = (body.match(/<script\b/g) || []).length;
  const hasAppRoot = /id=["'](?:app|root|__next|__nuxt|svelte|\w*react\w*)["']/.test(body);
  const hasHydrationMarkers = body.includes("__next_data__")
    || body.includes("window.__initial_state")
    || body.includes("hydrate(")
    || body.includes("createroot(")
    || body.includes("webpackchunk")
    || body.includes("window.__sentry")
    || body.includes("window.gon")
    || body.includes("data-reactroot");
  const shortText = body.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<style[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, " ").trim().length < 260;
  return (scriptTags >= 6 && hasAppRoot) || hasHydrationMarkers || (hasAppRoot && shortText);
}

async function fetchProxyRenderedSnapshot(url) {
  const clean = String(url || "").replace(/^https?:\/\//i, "");
  const response = await fetch(`https://r.jina.ai/http://${clean}`);
  if (!response.ok) {
    throw new Error(`Proxy renderer HTTP ${response.status}`);
  }

  const text = await response.text();
  const trimmed = text.trim();
  if (!trimmed || trimmed.length < 120) {
    throw new Error("Proxy renderer returned empty content");
  }

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8" /><title>Rendered Snapshot</title><style>body{margin:0;padding:20px;background:#0d0d0d;color:#e8e8e8;font-family:monospace;line-height:1.55;} pre{white-space:pre-wrap;word-break:break-word;background:#121212;border:1px solid #2a2a2a;padding:14px;border-radius:6px;}</style></head><body><h1>Rendered Snapshot</h1><pre>${escapeHtml(trimmed)}</pre></body></html>`;
  return { text: html, contentType: "text/html" };
}

async function fetchRenderedHtml(url) {
  const endpoint = String(process.env.BROWSER_RENDER_ENDPOINT || process.env.BROWSERLESS_REST_URL || "").trim();
  const token = String(process.env.BROWSER_RENDER_TOKEN || process.env.BROWSERLESS_TOKEN || "").trim();

  if (!endpoint || !token) {
    throw new Error("Renderer not configured");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RENDER_TIMEOUT_MS);

  try {
    const joiner = endpoint.includes("?") ? "&" : "?";
    const renderUrl = `${endpoint}${joiner}token=${encodeURIComponent(token)}`;
    const response = await fetch(renderUrl, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        accept: "text/html,application/json;q=0.9,*/*;q=0.1",
      },
      body: JSON.stringify({
        url,
        gotoOptions: { waitUntil: "networkidle2", timeout: RENDER_TIMEOUT_MS },
      }),
    });

    if (!response.ok) {
      throw new Error(`Renderer HTTP ${response.status}`);
    }

    const text = await response.text();
    const contentType = response.headers.get("content-type") || "text/html";
    return { text, contentType };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchPageHtml(url, renderJs, warnings) {
  const initial = await fetchText(url);
  if (!renderJs) {
    return { text: initial.text, rendered: false };
  }

  if (!detectShellHtml(initial.text)) {
    return { text: initial.text, rendered: false };
  }

  try {
    const rendered = await fetchRenderedHtml(url);
    return { text: rendered.text, rendered: true };
  } catch (error) {
    warnings.push(`Primary renderer fallback skipped for ${url}: ${error.message}`);
  }

  try {
    const snapshot = await fetchProxyRenderedSnapshot(url);
    return { text: snapshot.text, rendered: true };
  } catch (error) {
    warnings.push(`Proxy renderer fallback skipped for ${url}: ${error.message}`);
    return { text: initial.text, rendered: false };
  }
}

function pushFile(filesMap, fileRecord, counters, warnings) {
  if (!fileRecord.content) {
    return;
  }

  if (fileRecord.content.length > MAX_FILE_CHARS) {
    warnings.push(`Skipped large file: ${fileRecord.path}`);
    return;
  }

  if (counters.totalChars + fileRecord.content.length > MAX_TOTAL_CHARS) {
    warnings.push("Reached total size limit while saving files.");
    return;
  }

  const existing = filesMap.get(fileRecord.path);
  if (existing) {
    counters.totalChars -= existing.content.length;
  }

  counters.totalChars += fileRecord.content.length;
  filesMap.set(fileRecord.path, {
    path: fileRecord.path,
    type: fileRecord.type,
    sourceUrl: fileRecord.sourceUrl,
    size: fileRecord.content.length,
    content: fileRecord.content,
  });
}

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") {
    const data = json(204, {});
    res.statusCode = data.statusCode;
    Object.entries(data.headers).forEach(([k, v]) => res.setHeader(k, v));
    res.end(data.body);
    return;
  }

  if (req.method !== "POST") {
    const data = json(405, { error: "Use POST for /api/scrape" });
    res.statusCode = data.statusCode;
    Object.entries(data.headers).forEach(([k, v]) => res.setHeader(k, v));
    res.end(data.body);
    return;
  }

  let body;
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
  } catch {
    const data = json(400, { error: "Invalid JSON body" });
    res.statusCode = data.statusCode;
    Object.entries(data.headers).forEach(([k, v]) => res.setHeader(k, v));
    res.end(data.body);
    return;
  }

  const target = String(body.url || "").trim();

  let startUrl;
  try {
    startUrl = new URL(target);
    if (!(startUrl.protocol === "http:" || startUrl.protocol === "https:")) {
      throw new Error("Invalid protocol");
    }
  } catch {
    const data = json(400, { error: "Provide a valid http/https URL." });
    res.statusCode = data.statusCode;
    Object.entries(data.headers).forEach(([k, v]) => res.setHeader(k, v));
    res.end(data.body);
    return;
  }

  const pageLimit = Math.max(1, Math.min(Number(body.maxPages) || 10, MAX_PAGES));
  const assetLimit = Math.max(1, Math.min(Number(body.maxAssets) || 80, MAX_ASSETS));
  const maxDepth = Math.max(1, Math.min(Number(body.maxDepth) || 3, 10));
  const sameOriginAssetsOnly = body.sameOriginAssetsOnly !== false;
  const renderJs = body.renderJs !== false;
  const isKnownJsHeavy = /(^|\.)discord\.|(^|\.)instagram\.|(^|\.)tiktok\./i.test(startUrl.hostname);
  const effectiveSameOriginAssetsOnly = isKnownJsHeavy ? false : sameOriginAssetsOnly;

  const slug = slugFromHost(startUrl.hostname);
  const sourceOrigin = startUrl.origin;

  const filesMap = new Map();
  const visitedPages = new Set();
  const queuedPages = [{ url: startUrl.toString(), depth: 0 }];
  const assetQueue = [];
  const seenAssets = new Set();
  const warnings = [];
  const counters = { totalChars: 0 };
  let fetchedAssets = 0;
  let processedAssets = 0;

  const sendEvent = (event) => {
    res.write(`${JSON.stringify(event)}\n`);
  };

  res.statusCode = 200;
  res.setHeader("content-type", "application/x-ndjson; charset=utf-8");
  res.setHeader("cache-control", "no-cache, no-transform");
  res.setHeader("x-accel-buffering", "no");
  if (typeof res.flushHeaders === "function") {
    res.flushHeaders();
  }

  sendEvent({
    type: "start",
    slug,
    pageLimit,
    assetLimit,
    maxDepth,
    sameOriginAssetsOnly: effectiveSameOriginAssetsOnly,
    renderJs,
    aggressiveProfile: isKnownJsHeavy,
  });

  while (queuedPages.length > 0 && visitedPages.size < pageLimit) {
    const currentEntry = queuedPages.shift();
    const currentUrl = currentEntry && currentEntry.url;
    const currentDepth = currentEntry && typeof currentEntry.depth === "number" ? currentEntry.depth : 0;
    let rendered = false;
    if (!currentUrl || visitedPages.has(currentUrl)) {
      continue;
    }

    visitedPages.add(currentUrl);

    try {
      const pageResult = await fetchPageHtml(currentUrl, renderJs, warnings);
      const text = pageResult.text;
      rendered = !!pageResult.rendered;
      const currentObj = new URL(currentUrl);
      const pagePath = makePagePath(currentObj);

      pushFile(
        filesMap,
        {
          path: pagePath,
          type: "html",
          sourceUrl: currentUrl,
          content: text,
        },
        counters,
        warnings
      );

      const { pageLinks, assetLinks } = extractLinks(text, currentUrl);

      for (const pageLink of pageLinks) {
        try {
          const pageObj = new URL(pageLink);
          if (pageObj.origin !== sourceOrigin) continue;
          if (!["http:", "https:"].includes(pageObj.protocol)) continue;
          const normalized = pageObj.toString();
          if (currentDepth + 1 < maxDepth && !visitedPages.has(normalized) && !queuedPages.some((entry) => entry.url === normalized)) {
            queuedPages.push({ url: normalized, depth: currentDepth + 1 });
          }
        } catch {
          // Ignore malformed links.
        }
      }

      for (const assetLink of assetLinks) {
        if (seenAssets.has(assetLink)) continue;
        seenAssets.add(assetLink);
        assetQueue.push(assetLink);
      }
    } catch (error) {
      warnings.push(`Failed page: ${currentUrl} (${error.message})`);
    }

    sendEvent({
      type: "page",
      url: currentUrl,
      rendered,
      pagesVisited: visitedPages.size,
      pageLimit,
      assetsProcessed: processedAssets,
      assetLimit,
    });
  }

  for (const assetUrl of assetQueue) {
    if (fetchedAssets >= assetLimit) break;
    processedAssets += 1;

    let obj;
    try {
      obj = new URL(assetUrl);
    } catch {
      sendEvent({
        type: "asset",
        url: assetUrl,
        saved: false,
        assetsProcessed: processedAssets,
        assetLimit,
        pagesVisited: visitedPages.size,
        pageLimit,
      });
      continue;
    }

    if (!["http:", "https:"].includes(obj.protocol)) {
      sendEvent({
        type: "asset",
        url: assetUrl,
        saved: false,
        assetsProcessed: processedAssets,
        assetLimit,
        pagesVisited: visitedPages.size,
        pageLimit,
      });
      continue;
    }

    if (effectiveSameOriginAssetsOnly && obj.origin !== sourceOrigin) {
      sendEvent({
        type: "asset",
        url: assetUrl,
        saved: false,
        error: "Skipped external asset due to same-origin filter.",
        assetsProcessed: processedAssets,
        assetLimit,
        pagesVisited: visitedPages.size,
        pageLimit,
      });
      continue;
    }

    const assetPath = makeAssetPath(obj, sourceOrigin);
    const guessedType = detectType(assetPath);
    if (!(guessedType === "css" || guessedType === "js")) {
      sendEvent({
        type: "asset",
        url: assetUrl,
        saved: false,
        assetsProcessed: processedAssets,
        assetLimit,
        pagesVisited: visitedPages.size,
        pageLimit,
      });
      continue;
    }

    try {
      const { text, contentType } = await fetchText(assetUrl);
      const lowerContentType = contentType.toLowerCase();

      if (
        guessedType === "css" &&
        !lowerContentType.includes("css") &&
        !assetPath.toLowerCase().endsWith(".css")
      ) {
        continue;
      }

      if (
        guessedType === "js" &&
        !lowerContentType.includes("javascript") &&
        !lowerContentType.includes("ecmascript") &&
        !assetPath.toLowerCase().endsWith(".js")
      ) {
        continue;
      }

      pushFile(
        filesMap,
        {
          path: assetPath,
          type: guessedType,
          sourceUrl: assetUrl,
          content: text,
        },
        counters,
        warnings
      );
      fetchedAssets += 1;
      sendEvent({
        type: "asset",
        url: assetUrl,
        path: assetPath,
        saved: true,
        assetsProcessed: processedAssets,
        assetLimit,
        pagesVisited: visitedPages.size,
        pageLimit,
      });
    } catch (error) {
      warnings.push(`Failed asset: ${assetUrl} (${error.message})`);
      sendEvent({
        type: "asset",
        url: assetUrl,
        saved: false,
        error: error.message,
        assetsProcessed: processedAssets,
        assetLimit,
        pagesVisited: visitedPages.size,
        pageLimit,
      });
    }
  }

  const files = Array.from(filesMap.values()).sort((a, b) => a.path.localeCompare(b.path));

  const data = json(200, {
    slug,
    sourceUrl: startUrl.toString(),
    createdAt: new Date().toISOString(),
    stats: {
      pagesVisited: visitedPages.size,
      assetsFound: seenAssets.size,
      assetsProcessed: processedAssets,
      assetsSaved: fetchedAssets,
      filesSaved: files.length,
      totalChars: counters.totalChars,
      pageLimit,
      assetLimit,
      maxDepth,
      sameOriginAssetsOnly: effectiveSameOriginAssetsOnly,
      renderJs,
      aggressiveProfile: isKnownJsHeavy,
    },
    warnings,
    files,
  });

  sendEvent({
    type: "done",
    payload: JSON.parse(data.body),
  });
  res.end();
};
