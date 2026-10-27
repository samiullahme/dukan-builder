"use strict";

/** Playwright-based layout and end-to-end checks. Called by qa-check.cjs. */

const fs = require("fs");
const http = require("http");
const path = require("path");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

function startServer(root) {
  const rootAbs = path.resolve(root);
  const server = http.createServer((req, res) => {
    try {
      const urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
      // Same-origin API proxy so the owner sign-in page exercises the real
      // builder endpoint, mirroring the Caddy /_api/* route in production.
      if (urlPath.startsWith("/_api/")) {
        const [pathPart, queryPart] = (req.url || "/").split("?");
        const upstream = http.request(
          {
            host: "127.0.0.1",
            port: 3010,
            path: `/api${pathPart.slice("/_api".length)}${queryPart ? `?${queryPart}` : ""}`,
            method: req.method,
            headers: { ...req.headers, host: "127.0.0.1:3010" },
          },
          (up) => {
            res.writeHead(up.statusCode || 502, up.headers);
            up.pipe(res);
          }
        );
        upstream.on("error", () => {
          res.writeHead(502);
          res.end("upstream unavailable");
        });
        req.pipe(upstream);
        return;
      }
      const rel = urlPath === "/" ? "index.html" : urlPath.replace(/^\/+/, "");
      let file = path.resolve(rootAbs, rel);
      if (file !== rootAbs && !file.startsWith(rootAbs + path.sep)) {
        res.writeHead(403);
        return res.end("forbidden");
      }
      if (!fs.existsSync(file) && !path.extname(file) && fs.existsSync(file + ".html")) {
        file = file + ".html";
      }
      fs.stat(file, (err, st) => {
        if (err || !st.isFile()) {
          res.writeHead(404);
          return res.end("not found");
        }
        res.writeHead(200, {
          "Content-Type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream",
          "Cache-Control": "no-store",
        });
        fs.createReadStream(file).pipe(res);
      });
    } catch {
      res.writeHead(400);
      res.end("bad request");
    }
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port }));
  });
}

/** Fetch the generated owner credentials for a site from the database. */
async function getOwnerCreds(slug) {
  if (!process.env.DATABASE_URL || !process.env.SITE_ADMIN_ENC_KEY || !slug) return null;
  try {
    let Pool;
    try {
      ({ Pool } = require("pg"));
    } catch {
      ({ Pool } = require("/opt/builder/node_modules/pg"));
    }
    const { createDecipheriv } = require("crypto");
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      max: 2,
    });
    const encKey = Buffer.from(process.env.SITE_ADMIN_ENC_KEY.replace(/[^0-9a-fA-F]/g, ""), "hex");
    const { rows } = await pool.query(
      "SELECT sa.username, sa.password_enc FROM site_admins sa JOIN sites s ON s.id = sa.site_id WHERE s.slug = $1",
      [slug]
    );
    await pool.end().catch(() => {});
    if (!rows.length || encKey.length !== 32) return null;
    const [ivh, tagh, cth] = rows[0].password_enc.split(".");
    const d = createDecipheriv("aes-256-gcm", encKey, Buffer.from(ivh, "hex"));
    d.setAuthTag(Buffer.from(tagh, "hex"));
    const password = Buffer.concat([d.update(Buffer.from(cth, "hex")), d.final()]).toString("utf8");
    return { username: rows[0].username, password };
  } catch {
    return null;
  }
}

/** Remove the rows this QA run created so a real site's owner inbox stays clean. */
async function cleanupSiteData(slug, emails) {
  if (!process.env.DATABASE_URL || !slug) return;
  try {
    let Pool;
    try {
      ({ Pool } = require("pg"));
    } catch {
      ({ Pool } = require("/opt/builder/node_modules/pg"));
    }
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      max: 2,
    });
    const { rows } = await pool.query("SELECT id FROM sites WHERE slug = $1", [slug]);
    if (rows.length) {
      const siteId = rows[0].id;
      await pool.query("DELETE FROM site_requests WHERE site_id = $1 AND email = ANY($2)", [siteId, emails]);
      await pool.query("DELETE FROM site_subscribers WHERE site_id = $1 AND email = ANY($2)", [siteId, emails]);
    }
    await pool.end().catch(() => {});
  } catch {
    // Non-fatal: leftover QA rows are only visible to the site owner.
  }
}

const PUBLIC_PAGES = ["index.html", "about.html", "services.html", "gallery.html", "contact.html"];

/** Every QA flow submits through the loopback preview proxy, so all runs share
 *  one site-submit rate-limit bucket that refills slowly. Reset it per run or
 *  back-to-back builds fail on the newsletter check with a 429. The site-auth
 *  sign-in buckets drain the same way and 429 the owner login flows. */
async function resetQaRateLimit() {
  if (!process.env.DATABASE_URL) return;
  try {
    let Pool;
    try {
      ({ Pool } = require("pg"));
    } catch {
      ({ Pool } = require("/opt/builder/node_modules/pg"));
    }
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      max: 1,
    });
    await pool.query("DELETE FROM rate_limits WHERE key LIKE 'site-submit:%127.0.0.1%'");
    await pool.query("DELETE FROM rate_limits WHERE key LIKE 'site-auth:%127.0.0.1%'");
    await pool.end().catch(() => {});
  } catch {
    // Non-fatal: worst case the newsletter check sees a 429.
  }
}

