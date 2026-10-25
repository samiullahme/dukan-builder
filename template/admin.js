/* Dukan Builder — admin.js (locked)
   Owner dashboard: every request submitted through the public forms, with
   search, status updates, full details, CSV export and subscriber management.
   Data comes from the builder's Supabase-backed /_api/site-data endpoints. */
(function () {
  var user = null;
  var view = { type: "all", status: "all", q: "" };
  var state = { requests: [], subscribers: [] };

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

  function fmtTime(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return "";
    return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  }

  function category() {
    var site = window.DukanSite ? window.DukanSite.data : null;
    return window.DukanCategory.get(site ? site.category : "other");
  }

  function fieldLabel(name) {
    var match = category().fields.find(function (field) { return field.name === name; });
    if (match) return match.label;
    return name.replace(/_/g, " ").replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  }

  function requestLabel(request) {
    if (request.type === "inquiry") return "Enquiry";
    return category().request;
  }

  function allRequests() {
    return state.requests.filter(function (r) { return r.type !== "newsletter"; });
  }

  function visibleRequests() {
    var q = view.q.trim().toLowerCase();
    return allRequests().filter(function (r) {
      if (view.type === "sample" && !r.sample) return false;
      if ((view.type === "booking" || view.type === "inquiry") && r.type !== view.type) return false;
      if (view.status !== "all" && r.status !== view.status) return false;
      if (!q) return true;
      var haystack = [r.ref, r.name, r.email, r.phone, r.message]
        .concat(Object.keys(r.fields).map(function (key) { return r.fields[key]; }))
        .join(" ")
        .toLowerCase();
      return haystack.indexOf(q) >= 0;
    });
  }

  function summaryOf(request) {
    var values = Object.keys(request.fields).map(function (key) { return request.fields[key]; });
    if (values.length) return values.slice(0, 3).join(" · ");
    return request.message.length > 70 ? request.message.slice(0, 70) + "…" : request.message;
  }

  function waHref(phone) {
    var digits = String(phone || "").replace(/\D/g, "");
    if (digits.charAt(0) === "0") digits = "92" + digits.slice(1);
    return digits.length >= 10 ? "https://wa.me/" + digits : "";
  }

  function updateStats() {
    var requests = allRequests();
    var counts = {
      total: requests.length,
      new: requests.filter(function (r) { return r.status === "new"; }).length,
      bookings: requests.filter(function (r) { return r.type === "booking"; }).length,
      subscribers: state.subscribers.length
    };
    Object.keys(counts).forEach(function (key) {
      var node = document.querySelector('[data-stat="' + key + '"]');
      if (node) node.textContent = counts[key];
    });
  }

  function statusSelect(request) {
    var select = el("select", "status-select");
    select.setAttribute("data-id", request.id);
    select.setAttribute("aria-label", "Status for " + request.ref);
    window.DukanCategory.statusOptions(request.type).forEach(function (status) {
      var option = el("option", "", window.DukanCategory.statusLabel(status));
      option.value = status;
      if (status === request.status) option.selected = true;
      select.appendChild(option);
    });
    return select;
  }

  function requestRow(request) {
    var row = el("article", "admin-row" + (request.sample ? " is-sample" : ""));
    row.setAttribute("data-id", request.id);

    var main = el("div", "cell-main");
    var tags = el("div", "row-tags");
    tags.appendChild(el("span", "ref-tag", request.ref));
    tags.appendChild(el("span", "type-badge", requestLabel(request)));
    if (request.sample) tags.appendChild(el("span", "sample-tag", "Sample"));
    main.appendChild(tags);
    main.appendChild(el("strong", "row-name", request.name || "Guest"));
    var contact = el("div", "row-contact");
    var email = el("a", "", request.email);
    email.href = "mailto:" + request.email;
    contact.appendChild(email);
    if (request.phone) {
      contact.appendChild(el("span", "", " · "));
      var wa = waHref(request.phone);
      if (wa) {
        var phoneLink = el("a", "", request.phone);
        phoneLink.href = wa;
        phoneLink.target = "_blank";
        phoneLink.rel = "noopener";
        contact.appendChild(phoneLink);
      } else {
        contact.appendChild(el("span", "", request.phone));
      }
    }
    main.appendChild(contact);

    var summary = el("p", "cell-summary", summaryOf(request));
    var date = el("div", "cell-date");
    date.appendChild(el("span", "", fmtDate(request.createdAt)));
    date.appendChild(el("small", "", fmtTime(request.createdAt)));

    var statusCell = el("div", "cell-status");
    statusCell.appendChild(statusSelect(request));

    var actions = el("div", "cell-actions");
    var emailBtn = el("a", "mini-btn", "Email");
    emailBtn.href = "mailto:" + request.email +
      "?subject=" + encodeURIComponent("Your " + requestLabel(request).toLowerCase() + " " + request.ref);
    actions.appendChild(emailBtn);
    var waHrefValue = waHref(request.phone);
    if (waHrefValue) {
      var waBtn = el("a", "mini-btn", "WhatsApp");
      waBtn.href = waHrefValue;
      waBtn.target = "_blank";
      waBtn.rel = "noopener";
      actions.appendChild(waBtn);
    }

    var details = el("details", "admin-details");
    details.appendChild(el("summary", "", "Full details"));
    var dl = el("dl", "detail-list");
    dl.appendChild(el("dt", "", "Contact"));
    dl.appendChild(el("dd", "", request.name + " · " + request.email + (request.phone ? " · " + request.phone : "")));
    Object.keys(request.fields).forEach(function (key) {
      dl.appendChild(el("dt", "", fieldLabel(key)));
      dl.appendChild(el("dd", "", request.fields[key]));
    });
    dl.appendChild(el("dt", "", "Submitted"));
    dl.appendChild(el("dd", "", fmtDate(request.createdAt) + " at " + fmtTime(request.createdAt)));
    details.appendChild(dl);
    if (request.message) {
      details.appendChild(el("p", "detail-message", request.message));
    }

    row.appendChild(main);
    row.appendChild(summary);
    row.appendChild(date);
    row.appendChild(statusCell);
    row.appendChild(actions);
    row.appendChild(details);
    return row;
  }

  function renderRequests() {
    var container = document.getElementById("admin-requests");
    var empty = document.getElementById("admin-empty");
    var count = document.getElementById("request-count");
    if (!container) return;
    var rows = visibleRequests();
    container.textContent = "";
    rows.forEach(function (request) { container.appendChild(requestRow(request)); });
    if (empty) empty.hidden = rows.length > 0;
    if (count) count.textContent = rows.length + (rows.length === 1 ? " request" : " requests");
  }

  function renderSubscribers() {
    var container = document.getElementById("subscriber-list");
    var empty = document.getElementById("subscribers-empty");
    if (!container) return;
    var subscribers = state.subscribers;
    container.textContent = "";
    subscribers.forEach(function (subscriber) {
      var row = el("div", "subscriber-row");
      var main = el("div", "");
      main.appendChild(el("strong", "", subscriber.email));
      main.appendChild(el("span", "subscriber-date", "Joined " + fmtDate(subscriber.createdAt)));
      if (subscriber.sample) main.appendChild(el("span", "sample-tag", "Sample"));
      row.appendChild(main);
      var remove = el("button", "mini-btn", "Remove");
      remove.type = "button";
      remove.setAttribute("data-remove-sub", subscriber.id);
      row.appendChild(remove);
      container.appendChild(row);
    });
    if (empty) empty.hidden = subscribers.length > 0;
  }

  function render() {
    document.querySelectorAll("[data-admin-name]").forEach(function (node) {
      node.textContent = user.name;
    });
    updateStats();
    renderRequests();
    renderSubscribers();
  }

  function token() {
    return localStorage.getItem("dukan_admin_token") || "";
  }

  function ownerRequest(method, path, body) {
    var init = { method: method, headers: { "Content-Type": "application/json" } };
    var url = "/_api" + path;
    if (method === "GET") {
      url += (path.indexOf("?") >= 0 ? "&" : "?") + "token=" + encodeURIComponent(token());
    } else {
      init.body = JSON.stringify(Object.assign({}, body || {}, { token: token() }));
    }
    return fetch(url, init)
      .then(function (res) {
        return res
          .json()
          .catch(function () { return {}; })
          .then(function (json) { return { status: res.status, body: json }; });
      })
      .catch(function () { return { status: 0, body: {} }; });
  }

  function loadData() {
    ownerRequest("GET", "/site-data").then(function (out) {
      if (out.status === 401) {
        logout();
        return;
      }
      if (out.status >= 200 && out.status < 300 && out.body && out.body.ok) {
        state.requests = out.body.requests || [];
        state.subscribers = out.body.subscribers || [];
        render();
      } else {
        window.alert("Could not load requests. Please refresh the page.");
      }
    });
  }

  function mutate(method, path, body) {
    ownerRequest(method, path, body).then(function (out) {
      if (out.status === 401) {
        logout();
        return;
      }
      if (!(out.status >= 200 && out.status < 300 && out.body && out.body.ok)) {
        window.alert((out.body && out.body.error) || "That did not work. Please try again.");
        return;
      }
      loadData();
    });
  }

  function downloadCsv() {
    var rows = visibleRequests();
    var keys = [];
    rows.forEach(function (request) {
      Object.keys(request.fields).forEach(function (key) {
        if (keys.indexOf(key) === -1) keys.push(key);
      });
    });
    var header = ["Reference", "Type", "Name", "Email", "Phone", "Status", "Submitted"]
      .concat(keys.map(fieldLabel));
    var quote = function (value) {
      return '"' + String(value == null ? "" : value).replace(/"/g, '""') + '"';
    };
    var lines = [header.map(quote).join(",")];
    rows.forEach(function (request) {
      var base = [
        request.ref,
        requestLabel(request),
        request.name,
        request.email,
        request.phone,
        window.DukanCategory.statusLabel(request.status),
        new Date(request.createdAt).toISOString()
      ];
      keys.forEach(function (key) { base.push(request.fields[key] || ""); });
      lines.push(base.map(quote).join(","));
    });
    var blob = new Blob([lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var link = document.createElement("a");
    link.href = url;
    link.download = "requests-" + (window.DukanStore.slug || "site") + ".csv";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function logout() {
    localStorage.removeItem("dukan_admin_token");
    localStorage.removeItem("dukan_admin_user");
    location.replace("admin-login.html");
  }

  document.addEventListener("DOMContentLoaded", function () {
    if (!window.DukanStore) return;
    var t = token();
    if (!t) {
      location.replace("admin-login.html");
      return;
    }
    fetch("/_api/site-auth/verify?token=" + encodeURIComponent(t))
      .then(function (res) { return res.json(); })
      .then(function (body) {
        if (!body || body.valid !== true) throw new Error("invalid token");
        user = {
          name: body.username || localStorage.getItem("dukan_admin_user") || "Owner",
          role: "owner"
        };
        bindEvents();
        loadData();
      })
      .catch(function () {
        localStorage.removeItem("dukan_admin_token");
        localStorage.removeItem("dukan_admin_user");
        location.replace("admin-login.html");
      });
  });

  function bindEvents() {
    document.querySelectorAll(".js-logout").forEach(function (button) {
      button.addEventListener("click", logout);
    });

    document.querySelectorAll(".filter-tab").forEach(function (tab) {
      tab.addEventListener("click", function () {
        view.type = tab.getAttribute("data-filter");
        document.querySelectorAll(".filter-tab").forEach(function (other) {
          other.classList.toggle("is-active", other === tab);
        });
        renderRequests();
      });
    });

    var statusFilter = document.getElementById("status-filter");
    if (statusFilter) {
      statusFilter.addEventListener("change", function () {
        view.status = statusFilter.value;
        renderRequests();
      });
    }

    var search = document.getElementById("admin-search");
    if (search) {
      search.addEventListener("input", function () {
        view.q = search.value;
        renderRequests();
      });
    }

    var requests = document.getElementById("admin-requests");
    if (requests) {
      requests.addEventListener("change", function (event) {
        var select = event.target.closest(".status-select");
        if (!select) return;
        mutate("PATCH", "/site-data", { id: select.getAttribute("data-id"), status: select.value });
      });
    }

    var subscribers = document.getElementById("subscriber-list");
    if (subscribers) {
      subscribers.addEventListener("click", function (event) {
        var button = event.target.closest("[data-remove-sub]");
        if (!button) return;
        if (!window.confirm("Remove this subscriber?")) return;
        mutate("DELETE", "/site-data/subscriber", { id: button.getAttribute("data-remove-sub") });
      });
    }

    var exportBtn = document.getElementById("export-csv");
    if (exportBtn) exportBtn.addEventListener("click", downloadCsv);

    var clearBtn = document.getElementById("clear-samples");
    if (clearBtn) {
      clearBtn.addEventListener("click", function () {
        if (!window.confirm("Remove all sample requests? Real submissions are kept.")) return;
        mutate("POST", "/site-data/samples/clear", {});
      });
    }
  }
})();
