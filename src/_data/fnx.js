// Loads everything in /content (the CMS-editable files), resolves images and
// prepares per-page head data. Templates only read the result.
//
// Images:
//  • Existing images (compressed/…, partner/…) are used exactly as they are.
//  • New uploads from the CMS land in src/media/. They are resized and converted
//    to WebP automatically (desktop + phone size per slot) into _site/media/generated/.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import sharp from "sharp";

const ROOT = process.cwd();
const CONTENT = path.join(ROOT, "content");
const SRC = path.join(ROOT, "src");
const OUT_GEN = path.join(ROOT, "_site", "media", "generated");
const SITE = "https://framenex.com/";

// Export sizes per place on the site (pixels). Phone sizes are used up to 767px viewport width.
const SLOTS = {
  heroPoster: { desktop: 1920, mobile: { width: 720, height: 1280 } }, // phone: 9:16 crop from the centre
  card: { desktop: 800, mobile: 600 },
  highlight: { desktop: 800, mobile: 600 },
  pageHero: { desktop: 1200, mobile: 800 },
  overview: { desktop: 1200, mobile: 800 },
  story: { desktop: 800, mobile: 600 },
  partner: { desktop: 480 },
  portrait: { desktop: 900 },
  projectCover: { desktop: 1200, mobile: 800 },
  gallery: { desktop: 1600, mobile: 800 },
  og: { desktop: 1200 },
};

const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const clean = (p) => (p || "").trim().replace(/^\/+/, "");
const isUpload = (p) => clean(p).startsWith("media/");

const metaCache = new Map();
async function dimensions(relPath) {
  if (!metaCache.has(relPath)) {
    const file = path.join(SRC, relPath);
    if (!fs.existsSync(file)) throw new Error(`Bild nicht gefunden: ${relPath}`);
    const m = await sharp(file).metadata();
    metaCache.set(relPath, { width: m.width, height: m.height });
  }
  return metaCache.get(relPath);
}

async function generate(relPath, spec) {
  const src = path.join(SRC, relPath);
  const base = path.basename(relPath, path.extname(relPath)).toLowerCase().replace(/[^a-z0-9-]+/g, "-");
  const name = typeof spec === "number" ? `${base}-${spec}.webp` : `${base}-${spec.width}x${spec.height}.webp`;
  const out = path.join(OUT_GEN, name);
  if (!fs.existsSync(out) || fs.statSync(out).mtimeMs < fs.statSync(src).mtimeMs) {
    fs.mkdirSync(OUT_GEN, { recursive: true });
    let img = sharp(src).rotate();
    img = typeof spec === "number"
      ? img.resize({ width: spec, withoutEnlargement: true })
      : img.resize({ width: spec.width, height: spec.height, fit: "cover", position: "centre", withoutEnlargement: true });
    await img.webp({ quality: 78, effort: 6 }).toFile(out);
  }
  const m = await sharp(out).metadata();
  return { src: `media/generated/${name}`, width: m.width, height: m.height };
}

// → { src, width, height, mobile }  (mobile = phone-only source or "")
async function resolveImage(src, mobileSrc, slot) {
  src = clean(src);
  mobileSrc = clean(mobileSrc);
  if (!src) return null;
  const s = SLOTS[slot];
  if (isUpload(src)) {
    const desktop = await generate(src, s.desktop);
    let mobile = "";
    if (mobileSrc) mobile = (await generate(mobileSrc, s.mobile || s.desktop)).src;
    else if (s.mobile) mobile = (await generate(src, s.mobile)).src;
    return { ...desktop, mobile };
  }
  const d = await dimensions(src);
  let mobile = mobileSrc;
  if (mobileSrc && isUpload(mobileSrc)) mobile = (await generate(mobileSrc, s.mobile || s.desktop)).src;
  return { src, width: d.width, height: d.height, mobile };
}

const jsonLd = (obj, pretty = false) =>
  (pretty ? JSON.stringify(obj, null, 2) : JSON.stringify(obj)).replace(/</g, "\\u003c");

function faqSchema(questions) {
  if (!questions?.length) return null;
  return jsonLd({
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: questions.map((q) => ({
      "@type": "Question",
      name: q.frage,
      acceptedAnswer: { "@type": "Answer", text: q.antwort },
    })),
  });
}

