/* Dukan Builder — theme.js (locked)
   Loads site.json once, applies the palette and contact links, and exposes
   window.DukanSite.ready so the other scripts can wait for the data. */
(function () {
  var listeners = [];
  var readyResolve;
  var ready = new Promise(function (resolve) { readyResolve = resolve; });

  function digits(phone) {
    var d = String(phone || "").replace(/\D/g, "");
    if (d.charAt(0) === "0") d = "92" + d.slice(1);
    return d;
  }

  function apply(site) {
    window.DukanSite.data = site;
    var root = document.documentElement.style;
    if (site.palette) {
      if (site.palette.primary) root.setProperty("--primary", site.palette.primary);
      if (site.palette.accent) root.setProperty("--accent", site.palette.accent);
      if (site.palette.bg) root.setProperty("--bg", site.palette.bg);
    }
    document.querySelectorAll('[data-slot="business_name"]').forEach(function (el) {
      el.textContent = site.business_name;
    });
    document.querySelectorAll("title[data-title-template]").forEach(function (el) {
      el.textContent = el.getAttribute("data-title-template").replace("{name}", site.business_name);
    });
    document.querySelectorAll(".js-year").forEach(function (el) {
      el.textContent = new Date().getFullYear();
    });
    document.querySelectorAll('[data-slot-href^="tel:"]').forEach(function (el) {
      el.setAttribute("href", "tel:" + digits(site.phone));
    });
    var waText = encodeURIComponent(
      "Assalam-o-Alaikum! I found " + site.business_name + " online and wanted to ask about "
    );
    document.querySelectorAll('[data-slot-href^="wa:"]').forEach(function (el) {
      el.setAttribute("href", "https://wa.me/" + digits(site.phone) + "?text=" + waText);
    });
    listeners.forEach(function (fn) { fn(site); });
    readyResolve(site);
  }

  window.DukanSite = {
    data: null,
    ready: ready,
    digits: digits,
    onReady: function (fn) {
      if (window.DukanSite.data) fn(window.DukanSite.data);
      else listeners.push(fn);
    },
  };

  fetch("site.json", { cache: "no-store" })
    .then(function (r) { return r.json(); })
    .then(apply)
    .catch(function () {
      readyResolve(null);
    });
})();
