/* Dukan Builder — forms.js (locked)
   Booking, enquiry and newsletter forms on the public pages. All submissions
   go into the browser-local demo store so the admin and customer dashboards
   see exactly what was submitted. */
(function () {
  function today() {
    return new Date().toISOString().slice(0, 10);
  }

  function setStatus(el, message, kind) {
    if (!el) return;
    el.textContent = message || "";
    el.className = "form-note" + (kind ? " is-" + kind : "");
  }

  function makeField(field, services) {
    var wrap = document.createElement("div");
    wrap.className = "form-field";
    var id = "f-" + field.name;
    var label = document.createElement("label");
    label.setAttribute("for", id);
    label.textContent = field.label + (field.required ? " *" : "");
    wrap.appendChild(label);

    var control;
    if (field.type === "select") {
      control = document.createElement("select");
      var blank = document.createElement("option");
      blank.value = "";
      blank.textContent = "Please choose";
      control.appendChild(blank);
      var options = field.source === "services" && services && services.length
        ? services.map(function (s) { return s.name; })
        : field.options || [];
      options.forEach(function (value) {
        var option = document.createElement("option");
        option.value = value;
        option.textContent = value;
        control.appendChild(option);
      });
    } else {
      control = document.createElement("input");
      control.type = field.type || "text";
      if (field.placeholder) control.placeholder = field.placeholder;
      if (field.min != null) control.min = field.min;
      if (field.max != null) control.max = field.max;
      if (control.type === "date") control.min = today();
    }
    control.id = id;
    control.name = field.name;
    control.required = !!field.required;
    wrap.appendChild(control);
    return wrap;
  }

  function prefill(form, user) {
    if (!user) return;
    [["name", user.name], ["email", user.email], ["phone", user.phone]].forEach(function (pair) {
      var input = form.elements[pair[0]];
      if (input && !input.value) input.value = pair[1] || "";
    });
  }

  function showSuccess(form, panel, request) {
    form.hidden = true;
    if (!panel) return;
    panel.hidden = false;
    var ref = panel.querySelector("[data-success-ref]");
    if (ref) ref.textContent = request.ref;
    var account = panel.querySelector("[data-account-link]");
    if (account) {
      var user = window.DukanStore ? window.DukanStore.currentUser() : null;
      account.setAttribute("href", user ? "dashboard" : "dashboard?track=" + encodeURIComponent(request.ref));
    }
    panel.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function warnPanel(panelId, message) {
    var panel = document.getElementById(panelId);
    if (!panel || panel.querySelector("[data-remote-warning]")) return;
    var warn = document.createElement("p");
    warn.className = "form-note is-error";
    warn.setAttribute("data-remote-warning", "true");
    warn.textContent = message;
    panel.appendChild(warn);
  }

  function setupBooking(site) {
    var form = document.getElementById("booking-form");
    if (!form || !window.DukanStore || !window.DukanCategory) return;
    var category = window.DukanCategory.get(site.category);
    var fields = document.querySelector("[data-booking-fields]");
    var services = Array.isArray(site.services) ? site.services : [];
    if (fields) {
      fields.textContent = "";
      category.fields.forEach(function (field) {
        fields.appendChild(makeField(field, services));
      });
    }
    var title = document.querySelector("[data-booking-title]");
    if (title) title.textContent = category.bookTitle;
    var blurb = document.querySelector("[data-booking-blurb]");
    if (blurb) blurb.textContent = category.bookBlurb;
    var requestLabel = document.querySelector("[data-request-label]");
    if (requestLabel) requestLabel.textContent = category.request;

    prefill(form, window.DukanStore.currentUser());
    var note = form.querySelector("[data-form-status]");

    form.addEventListener("submit", function (event) {
      event.preventDefault();
      if (!form.reportValidity()) return;
      var values = {};
      category.fields.forEach(function (field) {
        var el = form.elements[field.name];
        if (el && el.value) values[field.name] = el.value;
      });
      var result = window.DukanStore.createRequest({
        type: "booking",
        name: form.elements.name.value,
        email: form.elements.email.value,
        phone: form.elements.phone.value,
        message: form.elements.message ? form.elements.message.value : "",
        fields: values
      });
      if (!result.ok) {
        setStatus(note, result.error, "error");
        return;
      }
      showSuccess(form, document.getElementById("booking-success"), result.request);
      if (result.remote) {
        result.remote.then(function (out) {
          if (!out.ok) {
            warnPanel("booking-success", "Saved for you, but the business may not have received it. Please call to confirm.");
          }
        });
      }
    });
  }

  function setupInquiry() {
    var form = document.getElementById("inquiry-form");
    if (!form || !window.DukanStore) return;
    prefill(form, window.DukanStore.currentUser());
    var note = form.querySelector("[data-form-status]");
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      if (!form.reportValidity()) return;
      var result = window.DukanStore.createRequest({
        type: "inquiry",
        name: form.elements.name.value,
        email: form.elements.email.value,
        phone: form.elements.phone ? form.elements.phone.value : "",
        message: form.elements.message.value
      });
      if (!result.ok) {
        setStatus(note, result.error, "error");
        return;
      }
      showSuccess(form, document.getElementById("inquiry-success"), result.request);
      if (result.remote) {
        result.remote.then(function (out) {
          if (!out.ok) {
            warnPanel("inquiry-success", "Saved for you, but the business may not have received it. Please call to confirm.");
          }
        });
      }
    });
  }

  function setupNewsletters() {
    if (!window.DukanStore) return;
    document.querySelectorAll("#newsletter-form").forEach(function (form) {
      var user = window.DukanStore.currentUser();
      if (user && form.elements.email && !form.elements.email.value) {
        form.elements.email.value = user.email;
      }
      var note = form.querySelector("[data-form-status]");
      form.addEventListener("submit", function (event) {
        event.preventDefault();
        if (!form.reportValidity()) return;
        var result = window.DukanStore.createRequest({
          type: "newsletter",
          name: user ? user.name : "",
          email: form.elements.email.value
        });
        if (!result.ok) {
          setStatus(note, result.error, result.error.indexOf("already") >= 0 ? "info" : "error");
          return;
        }
        setStatus(note, "Saving…", "");
        if (result.remote) {
          result.remote.then(function (out) {
            if (out.ok) {
              setStatus(note, "You are subscribed. Thank you!", "success");
              form.reset();
              if (user) form.elements.email.value = user.email;
            } else if ((out.error || "").indexOf("already") >= 0) {
              setStatus(note, out.error, "info");
            } else {
              setStatus(note, "Saved for you, but the business may not receive it. Please call.", "error");
            }
          });
        }
      });
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    var sitePromise = window.DukanSite ? window.DukanSite.ready : Promise.resolve(null);
    sitePromise.then(function (site) {
      if (!site) return;
      setupBooking(site);
      setupInquiry();
      setupNewsletters();
    });
  });
})();
