// Eleventy build for framenex.com
// Content lives in /content (edited via the CMS), templates in /src.
import fs from "node:fs";

function minifyCss(css) {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\s+/g, " ")
    .replace(/\s*([{}:;,>~])\s*/g, "$1")
    .replace(/;}/g, "}")
    .replace(/!important/g, " !important")
    .replace(/ {2}!/g, " !")
    .trim();
}

let cssCache = null;

export default function (eleventyConfig) {
  // Static files copied 1:1
  for (const p of ["compressed", "partner", "fonts", "javascript", "css", "logo.svg", "Logo schwarz.svg", "robots.txt", "sitemap.xml", "_headers"]) {
    eleventyConfig.addPassthroughCopy(`src/${p}`);
  }
  // Original uploads are not published; only the resized versions (written by _data/content.js) are.
  eleventyConfig.ignores.add("src/media/**");
  eleventyConfig.addWatchTarget("content/");
  eleventyConfig.addWatchTarget("src/css/");

  // Inline the stylesheet into every page (no render-blocking CSS request).
  eleventyConfig.addFilter("inlineCss", (prefix) => {
    if (cssCache === null || process.env.ELEVENTY_RUN_MODE === "serve") {
      cssCache = minifyCss(fs.readFileSync("src/css/site.css", "utf8"));
    }
    return cssCache.replaceAll("../fonts/", `${prefix}fonts/`);
  });

  eleventyConfig.addFilter("pad2", (n) => String(n).padStart(2, "0"));

  return {
    dir: { input: "src", includes: "_includes", data: "_data", output: "_site" },
    templateFormats: ["njk"],
    htmlTemplateEngine: "njk",
  };
}