function breadcrumbSchema(items) {
  return jsonLd({
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map(([name, item], i) => ({ "@type": "ListItem", position: i + 1, name, item })),
  });
}

function preloadsFor(img, prefix, { withType = false, alwaysSplit = false } = {}) {
  if (!img) return [];
  const type = withType ? "image/webp" : "";
  if (img.mobile || alwaysSplit) {
    return [
      { href: prefix + img.src, media: "(min-width: 768px)", type },
      { href: prefix + (img.mobile || img.src), media: "(max-width: 767px)", type },
    ];
  }
  return [{ href: prefix + img.src, media: "", type }];
}

async function ogImage(seoImage) {
  const p = clean(seoImage) || "compressed/video_loading.webp";
  if (isUpload(p)) return SITE + (await generate(p, SLOTS.og.desktop)).src;
  return SITE + p;
}

function head({ key, seo, ogUrl, preloads = [], staticSchemas = [], pageScripts = [], faq = null, crumbs = null, bodyClass, prefix, og }) {
  return {
    key,
    title: seo.titel,
    description: seo.beschreibung,
    ogTitle: seo.ogTitel || seo.titel,
    ogDescription: seo.ogBeschreibung || seo.beschreibung,
    ogUrl,
    ogImage: og,
    canonical: ogUrl,
    preloads,
    staticSchemas,
    pageScripts,
    schemas: [faq, crumbs ? breadcrumbSchema(crumbs) : null].filter(Boolean),
    bodyClass,
    prefix,
  };
}

