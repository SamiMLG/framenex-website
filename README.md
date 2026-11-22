# framenex-website

framenex.com, built with [Eleventy](https://www.11ty.dev/) and edited with [Sveltia CMS](https://github.com/sveltia/sveltia-cms) on **cms.framenex.com**.

Visitors get plain static pages (same HTML, inlined CSS and scripts as v20). The CMS and the build only run when you publish a change.

```
content/            ← everything the CMS edits (JSON)
  seiten/           texts + images of each page
  projekte/         one file per reference project (gallery)
  partner.json      partner logos
  projekt-filter.json
  einstellungen.json contact data, footer, Google business data
src/                ← templates and static files (design – normally untouched)
  _data/fnx.js      loads /content, resizes uploads, builds page heads
  css/site.css      the stylesheet (inlined into every page at build time)
  media/            photos uploaded via the CMS (originals, not published)
cms/                ← the editor, deployed separately to cms.framenex.com
```

## Everyday use
Open **cms.framenex.com** → edit → **Speichern/Veröffentlichen**. About one minute later the change is live.

* New photos: just upload the original. The build creates desktop + phone WebP versions automatically.
* New project: *Referenzen (Galerie)* → *Neues Projekt*. "Reihenfolge" 1 = first.
* Legal pages (Impressum, Datenschutz) are plain HTML in `src/_includes/legal/` (not in the CMS on purpose).

## Work on your Mac
```bash
npm install          # once
npm run dev          # http://localhost:8030 with live reload
npm run build        # production build into _site/
```
Check that a build still matches a previous version page by page:
```bash
python3 ../tools/compare-sites.py ../Framenex-website-v20 _site
```

## One-time setup

### 1. GitHub
Create an empty **private** repository `framenex-website` on github.com, then:
```bash
git add -A && git commit -m "Framenex website v21 (Eleventy + CMS)"
git remote add origin https://github.com/<you>/framenex-website.git
git push -u origin main
```
Put your GitHub name into `cms/config.yml` (`repo: <you>/framenex-website`).

### 2. Cloudflare Pages – website
A project created by zip upload **cannot** be switched to GitHub, so create a new one:
Workers & Pages → Create → Pages → *Connect to Git* → `framenex-website`
* Production branch: `main` · Framework preset: None
* Build command: `npm run build` · Build output directory: `_site`
* Settings → Build → Build watch paths → **Exclude** `cms/*`

Test on the `*.pages.dev` address, then move the custom domains (`framenex.com`, `www`) from the old project to this one.

### 3. Cloudflare Pages – CMS
Create a second Pages project from the **same** repository:
* Build command: *(empty)* · Build output directory: `cms`
* Build watch paths → **Include** `cms/*`  (so the CMS does not rebuild on every content change)
* Custom domain: `cms.framenex.com`

### 4. Cloudflare Access (the lock)
Zero Trust → Access → Applications → Add → *Self-hosted*
* Domain: `cms.framenex.com` (add the CMS project's `*.pages.dev` address too)
* Policy: *Allow* → *Emails* → your e-mail address → sign-in with one-time code

### 5. Sign in to the CMS
github.com → Settings → Developer settings → **Fine-grained personal access token**
* Repository access: only `framenex-website`
* Permissions: *Contents* → Read and write
* Expiration: e.g. 1 year (renew in the same place)

Open cms.framenex.com → choose the option to sign in with an access token (instead of "Sign in with GitHub") → paste the token. The browser remembers it.

## Videos
Hero videos live in the separate repository **framenex-videos** (videos.framenex.com). See its README.
