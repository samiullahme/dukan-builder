/* Dukan Builder — site.js (locked)
   Hydrates content slots on every public page. Keep the slot contract:
     [data-slot]              text from site.json
     [data-slot-attr]        attribute from site.json
     [data-slot-src]         image / video source
     #services-grid          service cards from site.json services[]
     #gallery-grid           gallery images from site.json gallery[]
   theme.js handles the palette and tel/WhatsApp links. */
(function () {
  function ready(fn) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fn);
    else fn();
  }

  ready(function () {
    var sitePromise = window.DukanSite ? window.DukanSite.ready : Promise.resolve(null);

    var toggle = document.querySelector(".nav-toggle");
    var links = document.getElementById("nav-links");
    if (toggle && links) {
      toggle.addEventListener("click", function () {
        var open = links.classList.toggle("is-open");
        toggle.setAttribute("aria-expanded", open ? "true" : "false");
      });
    }

    var authLink = document.querySelector(".js-auth-link");
    if (authLink && window.DukanStore) {
      var user = window.DukanStore.currentUser();
      if (user) {
        authLink.textContent = "My dashboard";
        authLink.setAttribute("href", "dashboard.html");
      }
    }

    sitePromise.then(function (site) {
      if (!site) return;

      document.querySelectorAll("[data-slot]").forEach(function (el) {
        var key = el.getAttribute("data-slot");
        var value = site[key];
        if (value != null && typeof value !== "object") el.textContent = value;
      });

      document.querySelectorAll("[data-slot-attr]").forEach(function (el) {
        var parts = el.getAttribute("data-slot-attr").split(":");
        var attr = parts.shift();
        var key = parts.join(":");
        if (attr && site[key] != null) el.setAttribute(attr, site[key]);
      });

      document.querySelectorAll("[data-slot-src]").forEach(function (el) {
        var value = site[el.getAttribute("data-slot-src")];
        if (value) el.setAttribute("src", value);
        else el.style.display = "none";
      });

      var category = window.DukanCategory ? window.DukanCategory.get(site.category) : null;
      if (category) {
        document.querySelectorAll("[data-book-label]").forEach(function (el) {
          el.textContent = category.cta;
        });
        document.querySelectorAll("[data-request-label]").forEach(function (el) {
          el.textContent = category.request;
        });
      }

      var grid = document.getElementById("services-grid");
      if (grid && Array.isArray(site.services)) {
        grid.textContent = "";
        site.services.forEach(function (service) {
          var card = document.createElement("article");
          card.className = "service-card";
          var head = document.createElement("div");
          head.className = "service-head";
          var title = document.createElement("h3");
          title.textContent = service.name || "Service";
          head.appendChild(title);
          if (service.price) {
            var price = document.createElement("span");
            price.className = "service-price";
            price.textContent = service.price;
            head.appendChild(price);
          }
          var desc = document.createElement("p");
          desc.textContent = service.desc || "";
          card.appendChild(head);
          card.appendChild(desc);
          grid.appendChild(card);
        });
      }

      var galleryGrid = document.getElementById("gallery-grid");
      var gallerySection = document.getElementById("gallery");
      var galleryEmpty = document.getElementById("gallery-empty");
      var images = Array.isArray(site.gallery) ? site.gallery.filter(Boolean) : [];
      if (galleryGrid) {
        galleryGrid.textContent = "";
        images.forEach(function (url) {
          var img = document.createElement("img");
          img.src = url;
          img.loading = "lazy";
          img.alt = site.business_name + " gallery photo";
          img.onerror = function () { this.style.display = "none"; };
          galleryGrid.appendChild(img);
        });
        if (gallerySection) gallerySection.hidden = images.length === 0 && !galleryEmpty;
        if (galleryEmpty) galleryEmpty.hidden = images.length > 0;
      }

      if (document.getElementById("year")) {
        document.getElementById("year").textContent = new Date().getFullYear();
      }

      var credits = Array.isArray(site.media_credits) ? site.media_credits.filter(function (c) { return c && c.name; }) : [];
      if (credits.length) {
        document.querySelectorAll(".footer").forEach(function (footer) {
          if (footer.querySelector(".media-credits")) return;
          var host = footer.querySelector(".footer-inner") || footer;
          var p = document.createElement("p");
          p.className = "media-credits";
          p.style.cssText = "margin-top:14px;font-size:11px;line-height:1.6;opacity:.62;letter-spacing:.01em";
          p.appendChild(document.createTextNode("Media: "));
          credits.slice(0, 4).forEach(function (credit, i) {
            if (i) p.appendChild(document.createTextNode(" · "));
            if (credit.url) {
              var a = document.createElement("a");
              a.href = credit.url;
              a.target = "_blank";
              a.rel = "noopener noreferrer";
              a.style.cssText = "text-decoration:underline;text-underline-offset:2px";
              a.textContent = credit.name;
              p.appendChild(a);
            } else {
              p.appendChild(document.createTextNode(credit.name));
            }
          });
          host.appendChild(p);
        });
      }
    });
  });
})();
