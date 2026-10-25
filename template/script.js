/* ============================================================
   Dukan Builder base template — script.js
   Hydrates the page from site.json:
     - [data-slot="name"]        -> text content from site.json
     - [data-slot-href="tel:x"]  -> href="tel:<digits>"
     - [data-slot-href="wa:x"]   -> href="https://wa.me/<digits>"
     - [data-slot-src="key"]     -> src attribute from site.json (img/video)
     - #services-grid            -> cards from site.json services[]
     - #gallery-grid             -> images from site.json gallery[]
     - palette                   -> CSS variables --primary/--accent/--bg
   The AI may extend this file, but keep the slot contract.
   ============================================================ */
(function () {
  function digits(phone) {
    var d = String(phone || "").replace(/\D/g, "");
    if (d.charAt(0) === "0") d = "92" + d.slice(1); // PK mobile -> intl
    return d;
  }

  fetch("site.json")
    .then(function (r) { return r.json(); })
    .then(function (site) {
      // text slots
      document.querySelectorAll("[data-slot]").forEach(function (el) {
        var key = el.getAttribute("data-slot");
        if (site[key] != null && typeof site[key] !== "object") el.textContent = site[key];
      });
      // attribute slots: data-slot-attr="content:tagline"
      document.querySelectorAll("[data-slot-attr]").forEach(function (el) {
        var parts = el.getAttribute("data-slot-attr").split(":");
        var attr = parts.shift();
        var key = parts.join(":");
        if (attr && site[key] != null) el.setAttribute(attr, site[key]);
      });
      // src slots (img/video) — hide if empty
      document.querySelectorAll("[data-slot-src]").forEach(function (el) {
        var key = el.getAttribute("data-slot-src");
        var val = site[key];
        if (val) {
          el.setAttribute("src", val);
        } else {
          el.style.display = "none";
        }
      });
      // phone link slots
      document.querySelectorAll('[data-slot-href^="tel:"]').forEach(function (el) {
        el.setAttribute("href", "tel:" + digits(site.phone));
      });
      document.querySelectorAll('[data-slot-href^="wa:"]').forEach(function (el) {
        var text = encodeURIComponent("Assalam-o-Alaikum! I saw your website and wanted to ask about ");
        el.setAttribute("href", "https://wa.me/" + digits(site.phone) + "?text=" + text);
      });
      // palette -> CSS variables
      if (site.palette) {
        var root = document.documentElement.style;
        if (site.palette.primary) root.setProperty("--primary", site.palette.primary);
        if (site.palette.accent) root.setProperty("--accent", site.palette.accent);
        if (site.palette.bg) root.setProperty("--bg", site.palette.bg);
      }
      // services grid
      var grid = document.getElementById("services-grid");
      if (grid && Array.isArray(site.services)) {
        grid.innerHTML = "";
        site.services.forEach(function (s) {
          var card = document.createElement("div");
          card.className = "service-card";
          var h = document.createElement("h3");
          h.textContent = s.name || "Service";
          var p = document.createElement("p");
          p.textContent = s.desc || "";
          card.appendChild(h);
          card.appendChild(p);
          grid.appendChild(card);
        });
      }
      // gallery grid
      var ggrid = document.getElementById("gallery-grid");
      var gsection = document.getElementById("gallery");
      if (ggrid && Array.isArray(site.gallery) && site.gallery.length > 0) {
        ggrid.innerHTML = "";
        site.gallery.forEach(function (url) {
          var img = document.createElement("img");
          img.setAttribute("src", url);
          img.setAttribute("loading", "lazy");
          img.setAttribute("alt", site.business_name || "Gallery image");
          img.onerror = function () { this.style.display = "none"; };
          ggrid.appendChild(img);
        });
        if (gsection) gsection.style.display = "";
      }
      // footer year
      var y = document.getElementById("year");
      if (y) y.textContent = new Date().getFullYear();
    })
    .catch(function () {
      var y = document.getElementById("year");
      if (y) y.textContent = new Date().getFullYear();
    });
})();
