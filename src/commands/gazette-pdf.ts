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

function imgTag(src: string | null | undefined, cls: string, alt: string): string {
  if (!src) return "";
  if (src.startsWith("/screenshots/")) {
    const p = join(SCREENSHOTS_DIR, src.replace("/screenshots/", ""));
    try {
      const b64 = readFileSync(p).toString("base64");
      return `<img class="${cls}" src="data:image/png;base64,${b64}" alt="${esc(alt)}">`;
    } catch { return ""; }
  }
  return `<img class="${cls}" src="${esc(src)}" alt="${esc(alt)}">`;
}

function articleImg(a: GazetteArticle): string {
  const ai = (a as any).aiGeneratedImage as string | undefined;
  if (ai) return imgTag(ai, "art-img", a.project);
  if (a.screenshot) return imgTag(`/screenshots/${a.screenshot}`, "art-img", a.project);
  return "";
}

const CSS = `
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: 'EB Garamond', Georgia, serif; background: #fff; color: #111; font-size: 11pt; line-height: 1.55; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.page { width: 8.5in; min-height: 11in; margin: 0 auto; padding: 0.55in 0.6in 0.6in; }
.masthead { text-align: center; border-bottom: 3px double #111; padding-bottom: 8px; margin-bottom: 4px; }
.masthead-rule { border: none; border-top: 1px solid #111; margin: 0 0 6px; }
.masthead-title { font-family: 'UnifrakturMaguntia', serif; font-size: 52pt; line-height: 1; color: #000; }
.masthead-deck { font-size: 9pt; letter-spacing: 0.18em; text-transform: uppercase; color: #555; padding: 5px 0 0; }
.body-wrap { display: grid; grid-template-columns: 1fr 1.8in; gap: 18pt; margin-top: 16pt; }
.main { min-width: 0; }
.sidebar { border-left: 1px solid #ccc; padding-left: 12pt; font-size: 9pt; }
.featured { border-bottom: 2px solid #111; padding-bottom: 14pt; margin-bottom: 14pt; }
.featured-headline { font-family: 'Playfair Display', serif; font-size: 24pt; font-style: italic; font-weight: 700; line-height: 1.15; margin-bottom: 10pt; }
.featured-inner { display: grid; grid-template-columns: 2.8in 1fr; gap: 14pt; align-items: start; }
.featured-img { width: 100%; display: block; border: 1px solid #ddd; }
.featured-body { font-size: 11pt; line-height: 1.6; }
.byline { font-size: 8pt; color: #777; margin-top: 8pt; font-style: italic; }
.articles { column-count: 2; column-gap: 18pt; column-rule: 1px solid #ccc; }
.article { break-inside: avoid; margin-bottom: 14pt; padding-bottom: 12pt; border-bottom: 1px solid #ddd; }
.article:last-child { border-bottom: none; }
.article-headline { font-family: 'Playfair Display', serif; font-size: 13pt; font-style: italic; font-weight: 700; line-height: 1.2; margin-bottom: 7pt; }
.article-body { font-size: 10pt; line-height: 1.6; }
.art-img { width: 100%; display: block; margin-bottom: 8pt; border: 1px solid #ddd; }
.comics-rule { border: none; border-top: 3px double #111; margin: 14pt 0 8pt; }
.comics-label { font-size: 8pt; font-style: italic; text-transform: uppercase; letter-spacing: 0.2em; text-align: center; color: #777; margin-bottom: 12pt; }
.comics { column-count: 2; column-gap: 18pt; column-rule: 1px solid #ccc; }
.comic { break-inside: avoid; margin-bottom: 12pt; }
.comic-img { width: 100%; display: block; margin-bottom: 6pt; border: 1px solid #ddd; }
.comic-headline { font-family: 'Playfair Display', serif; font-size: 11pt; font-style: italic; margin-bottom: 5pt; }
.comic-body { font-size: 9.5pt; line-height: 1.55; }
.sidebar-title { font-size: 7.5pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; border-bottom: 2px solid #111; padding-bottom: 3pt; margin: 0 0 8pt; }
.sidebar-section { margin-bottom: 14pt; }
.sidebar-item { font-size: 9pt; padding: 3pt 0; border-bottom: 1px solid #eee; }
.sidebar-stat { font-size: 9pt; color: #444; padding: 2pt 0; }
.sidebar-ok { color: #2e7d32; }
.sidebar-warn { color: #c77700; }
.footer { margin-top: 14pt; border-top: 1px solid #ccc; padding-top: 6pt; font-size: 8pt; font-style: italic; color: #999; text-align: center; }
@page { size: letter; margin: 0; }
`;

