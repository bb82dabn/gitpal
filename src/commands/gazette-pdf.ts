import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { GazetteData, GazetteArticle } from "./digest.ts";

const HOME = homedir();
const SCREENSHOTS_DIR = join(HOME, ".gitpal", "screenshots");
const CHROMIUM_BIN = "/usr/bin/google-chrome-stable";

function esc(s: string | null | undefined): string {
  if (!s) return "";
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function imgBase64(src: string | null | undefined): string | null {
  if (!src) return null;
  const path = src.startsWith("/screenshots/")
    ? join(SCREENSHOTS_DIR, src.replace("/screenshots/", ""))
    : src;
  try {
    const b64 = readFileSync(path).toString("base64");
    return `data:image/png;base64,${b64}`;
  } catch { return null; }
}

function getArticleImgSrc(a: GazetteArticle): string | null {
  const ai = (a as any).aiGeneratedImage as string | undefined;
  if (ai) return imgBase64(ai);
  if (a.screenshot) return imgBase64(`/screenshots/${a.screenshot}`);
  return null;
}

// ── CSS ──────────────────────────────────────────────────────────────────

const CSS = `
@page { size: letter; margin: 0; }

* { box-sizing: border-box; margin: 0; padding: 0; }

body {
  font-family: 'EB Garamond', Georgia, serif;
  background: #fff; color: #111;
  font-size: 10.5pt; line-height: 1.5;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}

/* ── Page frame ─────────────────────────────────── */
.page {
  width: 8.5in; height: 11in;
  padding: 0.5in 0.55in 0.45in;
  position: relative;
  overflow: hidden;
  page-break-after: always;
}
.page:last-child { page-break-after: auto; }

/* ── Masthead (page 1 only) ─────────────────────── */
.masthead {
  text-align: center;
  border-bottom: 3px double #111;
  padding-bottom: 6px;
  margin-bottom: 10px;
}
.masthead-rule { border: none; border-top: 1px solid #111; margin: 0 0 4px; }
.masthead-title {
  font-family: 'UnifrakturMaguntia', serif;
  font-size: 44pt; line-height: 1; color: #000;
}
.masthead-deck {
  font-size: 8pt; letter-spacing: 0.18em;
  text-transform: uppercase; color: #555;
  padding: 4px 0 0;
}

/* ── Section headers (continuation pages) ──────── */
.page-header {
  font-family: 'Playfair Display', serif;
  font-size: 9pt; font-style: italic;
  color: #555; border-bottom: 1px solid #ccc;
  padding-bottom: 3px; margin-bottom: 12px;
  display: flex; justify-content: space-between;
}

/* ── Featured article (page 1 hero) ─────────────── */
.featured { margin-bottom: 14px; padding-bottom: 12px; border-bottom: 2px solid #111; }
.featured-headline {
  font-family: 'Playfair Display', serif;
  font-size: 22pt; font-style: italic; font-weight: 700;
  line-height: 1.12; margin-bottom: 8px;
}
.featured-layout { display: flex; gap: 14px; }
.featured-img {
  width: 2.4in; height: auto; max-height: 2in;
  object-fit: cover; border: 1px solid #ddd; flex-shrink: 0;
}
.featured-text { flex: 1; min-width: 0; }
.featured-body { font-size: 10.5pt; line-height: 1.55; }
.byline { font-size: 7.5pt; color: #888; margin-top: 6px; font-style: italic; }

/* ── Article grid ───────────────────────────────── */
.article-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px 16px;
}
.article-grid.three-col { grid-template-columns: 1fr 1fr 1fr; }

.article {
  break-inside: avoid;
  padding-bottom: 8px;
  border-bottom: 1px solid #ddd;
}
.article:last-child { border-bottom: none; }
.art-img {
  width: 100%; height: auto; max-height: 1.6in;
  object-fit: cover; display: block;
  margin-bottom: 6px; border: 1px solid #ddd;
}
.article-headline {
  font-family: 'Playfair Display', serif;
  font-size: 11pt; font-style: italic; font-weight: 700;
  line-height: 1.18; margin-bottom: 4px;
}
.article-body { font-size: 9pt; line-height: 1.5; }

/* ── Sidebar (compact, page 1 bottom or page 2) ── */
.sidebar-strip {
  display: flex; gap: 20px;
  border-top: 2px solid #111;
  padding-top: 8px; margin-top: auto;
  font-size: 8pt; color: #444;
}
.sidebar-strip .sb-section { flex: 1; }
.sb-title {
  font-size: 7pt; font-weight: 700;
  text-transform: uppercase; letter-spacing: 0.1em;
  border-bottom: 1px solid #111;
  padding-bottom: 2px; margin-bottom: 4px;
}
.sb-item { padding: 1px 0; }
.sb-ok { color: #2e7d32; }
.sb-warn { color: #c77700; }

/* ── Footer ─────────────────────────────────────── */
.footer {
  position: absolute; bottom: 0.35in; left: 0.55in; right: 0.55in;
  font-size: 7pt; font-style: italic; color: #aaa;
  text-align: center; border-top: 1px solid #ddd;
  padding-top: 4px;
}

/* ── Section divider ────────────────────────────── */
.section-rule { border: none; border-top: 2px double #111; margin: 10px 0 6px; }
.section-label {
  font-size: 7pt; font-style: italic;
  text-transform: uppercase; letter-spacing: 0.2em;
  text-align: center; color: #777; margin-bottom: 8px;
}
`;

// ── HTML builder ──────────────────────────────────────────────────────────

export function buildGazettePrintHtml(gazette: GazetteData): string {
  const allJoke = gazette.articles.length > 0 && gazette.articles.every(a => (a as any).joke);
  const featured = gazette.articles.find(a => a.featured) ?? gazette.articles[0];
  const others = gazette.articles.filter(a => a !== featured);
  const mainArticles = allJoke ? others : others.filter(a => !(a as any).joke);
  const comicsArticles = allJoke ? [] : others.filter(a => (a as any).joke);

  const fonts = "https://fonts.googleapis.com/css2?family=UnifrakturMaguntia&family=Playfair+Display:ital,wght@0,700;1,400;1,700&family=EB+Garamond:ital,wght@0,400;1,400&display=swap";

  let h = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">`;
  h += `<link rel="preconnect" href="https://fonts.googleapis.com">`;
  h += `<link href="${fonts}" rel="stylesheet">`;
  h += `<style>${CSS}</style></head><body>`;

  // ── PAGE 1: Masthead + Featured + first articles ──────────────────────
  h += `<div class="page">`;

  // Masthead
  h += `<div class="masthead"><hr class="masthead-rule">`;
  h += `<div class="masthead-title">The GitPal Gazette</div>`;
  h += `<div class="masthead-deck">${esc(gazette.date)} &middot; ${esc(gazette.edition)} &middot; GitPal Publishing Co.</div>`;
  h += `</div>`;

  // Featured article
  if (featured) {
    const fSrc = getArticleImgSrc(featured);
    h += `<div class="featured">`;
    h += `<div class="featured-headline">${esc(featured.headline)}</div>`;
    h += `<div class="featured-layout">`;
    if (fSrc) h += `<img class="featured-img" src="${fSrc}" alt="${esc(featured.project)}">`;
    h += `<div class="featured-text">`;
    h += `<p class="featured-body">${esc(featured.body)}</p>`;
    h += `<div class="byline">${esc(featured.project)}${(featured as any).joke ? ' · satire' : ''}</div>`;
    h += `</div></div></div>`;
  }

  // Split remaining articles across pages — ~4 per page with images, ~6 without
  const articlesPerPage1 = allJoke ? 4 : 4;
  const page1Articles = mainArticles.slice(0, articlesPerPage1);
  const remainingArticles = mainArticles.slice(articlesPerPage1);

  if (page1Articles.length > 0) {
    h += `<div class="article-grid">`;
    for (const a of page1Articles) {
      h += renderArticle(a);
    }
    h += `</div>`;
  }

  // Sidebar strip at bottom of page 1 (if no more pages needed)
  if (remainingArticles.length === 0 && comicsArticles.length === 0) {
    h += renderSidebarStrip(gazette);
  }

  h += `<div class="footer">The GitPal Gazette &middot; ${esc(gazette.edition)} &middot; ${esc(gazette.date)}</div>`;
  h += `</div>`; // end page 1

  // ── PAGE 2+: Remaining articles ───────────────────────────────────────
  let pageNum = 2;
  let remaining = [...remainingArticles];

  while (remaining.length > 0) {
    const batch = remaining.splice(0, 6); // ~6 articles per continuation page
    h += `<div class="page">`;
    h += `<div class="page-header"><span>The GitPal Gazette — ${esc(gazette.edition)}</span><span>Page ${pageNum}</span></div>`;
    h += `<div class="article-grid${batch.length >= 5 ? ' three-col' : ''}">`;
    for (const a of batch) {
      h += renderArticle(a);
    }
    h += `</div>`;

    // Add sidebar on last article page if comics follow, or here if not
    if (remaining.length === 0 && comicsArticles.length === 0) {
      h += renderSidebarStrip(gazette);
    }

    h += `<div class="footer">The GitPal Gazette &middot; Page ${pageNum}</div>`;
    h += `</div>`;
    pageNum++;
  }

  // ── COMICS PAGE (if mixed edition with joke articles) ─────────────────
  if (comicsArticles.length > 0) {
    h += `<div class="page">`;
    h += `<div class="page-header"><span>The GitPal Gazette — ${esc(gazette.edition)}</span><span>Page ${pageNum}</span></div>`;
    h += `<hr class="section-rule"><div class="section-label">Comics &amp; Oddities</div>`;
    h += `<div class="article-grid">`;
    for (const a of comicsArticles) {
      h += renderArticle(a);
    }
    h += `</div>`;
    h += renderSidebarStrip(gazette);
    h += `<div class="footer">The GitPal Gazette &middot; Page ${pageNum}</div>`;
    h += `</div>`;
  }

  h += `</body></html>`;
  return h;
}

function renderArticle(a: GazetteArticle): string {
  const src = getArticleImgSrc(a);
  let h = `<div class="article">`;
  if (src) h += `<img class="art-img" src="${src}" alt="${esc(a.project)}">`;
  h += `<div class="article-headline">${esc(a.headline)}</div>`;
  h += `<p class="article-body">${esc(a.body)}</p>`;
  h += `<div class="byline">${esc(a.project)}${(a as any).joke ? ' · satire' : ''}</div>`;
  h += `</div>`;
  return h;
}

function renderSidebarStrip(gazette: GazetteData): string {
  let h = `<div class="sidebar-strip">`;

  // Uncommitted
  h += `<div class="sb-section"><div class="sb-title">On the Desk</div>`;
  if (gazette.uncommitted?.length) {
    for (const u of gazette.uncommitted) {
      h += `<div class="sb-item"><strong>${esc(u.name)}</strong> — ${u.changes} file(s)</div>`;
    }
  } else {
    h += `<div class="sb-item" style="color:#999;font-style:italic">All clear.</div>`;
  }
  h += `</div>`;

  // Infrastructure
  if (gazette.health) {
    const c = gazette.health.containers;
    const d = gazette.health.disk;
    h += `<div class="sb-section"><div class="sb-title">Infrastructure</div>`;
    h += c.unhealthy > 0
      ? `<div class="sb-item sb-warn">${c.unhealthy} unhealthy / ${c.total}</div>`
      : `<div class="sb-item sb-ok">${c.total} containers healthy</div>`;
    if (d) h += `<div class="sb-item">Disk: ${esc(d.text)}</div>`;
    h += `</div>`;
  }

  // Stats
  if (gazette.totalCommits) {
    h += `<div class="sb-section"><div class="sb-title">By the Numbers</div>`;
    h += `<div class="sb-item">${gazette.totalCommits} commits · ${gazette.totalProjects} projects</div>`;
    h += `</div>`;
  }

  h += `</div>`;
  return h;
}

// ── PDF generator ─────────────────────────────────────────────────────────

export async function generateGazettePdf(
  gazette: GazetteData,
  archiveDayDir: string,
  editionKey: string,
): Promise<string | null> {
  const tmpHtml = `/tmp/gazette-${editionKey}-print.html`;
  const tmpPdf = `/tmp/gazette-${editionKey}.pdf`;
  const finalPdf = join(archiveDayDir, `${editionKey}.pdf`);
  try {
    writeFileSync(tmpHtml, buildGazettePrintHtml(gazette));
    const proc = Bun.spawn([
      CHROMIUM_BIN,
      "--headless",
      "--disable-gpu",
      "--no-sandbox",
      "--run-all-compositor-stages-before-draw",
      `--print-to-pdf=${tmpPdf}`,
      "--print-to-pdf-no-header",
      `file://${tmpHtml}`,
    ], { stdout: "ignore", stderr: "ignore" });
    const timer = setTimeout(() => proc.kill(), 90_000);
    await proc.exited;
    clearTimeout(timer);
    try { Bun.spawnSync(["rm", "-f", tmpHtml]); } catch {}
    if (existsSync(tmpPdf)) {
      Bun.spawnSync(["mv", tmpPdf, finalPdf]);
      if (existsSync(finalPdf)) return finalPdf;
    }
    return null;
  } catch {
    try { Bun.spawnSync(["rm", "-f", tmpHtml, tmpPdf]); } catch {}
    return null;
  }
}
