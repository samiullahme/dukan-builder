/* Dukan Builder — auth.js (locked)
   Demo sign-in and registration for login.html. Accounts live in the
   browser-local store. */
(function () {
  var params = new URLSearchParams(location.search);
  var requestedNext = params.get("next") || "";
  var nextPage = requestedNext === "dashboard.html" ? requestedNext : "";

  function setStatus(message, kind, id) {
    var el = document.getElementById(id || "auth-status");
    if (!el) return;
    el.textContent = message || "";
    el.className = "form-note" + (kind ? " is-" + kind : "");
  }

  function go(user) {
    location.replace(nextPage || "dashboard.html");
  }

  function setMode(mode) {
    document.querySelectorAll(".auth-tab").forEach(function (tab) {
      var active = tab.getAttribute("data-mode") === mode;
      tab.classList.toggle("is-active", active);
      tab.setAttribute("aria-selected", active ? "true" : "false");
    });
    var loginForm = document.getElementById("login-form");
    var registerForm = document.getElementById("register-form");
    if (loginForm) loginForm.hidden = mode !== "login";
    if (registerForm) registerForm.hidden = mode !== "register";
    setStatus("", "");
    setStatus("", "", "auth-status-register");
  }

  document.addEventListener("DOMContentLoaded", function () {
    if (!window.DukanStore) return;
    var user = window.DukanStore.currentUser();
    if (user) {
      go(user);
      return;
    }

    document.querySelectorAll(".auth-tab").forEach(function (tab) {
      tab.addEventListener("click", function () {
        setMode(tab.getAttribute("data-mode"));
      });
    });

    var loginForm = document.getElementById("login-form");
    if (loginForm) {
      loginForm.addEventListener("submit", function (event) {
        event.preventDefault();
        if (!loginForm.reportValidity()) return;
        var result = window.DukanStore.login(
          loginForm.elements.email.value,
          loginForm.elements.password.value
        );
        if (!result.ok) {
          setStatus(result.error, "error");
          return;
        }
        go(result.user);
      });
    }

    var registerForm = document.getElementById("register-form");
    if (registerForm) {
      registerForm.addEventListener("submit", function (event) {
        event.preventDefault();
        if (!registerForm.reportValidity()) return;
        if (registerForm.elements.password.value !== registerForm.elements.confirm.value) {
          setStatus("The two passwords do not match.", "error", "auth-status-register");
          return;
        }
        var result = window.DukanStore.register({
          name: registerForm.elements.name.value,
          email: registerForm.elements.email.value,
          phone: registerForm.elements.phone.value,
          password: registerForm.elements.password.value
        });
        if (!result.ok) {
          setStatus(result.error, "error", "auth-status-register");
          return;
        }
        go(result.user);
      });
    }
  });
})();