/** Confirm an <img> URL is valid so a skipped lazy image cannot fail a build. */
async function urlReachable(url, base) {
  try {
    const abs = url.startsWith("/") ? base + url : url;
    const res = await fetch(abs, {
      redirect: "follow",
      signal: AbortSignal.timeout(15000),
      headers: { Accept: "image/*,*/*;q=0.5" },
    });
    if (!res.ok) return false;
    if (/^image\//i.test(res.headers.get("content-type") || "")) return true;
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.length > 8;
  } catch {
    return false;
  }
}

function isBenignConsole(text) {
  return /favicon|net::ERR_BLOCKED_BY_CLIENT|Failed to load resource.*(fonts|googleapis)/i.test(text);
}

async function run({ workspace, outDir, site }) {
  const { chromium } = require("playwright");
  await resetQaRateLimit();
  const checks = [];
  const screenshots = [];
  const add = (level, check, message, detail) => checks.push({ level, check, message, detail });

  const { server, port } = await startServer(workspace);
  const base = `http://127.0.0.1:${port}`;
  const launchOptions = {
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  };
  if (process.env.QA_CHROMIUM) launchOptions.executablePath = process.env.QA_CHROMIUM;
  let browser = await chromium.launch(launchOptions);

  const desktop = { name: "desktop", width: 1440, height: 900 };

  async function open(ctx, file) {
    const page = await ctx.newPage();
    const bag = { console: [], page: [], failed: [] };
    page.on("console", (m) => {
      if (m.type() === "error" && !isBenignConsole(m.text())) bag.console.push(m.text().slice(0, 300));
    });
    page.on("pageerror", (e) => bag.page.push(String(e.message).slice(0, 300)));
    page.on("requestfailed", (r) => {
      const url = r.url();
      if (/favicon/i.test(url) || isBenignConsole(url)) return;
      const sameOrigin = url.startsWith(base);
      const entry = `${sameOrigin ? "local" : "external"} ${url} ${r.failure()?.errorText || ""}`.slice(0, 300);
      bag.failed.push(entry);
    });
    await page.goto(`${base}/${file === "index.html" ? "" : file}`, { waitUntil: "domcontentloaded", timeout: 30000 });
    return { page, bag };
  }

  async function waitHydrated(page) {
    await page
      .waitForFunction(
        () => {
          const els = Array.from(document.querySelectorAll('[data-slot="business_name"]'));
          return els.length > 0 && els.some((el) => {
            const t = (el.textContent || "").trim();
            return t && t !== "Your Business Name";
          });
        },
        { timeout: 20000 }
      )
      .catch(() => {});
  }

  async function settleImages(page) {
    // Scroll first so lazy below-the-fold images start loading, then wait.
    await page.evaluate(async () => {
      for (let y = 0; y < document.body.scrollHeight; y += 600) {
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 120));
      }
      window.scrollTo(0, 0);
    });
    const waitAll = (timeout) =>
      page
        .waitForFunction(() => Array.from(document.images).every((i) => i.complete), { timeout })
        .catch(() => {});
    await waitAll(12000);
    // Chromium sometimes leaves lazy images below the fold unrequested even
    // after a scroll pass (currentSrc empty, complete=false). Force those to
    // load eagerly and retry once; only persistent failures should fail QA.
    const pending = await page
      .evaluate(() => {
        let n = 0;
        for (const img of document.images) {
          if (!img.complete || img.naturalWidth === 0) {
            img.loading = "eager";
            if (img.getAttribute("src")) img.src = img.src;
            n++;
          }
        }
        return n;
      })
      .catch(() => 0);
    if (pending) await waitAll(10000);
    await page.waitForTimeout(300);
  }

  function reportPageErrors(bag, tag) {
    for (const e of bag.console.slice(0, 4)) add("error", tag + ":console", e);
    for (const e of bag.page.slice(0, 4)) add("error", tag + ":pageerror", e);
    for (const f of bag.failed.slice(0, 4)) add(/^local/.test(f) ? "error" : "warn", tag + ":network", f);
  }

  const collect = () => {
    const all = (sel) => Array.from(document.querySelectorAll(sel));
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && cs.display !== "none" && cs.visibility !== "hidden";
    };
    const txt = (el) => (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 120);
    const pathOf = (el) => {
      const bits = [];
      let e = el;
      while (e && e.nodeType === 1 && bits.length < 4) {
        let s = e.tagName.toLowerCase();
        if (e.id) s += "#" + e.id;
        else if (e.className && typeof e.className === "string") s += "." + e.className.trim().split(/\s+/).slice(0, 2).join(".");
        bits.unshift(s);
        e = e.parentElement;
      }
      return bits.join(" > ");
    };
    const colorCanvas = document.createElement("canvas");
    colorCanvas.width = 1;
    colorCanvas.height = 1;
    const colorCtx = colorCanvas.getContext("2d", { willReadFrequently: true });
    const rgb = (c) => {
      if (!c) return null;
      try {
        colorCtx.fillStyle = "#ffffff";
        colorCtx.fillRect(0, 0, 1, 1);
        colorCtx.fillStyle = c;
        colorCtx.fillRect(0, 0, 1, 1);
        const d = colorCtx.getImageData(0, 0, 1, 1).data;
        return [d[0], d[1], d[2]];
      } catch {
        return null;
      }
    };
    const bgOf = (el) => {
      let e = el;
      while (e) {
        const c = getComputedStyle(e).backgroundColor;
        if (c && c !== "rgba(0, 0, 0, 0)" && c !== "transparent") return c;
        e = e.parentElement;
      }
      return "rgb(255, 255, 255)";
    };
    const lum = (c) => {
      const [r, g, b] = c.map((x) => {
        const s = x / 255;
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const ratio = (fg, bg) => {
      const a = lum(fg), b = lum(bg);
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    };

    const offenders = all("body *")
      .filter(visible)
      .map((el) => ({ el, r: el.getBoundingClientRect(), cs: getComputedStyle(el) }))
      .filter(({ r, cs }) => cs.position !== "fixed" && (r.right > window.innerWidth + 2 || r.left < -2))
      .slice(0, 6)
      .map(({ el, r }) => ({ sel: pathOf(el), left: Math.round(r.left), right: Math.round(r.right) }));

    const taps = all("a, button")
      .filter(visible)
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter(({ el, r }) => !el.closest(".skip-link") && (r.width < 40 || r.height < 40))
      .slice(0, 8)
      .map(({ el, r }) => ({ sel: pathOf(el), text: txt(el), w: Math.round(r.width), h: Math.round(r.height) }));

    const samples = [];
    const sampleEls = [
      ["body", document.body],
      ["h1", document.querySelector("h1")],
      ["h2", document.querySelector("h2")],
      ["nav link", document.querySelector(".nav-links a")],
      ["button", document.querySelector(".btn")],
    ];
    for (const [label, el] of sampleEls) {
      if (!el || !visible(el)) continue;
      const fg = rgb(getComputedStyle(el).color);
      const bg = rgb(bgOf(el));
      if (!fg || !bg) continue;
      samples.push({ label, fg: getComputedStyle(el).color, bg: bgOf(el), ratio: Number(ratio(fg, bg).toFixed(2)) });
    }

    const bodyText = document.body.innerText;
    const placeholders = [
      "Your Business Name",
      "Your street, Your city",
      "Tell your customers who you are",
      "Service one",
      "A short line about what makes your shop special",
      "__SITE_SLUG__",
    ].filter((p) => bodyText.includes(p));

    const hero = document.querySelector('img[data-slot-src="hero_image"]');
    const about = document.querySelector('img[data-slot-src="about_image"]');
    const sticky = document.querySelector(".cta-sticky");

    return {
      title: document.title,
      metaDescription: (document.querySelector('meta[name="description"]') || {}).content || "",
      hydratedName: txt(document.querySelector('[data-slot="business_name"]') || document.body),
      brokenImages: all("img")
        .filter(visible)
        .filter((i) => !i.complete || i.naturalWidth === 0)
        .map((i) => (i.currentSrc || i.src || "").slice(0, 200)),
      heroLoaded: !!hero && hero.naturalWidth > 0 && visible(hero),
      heroHiddenLoaded: !!hero && hero.naturalWidth > 0 && !visible(hero),
      aboutLoaded: !!about && about.naturalWidth > 0 && visible(about),
      aboutBroken: !!about && about.complete && about.naturalWidth === 0 && visible(about),
      serviceCards: all("#services-grid .service-card").length,
      galleryImages: all("#gallery-grid img").length,
      overflow: { scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth, offenders },
      wrapPadding: (() => {
        const wrap = document.querySelector(".wrap");
        if (!wrap) return null;
        const cs = getComputedStyle(wrap);
        return { left: parseFloat(cs.paddingLeft), right: parseFloat(cs.paddingRight) };
      })(),
      tapTargets: taps,
      contrast: samples,
      placeholders,
      stickyVisible: !!sticky && visible(sticky),
      bookingFields: all("[data-booking-fields] .form-field").length,
      bookingForm: !!document.getElementById("booking-form"),
      inquiryForm: !!document.getElementById("inquiry-form"),
      newsletterForm: !!document.getElementById("newsletter-form"),
      authLink: (() => {
        const a = document.querySelector(".js-auth-link");
        return a ? { text: txt(a), href: a.getAttribute("href") } : null;
      })(),
    };
  }

  try {
    /* ---------- public pages at three viewports ---------- */
    for (const vp of [
      { name: "mobile", width: 390, height: 844 },
      { name: "tablet", width: 768, height: 1024 },
      { name: "desktop", width: 1440, height: 900 },
    ]) {
      const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
      for (const file of PUBLIC_PAGES) {
        const tag = `${vp.name}:${file.replace(".html", "")}`;
        const { page, bag } = await open(ctx, file);
        await waitHydrated(page);
        await settleImages(page);
        const data = await page.evaluate(collect);

        reportPageErrors(bag, tag);
        if (!data.hydratedName || data.hydratedName === "Your Business Name") {
          add("error", tag + ":hydration", "site.json did not hydrate the business name");
        }
        if (data.placeholders.length) add("error", tag + ":placeholder", "template text still visible: " + data.placeholders.join(" | "));
        if (data.brokenImages.length) {
          const dead = [];
          const unloaded = [];
          for (const url of data.brokenImages) {
            (await urlReachable(url, base)) ? unloaded.push(url) : dead.push(url);
          }
          if (dead.length) add("error", tag + ":images", `${dead.length} broken image(s)`, dead);
          if (unloaded.length) {
            add("warn", tag + ":images", `${unloaded.length} image(s) did not finish loading in the browser but the URL is reachable`, unloaded);
          }
        }
        if (data.overflow.scrollWidth > data.overflow.innerWidth + 1) {
          add("error", tag + ":overflow", `horizontal overflow: ${data.overflow.scrollWidth}px > ${data.overflow.innerWidth}px`, data.overflow.offenders);
        }
        if (data.wrapPadding && (data.wrapPadding.left < 16 || data.wrapPadding.right < 16)) {
          add("warn", tag + ":padding", `container padding ${data.wrapPadding.left}/${data.wrapPadding.right}px (want >= 16px)`);
        }
        if (site && site.business_name && !data.title.includes(site.business_name)) {
          add("warn", tag + ":title", `title does not include the business name: "${data.title}"`);
        }
        if (data.metaDescription && /short line about|Your Business/i.test(data.metaDescription)) {
          add("error", tag + ":meta", "meta description was not hydrated: " + data.metaDescription);
        }
        const low = data.contrast.filter((c) => c.ratio < 4.5);
        for (const c of low.slice(0, 3)) add(c.ratio < 3 ? "error" : "warn", tag + ":contrast", `${c.label} contrast ${c.ratio}:1 (${c.fg} on ${c.bg})`);

        if (file === "index.html") {
          if (data.heroHiddenLoaded) add("error", tag + ":hero", "hero image loaded but is hidden");
          if (!data.heroLoaded) add("error", tag + ":hero", "hero image did not load");
          if (!data.aboutLoaded && !data.aboutBroken) add("warn", tag + ":about-image", "about image missing or not loaded");
          if (site && Array.isArray(site.services) && site.services.length && data.serviceCards !== site.services.length) {
            add("error", tag + ":services", `${data.serviceCards} cards rendered, site.json has ${site.services.length}`);
          }
          if (site && Array.isArray(site.gallery) && site.gallery.length && data.galleryImages < Math.min(3, site.gallery.length)) {
            add("error", tag + ":gallery", `only ${data.galleryImages} gallery images rendered`);
          }
          if (!data.newsletterForm) add("error", tag + ":newsletter", "footer newsletter form missing");
          if (!data.authLink) add("error", tag + ":auth", ".js-auth-link missing");
          if (vp.name === "mobile") {
            if (!data.stickyVisible) add("warn", tag + ":cta", "sticky WhatsApp CTA not visible on mobile");
            if (data.tapTargets.length) add("warn", tag + ":tap-targets", `${data.tapTargets.length} small tap target(s)`, data.tapTargets);
          } else if (data.stickyVisible) {
            add("warn", tag + ":cta", "sticky CTA is visible on desktop");
          }
        }

        if (file === "contact.html") {
          if (!data.bookingForm || !data.inquiryForm) add("error", tag + ":forms", "booking or inquiry form missing");
          if (data.bookingFields === 0) add("error", tag + ":booking-fields", "booking fields were not generated from the category");
          if (vp.name === "mobile" && data.tapTargets.length) {
            add("warn", tag + ":tap-targets", `${data.tapTargets.length} small tap target(s)`, data.tapTargets);
          }
        }

        if (vp.name === "desktop" || (vp.name === "mobile" && (file === "index.html" || file === "contact.html"))) {
          const full = path.join(outDir, `${vp.name}-${file.replace(".html", "")}-full.png`);
          await page.screenshot({ path: full, fullPage: true });
          screenshots.push(full);
        }
        if (file === "index.html" && (vp.name === "desktop" || vp.name === "mobile")) {
          const fold = path.join(outDir, `${vp.name}-fold.png`);
          await page.screenshot({ path: fold, fullPage: false });
          screenshots.push(fold);
        }
        add("info", tag, `${vp.width}x${vp.height} rendered`);
        await page.close();
      }
      await ctx.close();
    }

    // Fifteen pages of images, video and full-page screenshots bloat this
    // browser; on the 2GB build host that swap-thrashes the flow phase that
    // follows. Restart the browser so the flows run with fresh memory.
    await browser.close().catch(() => {});
    browser = await chromium.launch(launchOptions);

    /* ---------- customer journey, owner journey, registration ---------- */
    const flowCtx = await browser.newContext({ viewport: desktop, acceptDownloads: true });
    let customerLogin = false;
    const testEmail = `qa+customer-${Date.now()}@example.com`;
    let newsletterEmail = `qa+news-${Date.now()}@example.com`;

    try {
      const { page, bag } = await open(flowCtx, "login");
      await waitHydrated(page);
      await page.fill("#login-email", "customer@site.local");
      await page.fill("#login-password", "customer123");
      await Promise.all([
        page.waitForURL(/\/dashboard(\.html)?$/, { timeout: 30000 }),
        page.click('#login-form button[type="submit"]'),
      ]);
      reportPageErrors(bag, "flow:login-customer");
      await waitHydrated(page);
      await page.waitForTimeout(500);
      customerLogin = true;
      add("info", "flow:login-customer", "logged in as the seeded customer");

      // Customer dashboard: sample requests render, owner link is hidden.
      const dash = await page.evaluate(() => ({
        user: (document.querySelector("[data-user-name]") || {}).textContent || "",
        cards: document.querySelectorAll("#my-requests .request-card").length,
        adminHidden: (() => {
          const a = document.querySelector(".js-admin-link");
          return !a || a.hidden;
        })(),
        emptyHidden: (document.getElementById("requests-empty") || {}).hidden,
      }));
      if (!dash.user.trim()) add("error", "flow:dashboard", "customer name was not rendered");
      if (dash.cards === 0 && dash.emptyHidden === false) add("info", "flow:dashboard", "no requests yet (empty state shown)");
      if (!dash.adminHidden) add("error", "flow:dashboard", "owner-only admin link is visible to a customer");

      // Customer must not be able to open the owner dashboard.
      await page.goto(`${base}/admin`, { waitUntil: "domcontentloaded" });
      await page.waitForURL(/\/admin-login(\.html)?$/, { timeout: 20000 }).catch(() => {});
      if (!/admin-login(\.html)?$/.test(new URL(page.url()).pathname)) {
        add("error", "flow:guard", "visitor without an owner token was not redirected away from admin");
      } else {
        add("info", "flow:guard", "customer redirected from admin to the owner sign-in page");
      }

      // Booking submission with dynamic category fields.
      await page.goto(`${base}/contact`, { waitUntil: "domcontentloaded" });
      await waitHydrated(page);
      await page.waitForFunction(() => document.querySelectorAll("[data-booking-fields] .form-field").length > 0, { timeout: 20000 }).catch(() => {});
      const fieldCount = await page.evaluate((email) => {
        const form = document.getElementById("booking-form");
        if (!form) return 0;
        const fields = form.querySelectorAll("[data-booking-fields] input, [data-booking-fields] select, [data-booking-fields] textarea");
        const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
        fields.forEach((el) => {
          if (el.tagName === "SELECT") {
            if (el.options.length > 1) el.value = el.options[1].value;
          } else if (el.type === "date") el.value = tomorrow;
          else if (el.type === "time") el.value = "19:00";
          else if (el.type === "number") el.value = "2";
          else el.value = "QA test";
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
        });
        form.elements.name.value = "QA Guest";
        form.elements.phone.value = "03001234567";
        form.elements.email.value = email;
        if (form.elements.message) form.elements.message.value = "This is an automated QA booking.";
        return fields.length;
      }, testEmail);
      if (fieldCount === 0) add("error", "flow:booking", "no category booking fields were generated");
      await page.click('#booking-form button[type="submit"]');
      await page.waitForSelector("#booking-success:not([hidden])", { timeout: 10000 }).catch(() => {});
      const bookingRef = (await page.textContent("#booking-success [data-success-ref]").catch(() => "")) || "";
      if (!/^BK-/.test(bookingRef.trim())) add("error", "flow:booking", "booking success panel did not show a BK reference");
      else add("info", "flow:booking", `booking submitted ${bookingRef.trim()}`);

      // Inquiry submission.
      await page.fill("#inq-name", "QA Guest");
      await page.fill("#inq-phone", "03001234567");
      await page.fill("#inq-email", testEmail);
      await page.fill("#inq-message", "This is an automated QA enquiry.");
      await page.click('#inquiry-form button[type="submit"]');
      await page.waitForSelector("#inquiry-success:not([hidden])", { timeout: 10000 }).catch(() => {});
      const inquiryRef = (await page.textContent("#inquiry-success [data-success-ref]").catch(() => "")) || "";
      if (!/^IN-/.test(inquiryRef.trim())) add("error", "flow:inquiry", "inquiry success panel did not show an IN reference");
      else add("info", "flow:inquiry", `inquiry submitted ${inquiryRef.trim()}`);

      // Newsletter subscription from the footer. These flows call /_api while
      // the build host is still settling, so a slow response gets one retry
      // with a fresh address before it counts as a failure.
      await page.goto(`${base}/`, { waitUntil: "domcontentloaded" });
      await waitHydrated(page);
      let subscribed = false;
      let newsletterStatus = "";
      for (let attempt = 0; attempt < 2 && !subscribed; attempt++) {
        if (attempt > 0) {
          newsletterEmail = `qa+news-${Date.now()}-retry@example.com`;
          await page.goto(`${base}/`, { waitUntil: "domcontentloaded" });
          await waitHydrated(page);
        }
        await page.fill('#newsletter-form input[name="email"]', newsletterEmail);
        await page.click('#newsletter-form button[type="submit"]');
        await page.waitForFunction(
          () => /subscribed/i.test((document.querySelector("#newsletter-form [data-form-status]") || {}).textContent || ""),
          { timeout: 45000 }
        ).catch(() => {});
        newsletterStatus = await page.evaluate(() =>
          (document.querySelector("#newsletter-form [data-form-status]") || {}).textContent || ""
        );
        subscribed = /subscribed/i.test(newsletterStatus);
      }
      if (!subscribed) {
        add("error", "flow:newsletter", `newsletter form did not confirm the subscription (status: "${newsletterStatus.slice(0, 120)}")`);
      }

      // Customer dashboard sees both new requests and can cancel a sample booking.
      await page.goto(`${base}/dashboard`, { waitUntil: "domcontentloaded" });
      await waitHydrated(page);
      await page.waitForTimeout(400);
      const dashCards = await page.evaluate(() => Array.from(document.querySelectorAll("#my-requests .request-card")).map((c) => c.innerText));
      if (!dashCards.some((t) => t.includes(bookingRef.trim()))) add("error", "flow:dashboard", "new booking is not listed in the customer dashboard");
      if (!dashCards.some((t) => t.includes(inquiryRef.trim()))) add("error", "flow:dashboard", "new inquiry is not listed in the customer dashboard");

      page.on("dialog", (d) => d.accept());
      await page.evaluate(() => { window.confirm = () => true; });
      const cancelRef = bookingRef.trim();
      const cancelledResult = await page.evaluate((ref) => {
        const card = Array.from(document.querySelectorAll("#my-requests .request-card")).find((c) => c.innerText.includes(ref));
        const button = card && card.querySelector("[data-cancel]");
        if (!button) return { found: false };
        const id = button.getAttribute("data-cancel");
        const res = window.DukanStore ? window.DukanStore.cancelRequest(id) : { ok: false, error: "no store" };
        window.dispatchEvent(new CustomEvent("dukan:store"));
        return { found: true, id, res };
      }, cancelRef);

      await page.waitForTimeout(700);
      const cancelCheck = await page.evaluate((ref) => {
        const card = Array.from(document.querySelectorAll("#my-requests .request-card")).find((c) => c.innerText.includes(ref));
        return {
          foundCard: !!card,
          hasCancelled: !!card && !!card.querySelector(".status-cancelled"),
        };
      }, cancelRef);
      const cancelled = cancelledResult.found;
      const hasCancelled = cancelCheck.hasCancelled;
      if (cancelled && !hasCancelled) add("error", "flow:cancel", "cancelling a request did not change its status");
      else if (cancelled) add("info", "flow:cancel", "customer cancelled a booking");

      // A second booking stays active for the owner workflow below.
      await page.goto(`${base}/contact`, { waitUntil: "domcontentloaded" });
      await waitHydrated(page);
      await page.waitForFunction(() => document.querySelectorAll("[data-booking-fields] .form-field").length > 0, { timeout: 20000 }).catch(() => {});
      await page.evaluate((email) => {
        const form = document.getElementById("booking-form");
        const fields = form.querySelectorAll("[data-booking-fields] input, [data-booking-fields] select, [data-booking-fields] textarea");
        const tomorrow = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
        fields.forEach((el) => {
          if (el.tagName === "SELECT") {
            if (el.options.length > 1) el.value = el.options[1].value;
          } else if (el.type === "date") el.value = tomorrow;
          else if (el.type === "time") el.value = "20:00";
          else if (el.type === "number") el.value = "3";
          else el.value = "QA test";
        });
        form.elements.name.value = "QA Guest";
        form.elements.phone.value = "03001234567";
        form.elements.email.value = email;
        if (form.elements.message) form.elements.message.value = "Second QA booking, kept active for the owner.";
      }, testEmail);
      await page.click('#booking-form button[type="submit"]');
      await page.waitForSelector("#booking-success:not([hidden])", { timeout: 10000 }).catch(() => {});
      const bookingRef2 = ((await page.textContent("#booking-success [data-success-ref]").catch(() => "")) || "").trim();
      if (!/^BK-/.test(bookingRef2)) add("error", "flow:booking2", "second booking did not get a reference");

      await page.goto(`${base}/dashboard`, { waitUntil: "domcontentloaded" });
      await waitHydrated(page);
      await page.fill("#profile-name", "QA Customer");
      await page.fill("#profile-phone", "03007654321");
      await page.click('#profile-form button[type="submit"]');
      await page.waitForFunction(
        () => /updated/i.test((document.getElementById("profile-status") || {}).textContent || ""),
        { timeout: 5000 }
      ).catch(() => {});
      const profileOk = await page.evaluate(() => /updated/i.test((document.getElementById("profile-status") || {}).textContent || ""));
      if (!profileOk) add("error", "flow:profile", "profile update did not confirm");
      const dashShot = path.join(outDir, "dashboard-customer.png");
      await page.screenshot({ path: dashShot, fullPage: true });
      screenshots.push(dashShot);

      // Log out and sign in as the owner on the dedicated owner sign-in page.
      await page.click(".js-logout");
      await page.waitForURL(/\/(index\.html)?$/, { timeout: 10000 }).catch(() => {});
      const creds = await getOwnerCreds(site && site.slug ? site.slug : "");
      if (!creds) throw new Error("owner credentials were not available for QA");
      await page.goto(`${base}/admin-login`, { waitUntil: "domcontentloaded" });
      await waitHydrated(page);

      // A wrong password must be rejected without a token. One retry: the
      // status text only appears after the /_api round trip, which can take
      // longer than expected right after a build.
      let rejected = false;
      for (let attempt = 0; attempt < 2 && !rejected; attempt++) {
        if (attempt > 0) {
          await page.goto(`${base}/admin-login`, { waitUntil: "domcontentloaded" });
          await waitHydrated(page);
        }
        await page.fill("#admin-username", creds.username);
        await page.fill("#admin-password", "definitely-wrong");
        await page.click('#admin-login-form button[type="submit"]');
        await page.waitForFunction(
          () => /invalid/i.test((document.getElementById("admin-login-status") || {}).textContent || ""),
          { timeout: 45000 }
        ).catch(() => {});
        rejected = await page.evaluate(() =>
          /invalid/i.test((document.getElementById("admin-login-status") || {}).textContent || "")
        );
      }
      if (!rejected) add("error", "flow:admin-login", "wrong owner password was accepted");
      else add("info", "flow:admin-login", "wrong password rejected on the owner sign-in page");

      let ownerSignedIn = /\/admin(\.html)?$/.test(new URL(page.url()).pathname);
      let ownerStatus = "";
      for (let attempt = 0; attempt < 2 && !ownerSignedIn; attempt++) {
        if (attempt > 0) {
          // A still-pending sign-in leaves the submit button disabled, so a
          // retry has to start from a fresh page.
          await page.goto(`${base}/admin-login`, { waitUntil: "domcontentloaded" });
          await waitHydrated(page);
        }
        await page.fill("#admin-username", creds.username);
        await page.fill("#admin-password", creds.password);
        const nav = page.waitForURL(/\/admin(\.html)?$/, { timeout: 60000 }).then(() => true).catch(() => false);
        await page.click('#admin-login-form button[type="submit"]');
        ownerSignedIn = (await nav) || /\/admin(\.html)?$/.test(new URL(page.url()).pathname);
        ownerStatus = await page.evaluate(() => (document.getElementById("admin-login-status") || {}).textContent || "").catch(() => "");
        if (!ownerSignedIn) await page.waitForTimeout(1500);
      }
      if (!ownerSignedIn) {
        throw new Error(`owner sign-in did not reach admin after 2 attempts (status: "${ownerStatus.slice(0, 120)}")`);
      }
      await waitHydrated(page);
      // Admin data loads async; poll for it instead of a fixed sleep.
      await page
        .waitForFunction(
          () => {
            const name = (document.querySelector("[data-admin-name]") || {}).textContent || "";
            const rows = document.querySelectorAll("#admin-requests .admin-row").length;
            return name.trim().length > 0 && rows > 0;
          },
          { timeout: 20000 }
        )
        .catch(() => {});

      const adminName = (await page.textContent("[data-admin-name]").catch(() => "")) || "";
      if (!adminName.includes(creds.username)) add("error", "flow:admin-login", "owner name was not shown on the admin dashboard");
      else add("info", "flow:admin-login", "owner signed in with the generated credentials");

      const adminBefore = await page.evaluate(() => ({
        rows: document.querySelectorAll("#admin-requests .admin-row").length,
        total: (document.querySelector('[data-stat="total"]') || {}).textContent || "0",
        subscribers: document.querySelectorAll("#subscriber-list .subscriber-row").length,
      }));
      if (adminBefore.rows === 0) add("error", "flow:admin", "owner dashboard shows no requests");
      if (!adminBefore.subscribers) add("error", "flow:admin", "owner dashboard shows no subscribers");
      const adminShot = path.join(outDir, "dashboard-owner.png");
      await page.screenshot({ path: adminShot, fullPage: true });
      screenshots.push(adminShot);

      // Search isolates the two QA submissions.
      await page.fill("#admin-search", testEmail);
      await page
        .waitForFunction(
          (email) => {
            const rows = Array.from(document.querySelectorAll("#admin-requests .admin-row")).map((r) => r.innerText);
            return rows.length === 3 && rows.every((t) => t.includes(email));
          },
          testEmail,
          { timeout: 20000 }
        )
        .catch(() => {});
      const searchRows = await page.evaluate(() =>
        Array.from(document.querySelectorAll("#admin-requests .admin-row")).map((r) => r.innerText)
      );
      if (searchRows.length !== 3) add("error", "flow:admin-search", `search matched ${searchRows.length} rows, expected 3`);
      if (!searchRows.some((t) => t.includes(bookingRef.trim()))) add("error", "flow:admin-search", "first booking not found through admin search");
      if (!searchRows.some((t) => t.includes(bookingRef2))) add("error", "flow:admin-search", "second booking not found through admin search");

      // Update the active booking status from the admin dashboard. The change
      // now round-trips through the builder API and database, so poll for it.
      const statusRow = page.locator("#admin-requests .admin-row", { hasText: bookingRef2 }).locator(".status-select");
      await statusRow.selectOption("confirmed").catch(() => {});
      await page
        .waitForFunction(
          (ref) => {
            const row = Array.from(document.querySelectorAll("#admin-requests .admin-row")).find((r) =>
              r.innerText.includes(ref)
            );
            const sel = row && row.querySelector(".status-select");
            return !!sel && sel.value === "confirmed";
          },
          bookingRef2,
          { timeout: 20000 }
        )
        .catch(() => {});
      const statusValue = await statusRow.inputValue().catch(() => "");
      if (statusValue !== "confirmed") add("error", "flow:admin-status", "status change did not persist in the admin dashboard");
      else add("info", "flow:admin-status", "booking marked confirmed");

      // Subscriber list carries the newsletter signup.
      const subscriberText = await page.textContent("#subscriber-list").catch(() => "");
      if (!subscriberText.includes(newsletterEmail)) add("error", "flow:subscribers", "newsletter subscriber is not listed for the owner");

      // CSV export from the full request set.
      await page.fill("#admin-search", "");
      await page
        .waitForFunction(() => document.querySelectorAll("#admin-requests .admin-row").length >= 3, { timeout: 20000 })
        .catch(() => {});
      try {
        const dlPromise = page.waitForEvent("download", { timeout: 10000 });
        await page.click("#export-csv");
        const download = await dlPromise;
        const csvPath = path.join(outDir, "requests-export.csv");
        await download.saveAs(csvPath);
        const csv = fs.readFileSync(csvPath, "utf8");
        if (!csv.includes(bookingRef.trim()) || !csv.includes(bookingRef2) || !csv.includes(inquiryRef.trim())) {
          add("error", "flow:csv", "CSV export does not contain the submitted requests");
        } else {
          add("info", "flow:csv", `CSV exported (${csv.split(/\r?\n/).length - 1} rows)`);
        }
      } catch (e) {
        add("error", "flow:csv", "CSV export failed: " + e.message);
      }

      await page.click(".js-logout");
      await page.waitForURL(/\/admin-login(\.html)?$/, { timeout: 10000 }).catch(() => {});
    } catch (e) {
      add("error", "flow:customer-owner", e.message);
    } finally {
      await flowCtx.close().catch(() => {});
      await cleanupSiteData(site && site.slug ? site.slug : "", [testEmail, newsletterEmail]);
    }

    if (!customerLogin) add("error", "flow:login-customer", "customer login did not complete");

    // Registration + dashboard.
    try {
      const regCtx = await browser.newContext({ viewport: desktop });
      const { page, bag } = await open(regCtx, "login");
      await waitHydrated(page);
      await page.click('.auth-tab[data-mode="register"]');
      const unique = `qa+new-${Date.now()}@example.com`;
      await page.fill("#reg-name", "QA Tester");
      await page.fill("#reg-email", unique);
      await page.fill("#reg-phone", "03001112223");
      await page.fill("#reg-password", "qa-pass-123");
      await page.fill("#reg-confirm", "qa-pass-123");
      await Promise.all([
        page.waitForURL(/\/dashboard(\.html)?$/, { timeout: 30000 }),
        page.click('#register-form button[type="submit"]'),
      ]);
      await waitHydrated(page);
      await page.waitForTimeout(400);
      const who = await page.textContent("[data-user-name]").catch(() => "");
      if (!who.includes("QA Tester")) add("error", "flow:register", "new account did not reach its dashboard");
      else add("info", "flow:register", "registration + customer dashboard work");
      reportPageErrors(bag, "flow:register");
      await regCtx.close();
    } catch (e) {
      add("error", "flow:register", e.message);
    }

    // Signed-out dashboard guard.
    try {
      const guardCtx = await browser.newContext({ viewport: desktop });
      const page = await guardCtx.newPage();
      await page.goto(`${base}/dashboard`, { waitUntil: "domcontentloaded" });
      await page.waitForURL(/\/login(\.html)?\?next=dashboard/, { timeout: 20000 }).catch(() => {});
      if (!/\/login(\.html)?$/.test(new URL(page.url()).pathname)) {
        add("error", "flow:guard-signed-out", "signed-out visitor was not redirected to login");
      } else {
        add("info", "flow:guard-signed-out", "signed-out dashboard redirect works");
      }
      await guardCtx.close();
    } catch (e) {
      add("error", "flow:guard-signed-out", e.message);
    }

    // Guest tracking flow: book without an account, click [data-account-link], reach dashboard?track without redirect.
    try {
      const guestCtx = await browser.newContext({ viewport: desktop });
      const page = await guestCtx.newPage();
      await page.goto(`${base}/contact`, { waitUntil: "domcontentloaded" });
      await waitHydrated(page);
      await page.waitForFunction(() => document.querySelectorAll("[data-booking-fields] .form-field").length > 0, { timeout: 20000 }).catch(() => {});
      const guestEmail = `qa+guest-${Date.now()}@example.com`;
      await page.evaluate((email) => {
        const form = document.getElementById("booking-form");
        if (!form) return;
        const fields = form.querySelectorAll("[data-booking-fields] input, [data-booking-fields] select, [data-booking-fields] textarea");
        const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
        fields.forEach((el) => {
          if (el.tagName === "SELECT") {
            if (el.options.length > 1) el.value = el.options[1].value;
          } else if (el.type === "date") el.value = tomorrow;
          else if (el.type === "time") el.value = "19:00";
          else if (el.type === "number") el.value = "2";
          else el.value = "QA test";
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
        });
        form.elements.name.value = "Guest Visitor";
        form.elements.phone.value = "03001234567";
        form.elements.email.value = email;
      }, guestEmail);
      await page.click('#booking-form button[type="submit"]');
      await page.waitForSelector("#booking-success:not([hidden])", { timeout: 10000 }).catch(() => {});
      const bookingRef = ((await page.textContent("#booking-success [data-success-ref]").catch(() => "")) || "").trim();
      if (!/^BK-/.test(bookingRef)) {
        add("error", "flow:guest-booking", "booking success panel did not show a BK reference");
      } else {
        await Promise.all([
          page.waitForURL(/\/dashboard(\.html)?\?track/, { timeout: 20000 }),
          page.click("#booking-success [data-account-link]"),
        ]);
        await waitHydrated(page);
        await page.waitForTimeout(500);
        const cardRef = ((await page.textContent("#my-requests .ref-tag").catch(() => "")) || "").trim();
        if (cardRef !== bookingRef) {
          add("error", "flow:guest-tracking", `tracked card did not match reference ${bookingRef} (got: ${cardRef})`);
        } else {
          add("info", "flow:guest-tracking", `guest booking tracked successfully on dashboard (${cardRef})`);
        }
      }
      await guestCtx.close();
    } catch (e) {
      add("error", "flow:guest-tracking", e.message);
    }
  } finally {
    await browser.close().catch(() => {});
    server.close();
  }

  return { checks, screenshots };
}

module.exports = { run };