export function buildGazettePrintHtml(gazette: GazetteData): string {
  const allJoke = gazette.articles.length > 0 && gazette.articles.every(a => (a as any).joke);
  const featured = gazette.articles.find(a => a.featured) ?? gazette.articles[0]!;
  const mainArticles = gazette.articles.filter(a => a !== featured && (allJoke || !(a as any).joke));
  const comicsArticles = allJoke ? [] : gazette.articles.filter(a => a !== featured && (a as any).joke);

  const fonts = "https://fonts.googleapis.com/css2?family=UnifrakturMaguntia&family=Playfair+Display:ital,wght@0,700;1,400;1,700&family=EB+Garamond:ital,wght@0,400;1,400&display=swap";

  let h = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">`;
  h += `<link rel="preconnect" href="https://fonts.googleapis.com">`;
  h += `<link href="${fonts}" rel="stylesheet">`;
  h += `<style>${CSS}</style></head><body><div class="page">`;

  // Masthead
  h += `<div class="masthead"><hr class="masthead-rule">`;
  h += `<div class="masthead-title">The GitPal Gazette</div>`;
  h += `<div class="masthead-deck">${esc(gazette.date)} &middot; ${esc(gazette.edition)} &middot; GitPal Publishing Co.</div>`;
  h += `</div>`;

  h += `<div class="body-wrap"><div class="main">`;

  // Featured
  if (featured) {
    const fImg = (featured as any).aiGeneratedImage ?? (featured.screenshot ? `/screenshots/${featured.screenshot}` : null);
    h += `<div class="featured">`;
    h += `<div class="featured-headline">${esc(featured.headline)}</div>`;
    h += `<div class="featured-inner">`;
    if (fImg) h += imgTag(fImg, "featured-img", featured.project);
    h += `<div><p class="featured-body">${esc(featured.body)}</p>`;
    h += `<div class="byline">${esc(featured.project)}</div></div>`;
    h += `</div></div>`;
  }

  // Main articles
  if (mainArticles.length > 0) {
    h += `<div class="articles">`;
    for (const a of mainArticles) {
      h += `<div class="article">`;
      h += articleImg(a);
      h += `<div class="article-headline">${esc(a.headline)}</div>`;
      h += `<p class="article-body">${esc(a.body)}</p>`;
      h += `<div class="byline">${esc(a.project)}</div>`;
      h += `</div>`;
    }
    h += `</div>`;
  }

  // Comics & Oddities
  if (comicsArticles.length > 0) {
    h += `<hr class="comics-rule"><div class="comics-label">Comics &amp; Oddities</div>`;
    h += `<div class="comics">`;
    for (const a of comicsArticles) {
      const cImg = (a as any).aiGeneratedImage ?? null;
      h += `<div class="comic">`;
      if (cImg) h += imgTag(cImg, "comic-img", a.project);
      h += `<div class="comic-headline">${esc(a.headline)}</div>`;
      h += `<p class="comic-body">${esc(a.body)}</p>`;
      h += `<div class="byline">${esc(a.project)} &middot; satire</div>`;
      h += `</div>`;
    }
    h += `</div>`;
  }

  h += `</div>`; // close main

  // Sidebar
  h += `<div class="sidebar">`;
  h += `<div class="sidebar-section"><div class="sidebar-title">On the Desk</div>`;
  if (gazette.uncommitted?.length) {
    for (const u of gazette.uncommitted) {
      h += `<div class="sidebar-item"><strong>${esc(u.name)}</strong> &mdash; ${u.changes} file(s)</div>`;
    }
  } else {
    h += `<div class="sidebar-item" style="color:#999;font-style:italic">All clear.</div>`;
  }
  h += `</div>`;

  if (gazette.health) {
    const c = gazette.health.containers;
    const d = gazette.health.disk;
    h += `<div class="sidebar-section"><div class="sidebar-title">Infrastructure</div>`;
    h += c.unhealthy > 0
      ? `<div class="sidebar-stat sidebar-warn">${c.unhealthy} unhealthy / ${c.total}</div>`
      : `<div class="sidebar-stat sidebar-ok">${c.total} containers healthy</div>`;
    if (d) h += `<div class="sidebar-stat">Disk: ${esc(d.text)}</div>`;
    h += `</div>`;
  }

  if (gazette.totalCommits) {
    h += `<div class="sidebar-section"><div class="sidebar-title">By the Numbers</div>`;
    h += `<div class="sidebar-stat">${gazette.totalCommits} commits &middot; ${gazette.totalProjects} projects</div>`;
    h += `</div>`;
  }

  h += `</div>`; // close sidebar
  h += `</div>`; // close body-wrap
  h += `<div class="footer">Generated ${esc(gazette.generated)} &middot; The GitPal Gazette</div>`;
  h += `</div></body></html>`;
  return h;
}

export async function generateGazettePdf(
  gazette: GazetteData,
  archiveDayDir: string,
  editionKey: string,
): Promise<string | null> {
  // Use /tmp — snap-confined chromium can't write outside home in some configs
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
