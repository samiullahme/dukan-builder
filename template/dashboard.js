/* Dukan Builder — dashboard.js (locked)
   Customer dashboard: my requests, cancel a booking, update profile. */
(function () {
  var user = null;

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function fmtDate(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return "";
    return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  }

  function fieldEntries(request) {
    var site = window.DukanSite ? window.DukanSite.data : null;
    var cat = window.DukanCategory ? window.DukanCategory.get(site ? site.category : "other") : { fields: [] };
    var labels = {};
    cat.fields.forEach(function (field) { labels[field.name] = field.label; });
    return Object.keys(request.fields || {}).map(function (key) {
      var label = labels[key] || key.replace(/_/g, " ").replace(/\b\w/g, function (c) { return c.toUpperCase(); });
      return [label, request.fields[key]];
    });
  }

  function statusPill(status) {
    var label = window.DukanCategory ? window.DukanCategory.statusLabel(status) : status;
    return el("span", "pill status-" + status, label);
  }

  function requestCard(request) {
    var card = el("article", "dash-card request-card");
    var top = el("div", "request-top");
    var left = el("div", "");
    var meta = el("div", "request-meta");
    meta.appendChild(el("span", "ref-tag", request.ref));
    if (request.sample) meta.appendChild(el("span", "sample-tag", "Sample"));
    left.appendChild(meta);
    var typeLabel = request.type === "booking"
      ? (window.DukanCategory && window.DukanSite && window.DukanSite.data
          ? window.DukanCategory.get(window.DukanSite.data.category).request
          : "Booking")
      : "Enquiry";
    left.appendChild(el("h3", "", typeLabel));
    left.appendChild(el("p", "request-date", "Submitted " + fmtDate(request.createdAt)));
    top.appendChild(left);
    top.appendChild(statusPill(request.status));
    card.appendChild(top);

    var entries = fieldEntries(request);
    if (entries.length) {
      var dl = el("dl", "request-fields");
      entries.forEach(function (pair) {
        dl.appendChild(el("dt", "", pair[0]));
        dl.appendChild(el("dd", "", pair[1]));
      });
      card.appendChild(dl);
    }
    if (request.message) card.appendChild(el("p", "request-message", request.message));

    if (request.type === "booking" && (request.status === "new" || request.status === "confirmed")) {
      var actions = el("div", "request-actions");
      var cancel = el("button", "btn btn-small btn-danger", "Cancel request");
      cancel.type = "button";
      cancel.setAttribute("data-cancel", request.id);
      actions.appendChild(cancel);
      card.appendChild(actions);
    }
    return card;
  }

  function render() {
    if (!window.DukanStore) return;
    document.querySelectorAll("[data-user-name]").forEach(function (node) {
      node.textContent = user ? user.name : "Guest";
    });

    var list = user
      ? window.DukanStore.myRequests().filter(function (r) { return r.type !== "newsletter"; })
      : window.DukanStore.guestRequests();
    var active = list.filter(function (r) { return r.status === "new" || r.status === "confirmed"; });
    var cancelled = list.filter(function (r) { return r.status === "cancelled"; });
    var stats = {
      total: list.length,
      active: active.length,
      cancelled: cancelled.length
    };
    Object.keys(stats).forEach(function (key) {
      var node = document.querySelector('[data-stat="' + key + '"]');
      if (node) node.textContent = stats[key];
    });

    var container = document.getElementById("my-requests");
    var empty = document.getElementById("requests-empty");
    if (container) {
      container.textContent = "";
      list.forEach(function (request) { container.appendChild(requestCard(request)); });
    }
    if (empty) empty.hidden = list.length > 0;

    var profile = document.getElementById("profile-form");
    if (profile && user) {
      profile.elements.name.value = user.name;
      profile.elements.email.value = user.email;
      profile.elements.phone.value = user.phone || "";
    }
  }

  document.addEventListener("DOMContentLoaded", function () {
    if (!window.DukanStore) return;
    user = window.DukanStore.currentUser();
    var params = new URLSearchParams(location.search);
    var isTrack = params.has("track");
    var trackRef = params.get("track") || "";

    if (!user && !isTrack) {
      location.replace("login?next=dashboard");
      return;
    }

    if (!user) {
      var profileAside = document.getElementById("profile-aside");
      var trackAside = document.getElementById("track-aside");
      if (profileAside) profileAside.hidden = true;
      if (trackAside) trackAside.hidden = false;
      document.querySelectorAll(".js-logout").forEach(function (btn) {
        btn.textContent = "Sign in";
        btn.addEventListener("click", function () {
          location.href = "login?next=dashboard";
        });
      });
    } else {
      document.querySelectorAll(".js-logout").forEach(function (button) {
        button.addEventListener("click", function () {
          window.DukanStore.logout();
          location.href = "/";
        });
      });
    }

    var trackForm = document.getElementById("track-form");
    if (trackForm) {
      if (trackRef && trackForm.elements.ref && !trackForm.elements.ref.value) {
        trackForm.elements.ref.value = trackRef;
      }
      trackForm.addEventListener("submit", function (event) {
        event.preventDefault();
        if (!trackForm.reportValidity()) return;
        var note = document.getElementById("track-status");
        var rVal = trackForm.elements.ref.value.trim().toUpperCase();
        var eVal = trackForm.elements.email.value.trim();
        if (note) { note.textContent = "Looking up…"; note.className = "form-note"; }
        window.DukanStore.syncRequests(eVal, [rVal]).then(function (res) {
          if (!note) return;
          if (res && res.length) {
            note.textContent = "Status updated.";
            note.className = "form-note is-success";
          } else {
            note.textContent = "No request found with that reference and email.";
            note.className = "form-note is-error";
          }
        });
      });
    }

    window.DukanStore.ready.then(function () {
      render();
      var list = user
        ? window.DukanStore.myRequests().filter(function (r) { return r.type !== "newsletter"; })
        : window.DukanStore.guestRequests();
      var byEmail = {};
      list.forEach(function (r) {
        if (r.email && r.ref) {
          var e = r.email.toLowerCase();
          if (!byEmail[e]) byEmail[e] = [];
          byEmail[e].push(r.ref);
        }
      });
      Object.keys(byEmail).forEach(function (e) {
        window.DukanStore.syncRequests(e, byEmail[e]);
      });
    });

    var list = document.getElementById("my-requests");
    if (list) {
      list.addEventListener("click", function (event) {
        var button = event.target.closest("[data-cancel]");
        if (!button) return;
        if (!window.confirm("Cancel this request? The business will still see it as cancelled.")) return;
        var result = window.DukanStore.cancelRequest(button.getAttribute("data-cancel"));
        if (!result.ok) {
          window.alert(result.error);
          return;
        }
        render();
      });
    }

    var profile = document.getElementById("profile-form");
    if (profile && user) {
      profile.addEventListener("submit", function (event) {
        event.preventDefault();
        if (!profile.reportValidity()) return;
        var note = document.getElementById("profile-status");
        var result = window.DukanStore.updateProfile({
          name: profile.elements.name.value,
          phone: profile.elements.phone.value
        });
        if (!result.ok) {
          if (note) { note.textContent = result.error; note.className = "form-note is-error"; }
          return;
        }
        user = result.user;
        if (note) { note.textContent = "Profile updated."; note.className = "form-note is-success"; }
        render();
      });
    }

    window.addEventListener("dukan:store", render);
  });
})();
