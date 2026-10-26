import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import { syncChrome } from "../lib/chrome";

describe("clean URLs across template and chrome sync", () => {
  it("contains no .html hrefs in any template HTML file", () => {
    const templateDir = path.resolve(__dirname, "../template");
    for (const file of fs.readdirSync(templateDir)) {
      if (!file.endsWith(".html")) continue;
      const html = fs.readFileSync(path.join(templateDir, file), "utf8");
      expect(html).not.toMatch(/href="[^"]*\.html/i);
    }
  });

  it("scopes homepage anchors to /#section and highlights clean nav links in syncChrome", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dukan-clean-chrome-"));
    try {
      fs.writeFileSync(
        path.join(tmp, "index.html"),
        `<!-- chrome:header:start -->
<header><nav>
  <a href="/" aria-current="page">Home</a>
  <a href="about">About</a>
  <a href="contact">Contact</a>
  <a href="#specials">Specials</a>
</nav></header>
<!-- chrome:header:end -->
<main></main>
<!-- chrome:footer:start -->
<footer><a href="#top">Top</a></footer>
<!-- chrome:footer:end -->`
      );
      fs.writeFileSync(
        path.join(tmp, "contact.html"),
        `<!-- chrome:header:start --><header></header><!-- chrome:header:end -->
<main></main>
<!-- chrome:footer:start --><footer></footer><!-- chrome:footer:end -->`
      );

      const res = syncChrome(tmp);
      expect(res.pages).toBe(1);

      const synced = fs.readFileSync(path.join(tmp, "contact.html"), "utf8");
      expect(synced).toContain('<a href="contact" aria-current="page">Contact</a>');
      expect(synced).not.toContain('<a href="/" aria-current="page">Home</a>');
      expect(synced).toContain('href="/#specials"');
      expect(synced).toContain('href="/#top"');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
