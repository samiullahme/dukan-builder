/* Dukan Builder — admin-login.js (locked)
   Owner sign-in for generated sites. Accepts the username and password the
   builder issued for this site, exchanges them for an access token via the
   site-auth API, and keeps the token in this browser. */
(function () {
  var params = new URLSearchParams(location.search);
  var requestedNext = params.get("next") || "";
  var nextPage = (requestedNext === "admin" || requestedNext === "admin.html") ? "admin" : "";

  function setStatus(message, kind) {
    var el = document.getElementById("admin-login-status");
    if (!el) return;
    el.textContent = message || "";
    el.className = "form-note" + (kind ? " is-" + kind : "");
  }

  document.addEventListener("DOMContentLoaded", function () {
    var form = document.getElementById("admin-login-form");
    if (!form) return;

    var meta = document.querySelector('meta[name="dukan-site"]');
    var slug = meta ? meta.getAttribute("content") || "" : "";

    form.addEventListener("submit", function (event) {
      event.preventDefault();
      if (!form.reportValidity()) return;
      var button = form.querySelector('button[type="submit"]');
      if (button) button.disabled = true;
      setStatus("Checking credentials…");
      fetch("/_api/site-auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: slug,
          username: form.elements.username.value,
          password: form.elements.password.value
        })
      })
        .then(function (res) {
          return res.json().then(function (body) {
            if (!res.ok) throw new Error(body.error || "Sign-in failed.");
            return body;
          });
        })
        .then(function (body) {
          localStorage.setItem("dukan_admin_token", body.token);
          localStorage.setItem("dukan_admin_user", body.username || form.elements.username.value);
          location.replace(nextPage || "admin");
        })
        .catch(function (err) {
          if (button) button.disabled = false;
          setStatus(err.message, "error");
        });
    });
  });
})();