export default async function () {
  const settings = readJson(path.join(CONTENT, "einstellungen.json"));
  const partnersRaw = readJson(path.join(CONTENT, "partner.json")).partner;
  const filters = readJson(path.join(CONTENT, "projekt-filter.json")).filters;
  const pages = {};
  for (const f of fs.readdirSync(path.join(CONTENT, "seiten"))) {
    if (f.endsWith(".json")) pages[f.replace(/\.json$/, "")] = readJson(path.join(CONTENT, "seiten", f));
  }

  // ── Projects (gallery) ──────────────────────────────────────────────
  const projectFiles = fs.readdirSync(path.join(CONTENT, "projekte")).filter((f) => f.endsWith(".json"));
  const projects = projectFiles.map((f) => readJson(path.join(CONTENT, "projekte", f)));
  projects.sort((a, b) => (a.order ?? 999) - (b.order ?? 999) || a.title.localeCompare(b.title, "de"));
  const publicProjects = [];
  for (const p of projects) {
    if (p.hidden) continue;
    const cover = await resolveImage(p.cover.src, p.cover.mobileSrc, "projectCover");
    const media = [];
    for (const m of p.media || []) {
      if (m.type === "youtube") {
        if (m.id) media.push({ type: "youtube", id: m.id.trim(), title: m.title || p.title });
        continue;
      }
      const img = await resolveImage(m.src, m.mobileSrc, "gallery");
      if (!img) continue;
      const item = { type: "image", src: img.src, alt: m.alt || p.title, width: m.width || img.width, height: m.height || img.height };
      if (img.mobile) item.mobileSrc = img.mobile;
      media.push(item);
    }
    const out = {
      id: p.id,
      title: p.title,
      lead: p.lead || "",
      cardLabel: p.cardLabel || "",
      categories: p.categories || [],
      layout: p.layout || "standard",
      featured: Boolean(p.featured),
      cover: {
        src: cover.src,
        alt: p.cover.alt || p.title,
        width: p.cover.width || cover.width,
        height: p.cover.height || cover.height,
        ...(p.cover.position ? { position: p.cover.position } : {}),
        ...(cover.mobile ? { mobileSrc: cover.mobile } : {}),
      },
      meta: p.meta || {},
      description: (p.description || []).filter(Boolean),
      facts: (p.facts || []).filter(Boolean),
      ...(p.externalLink?.href ? { externalLink: p.externalLink } : {}),
      media,
    };
    publicProjects.push(out);
  }
  const projectsJs =
    `(()=>{const e=${JSON.stringify(publicProjects)};` +
    `const s=document.currentScript||Array.from(document.scripts).find(x=>/(?:^|\\/)projects-data-[a-z0-9]+\\.min\\.js(?:[?#]|$)/.test(x.src)),` +
    `t=s&&s.src?new URL("../",s.src):new URL(window.location.pathname.includes("/side-pages/")?"../":"./",window.location.href),` +
    `m=window.matchMedia("(max-width: 767px)").matches,` +
    `r=(a,b)=>{let i=String((m&&b)||a||"");return!i||/^(?:[a-z][a-z0-9+.-]*:|\\/|#)/i.test(i)?i:new URL(i,t).href};` +
    `e.forEach(p=>{p.cover?.src&&(p.cover.publicUrl=new URL(p.cover.src,"${SITE}").href,p.cover.src=r(p.cover.src,p.cover.mobileSrc),delete p.cover.mobileSrc),` +
    `p.media?.forEach(x=>{"image"===x.type&&x.src&&(x.src=r(x.src,x.mobileSrc),delete x.mobileSrc)})});` +
    `window.FRAMENEX_PROJECTS_CONFIG=Object.freeze({filters:${JSON.stringify(filters)},projects:e})})();\n`;
  const hash = crypto.createHash("sha256").update(projectsJs).digest("hex").slice(0, 10);
  const projectsScript = `javascript/projects-data-${hash}.min.js`;

  // ── Partners ────────────────────────────────────────────────────────
  const partners = [];
  for (const p of partnersRaw) {
    if (!p.logo) continue;
    partners.push({ ...p, img: await resolveImage(p.logo, "", "partner") });
  }

  // ── Home ────────────────────────────────────────────────────────────
  const home = pages.startseite;
  const heroPoster = await resolveImage(home.hero.poster, home.hero.posterMobil, "heroPoster");
  for (const c of home.leistungen.karten) c.img = await resolveImage(c.bild, c.bildMobil, "card");
  for (const h of home.arbeiten.projekte) h.img = await resolveImage(h.bild, h.bildMobil, "highlight");
  const about = home.ueberMich;
  about.bw = await resolveImage(about.portraitSw, "", "portrait");
  about.color = await resolveImage(about.portraitFarbe, "", "portrait");
  // Keep the size numbers that are in the HTML today (same 4:5 shape) unless a new portrait is uploaded.
  for (const img of [about.bw, about.color]) {
    if (!isUpload(img.src) && about.portraitBreite && about.portraitHoehe) {
      img.width = about.portraitBreite;
      img.height = about.portraitHoehe;
    }
  }

  const u = settings.unternehmen;
  const businessSchema = jsonLd({
    "@context": "https://schema.org",
    "@type": "ProfessionalService",
    name: "Framenex",
    url: SITE,
    telephone: settings.telefon,
    priceRange: u.priceRange,
    email: settings.email,
    image: await ogImage(home.seo.bild),
    address: { "@type": "PostalAddress", streetAddress: u.strasse, addressLocality: u.ort, addressRegion: u.region, postalCode: u.plz, addressCountry: "AT" },
    areaServed: u.einsatzgebiet,
    sameAs: u.profile,
    hasOfferCatalog: {
      "@type": "OfferCatalog",
      name: "Leistungen",
      itemListElement: settings.leistungen.map((l) => ({ "@type": "Offer", itemOffered: { "@type": "Service", name: l.name } })),
    },
  }, true);

  const heads = {};
  heads.home = head({
    key: "home", seo: home.seo, ogUrl: SITE, og: await ogImage(home.seo.bild), prefix: "", bodyClass: "home-page",
    preloads: preloadsFor(heroPoster, "", { withType: true, alwaysSplit: true }),
    staticSchemas: [businessSchema],
    pageScripts: [projectsScript],
    faq: faqSchema(home.faq.fragen),
  });

  // ── Service pages ───────────────────────────────────────────────────
  const serviceNames = Object.fromEntries(settings.leistungen.map((l) => [l.key, l.name]));
  const services = {};
  for (const l of settings.leistungen) {
    const d = pages[l.key];
    d.key = l.key;
    d.name = l.name;
    d.heroImg = await resolveImage(d.hero.bild, d.hero.bildMobil, "pageHero");
    d.storyImgs = [];
    for (const b of d.story.bilder) d.storyImgs.push({ ...b, img: await resolveImage(b.bild, b.bildMobil, "story") });
    d.related = settings.leistungen.filter((x) => x.key !== l.key);
    const url = `${SITE}side-pages/${l.key}`;
    heads[l.key] = head({
      key: l.key, seo: d.seo, ogUrl: url, og: await ogImage(d.seo.bild), prefix: "../", bodyClass: "service-page",
      preloads: preloadsFor(d.heroImg, "../"),
      staticSchemas: [jsonLd({
        "@context": "https://schema.org", "@type": "Service", name: d.seo.schemaName || d.hero.h1, description: d.seo.beschreibung, url,
        areaServed: u.einsatzgebiet, provider: { "@type": "ProfessionalService", name: "Framenex", url: SITE },
      }, true)],
      faq: faqSchema(d.faq.fragen),
      crumbs: [["Start", SITE], ["Leistungen", `${SITE}side-pages/leistungen`], [l.name, url]],
    });
    services[l.key] = d;
  }

  // ── Leistungen overview ─────────────────────────────────────────────
  const leistungen = pages.leistungen;
  for (const z of leistungen.zeilen) z.img = await resolveImage(z.bild, z.bildMobil, "overview");
  heads.leistungen = head({
    key: "leistungen", seo: leistungen.seo, ogUrl: `${SITE}side-pages/leistungen`, og: await ogImage(leistungen.seo.bild), prefix: "../", bodyClass: "service-page",
    staticSchemas: [jsonLd({
      "@context": "https://schema.org", "@type": "ItemList", name: "Leistungen von Framenex",
      itemListElement: leistungen.zeilen.map((z, i) => ({ "@type": "ListItem", position: i + 1, url: `${SITE}side-pages/${z.seite}`, name: z.titel })),
    }, true)],
    faq: faqSchema(leistungen.faq.fragen),
    crumbs: [["Start", SITE], ["Leistungen", `${SITE}side-pages/leistungen`]],
  });

  // ── FAQ page ────────────────────────────────────────────────────────
  const faqPage = pages.faq;
  heads.faq = head({
    key: "faq", seo: faqPage.seo, ogUrl: `${SITE}side-pages/faq`, og: await ogImage(faqPage.seo.bild), prefix: "../", bodyClass: "faq-page",
    faq: faqSchema(faqPage.themen.flatMap((t) => t.fragen)),
    crumbs: [["Start", SITE], ["FAQ", `${SITE}side-pages/faq`]],
  });

  // ── References ──────────────────────────────────────────────────────
  const ref = pages.referenzen;
  const firstCover = publicProjects[0]?.cover;
  heads.projekte = head({
    key: "projekte", seo: ref.seo, ogUrl: `${SITE}side-pages/projekte`, og: await ogImage(ref.seo.bild), prefix: "../", bodyClass: "projects-page references-page",
    preloads: firstCover ? [{ href: "../" + firstCover.src, media: "", type: "" }] : [],
    pageScripts: [projectsScript, "javascript/projects-page-v20.min.js"],
    crumbs: [["Start", SITE], ["Referenzen", `${SITE}side-pages/projekte`]],
  });

  // ── Legal pages (text is maintained in the templates) ───────────────
  heads.impressum = head({
    key: "impressum", seo: { titel: "Impressum | Framenex", beschreibung: "Anbieterkennzeichnung und Unternehmensangaben von Framenex, Samuel Moser, Niederösterreich." },
    ogUrl: `${SITE}side-pages/impressum`, og: await ogImage(""), prefix: "../", bodyClass: "legal-page",
  });
  heads.datenschutz = head({
    key: "datenschutz", seo: { titel: "Datenschutz | Framenex", beschreibung: "Datenschutzerklärung von Framenex mit Informationen zu Kontaktformular, Einwilligungseinstellungen und optionalen YouTube-Videos." },
    ogUrl: `${SITE}side-pages/datenschutz`, og: await ogImage(""), prefix: "../", bodyClass: "legal-page",
  });

  return {
    settings, partners, home, heroPoster, services, serviceNames, leistungen, faqPage, ref, heads,
    projectsJs, projectsScript,
  };
}
