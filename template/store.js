/* Dukan Builder — store.js (locked)
   Browser-local demo store. Accounts, requests, subscribers and the session
   live in localStorage under this site's slug. This is an intentionally
   self-contained demo backend: data does not leave the visitor's browser
   and is not shared between devices. */
(function () {
  var meta = document.querySelector('meta[name="dukan-site"]');
  var SLUG = (meta && meta.content) || "preview";
  var DATA_KEY = "dukan_demo_" + SLUG + "_v1";
  var SESSION_KEY = "dukan_session_" + SLUG + "_v1";
  var OWNER_EMAIL = "owner@site.local";
  var CUSTOMER_EMAIL = "customer@site.local";

  function hash(value) {
    var h = 2166136261;
    var str = String(value);
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(36);
  }

  function secret(email, password) {
    return hash(String(email).toLowerCase() + "::" + password);
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function makeRef(type) {
    var prefix = { booking: "BK", inquiry: "IN", newsletter: "NL" }[type] || "RQ";
    var suffix = Math.random().toString(36).slice(2, 8).toUpperCase();
    return prefix + "-" + suffix;
  }

  var API_BASE = "/_api";

  function postJson(path, body) {
    return fetch(API_BASE + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {})
    })
      .then(function (res) {
        return res
          .json()
          .catch(function () { return {}; })
          .then(function (json) { return { status: res.status, body: json }; });
      })
      .catch(function () {
        return { status: 0, body: { error: "network" } };
      });
  }

  function makeUser(name, email, password, role) {
    return {
      id: uid(),
      name: name,
      email: email,
      phone: "",
      role: role,
      pass: secret(email, password),
      createdAt: new Date().toISOString()
    };
  }

  function baseData() {
    return {
      version: 1,
      seeded: false,
      users: [
        makeUser("Site Owner", OWNER_EMAIL, "owner123", "owner"),
        makeUser("Demo Customer", CUSTOMER_EMAIL, "customer123", "customer")
      ],
      requests: []
    };
  }

  function load() {
    try {
      var raw = localStorage.getItem(DATA_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.users) && Array.isArray(parsed.requests)) return parsed;
      }
    } catch (e) {}
    return baseData();
  }

  var data = load();

  function save() {
    try {
      localStorage.setItem(DATA_KEY, JSON.stringify(data));
    } catch (e) {}
    window.dispatchEvent(new CustomEvent("dukan:store"));
  }

  function categoryName() {
    return (window.DukanSite && window.DukanSite.data && window.DukanSite.data.category) || "other";
  }

  function sampleFields(category) {
    var fields = window.DukanCategory ? window.DukanCategory.sampleFields(category) : {};
    var site = window.DukanSite && window.DukanSite.data;
    var cat = window.DukanCategory ? window.DukanCategory.get(category) : { fields: [] };
    cat.fields.forEach(function (f) {
      if (f.source === "services" && !fields[f.name] && site && site.services && site.services.length) {
        fields[f.name] = site.services[0].name;
      }
    });
    return fields;
  }

  function addSamples() {
    if (data.seeded) return;
    data.seeded = true;
    if (data.requests.length === 0) {
      var category = categoryName();
      var bookingName = category === "real-estate" ? "Hina Qureshi" : "Sana Malik";
      data.requests.push({
        id: uid(),
        ref: "BK-SAMPLE",
        type: "booking",
        name: bookingName,
        email: "sana.sample@example.com",
        phone: "0300 1234567",
        message: "Please confirm the time and let me know if you need anything else from me.",
        fields: sampleFields(category),
        status: "new",
        createdAt: new Date(Date.now() - 2 * 864e5).toISOString(),
        sample: true
      });
      data.requests.push({
        id: uid(),
        ref: "IN-SAMPLE",
        type: "inquiry",
        name: "Usman Raza",
        email: "usman.sample@example.com",
        phone: "0321 7654321",
        message: "I would like to know more about your services and availability this week.",
        fields: {},
        status: "new",
        createdAt: new Date(Date.now() - 864e5).toISOString(),
        sample: true
      });
      data.requests.push({
        id: uid(),
        ref: "NL-SAMPLE",
        type: "newsletter",
        name: "Hira Shah",
        email: "hira.sample@example.com",
        phone: "",
        message: "",
        fields: {},
        status: "new",
        createdAt: new Date(Date.now() - 3 * 864e5).toISOString(),
        sample: true
      });
    }
    save();
  }

  var readyResolve;
  var ready = new Promise(function (resolve) { readyResolve = resolve; });

  if (window.DukanSite && window.DukanSite.ready) {
    window.DukanSite.ready.then(function () {
      addSamples();
      readyResolve();
    });
  } else {
    addSamples();
    readyResolve();
  }

  function emit() {
    save();
  }

  function currentUser() {
    try {
      var raw = localStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      var session = JSON.parse(raw);
      if (!session || !session.userId) return null;
      return data.users.find(function (u) { return u.id === session.userId; }) || null;
    } catch (e) {
      return null;
    }
  }

  function login(email, password) {
    var emailKey = String(email || "").trim().toLowerCase();
    var user = data.users.find(function (u) { return u.email.toLowerCase() === emailKey; });
    if (!user) return { ok: false, error: "No account found for that email." };
    if (user.pass !== secret(emailKey, String(password || ""))) {
      return { ok: false, error: "That password does not match." };
    }
    localStorage.setItem(SESSION_KEY, JSON.stringify({ userId: user.id, at: new Date().toISOString() }));
    return { ok: true, user: user };
  }

  function register(input) {
    var name = String(input.name || "").trim();
    var email = String(input.email || "").trim().toLowerCase();
    var password = String(input.password || "");
    var phone = String(input.phone || "").trim();
    if (name.length < 2) return { ok: false, error: "Please enter your name." };
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: "Please enter a valid email address." };
    if (password.length < 6) return { ok: false, error: "Password must be at least 6 characters." };
    if (data.users.some(function (u) { return u.email.toLowerCase() === email; })) {
      return { ok: false, error: "An account with that email already exists." };
    }
    var user = makeUser(name, email, password, "customer");
    user.phone = phone;
    data.users.push(user);
    emit();
    localStorage.setItem(SESSION_KEY, JSON.stringify({ userId: user.id, at: new Date().toISOString() }));
    return { ok: true, user: user };
  }

  function logout() {
    localStorage.removeItem(SESSION_KEY);
  }

  function updateProfile(patch) {
    var user = currentUser();
    if (!user) return { ok: false, error: "Please sign in first." };
    var name = String(patch.name || "").trim();
    if (name.length < 2) return { ok: false, error: "Please enter your name." };
    user.name = name;
    user.phone = String(patch.phone || "").trim();
    emit();
    return { ok: true, user: user };
  }

  function createRequest(input) {
    var type = input.type;
    if (["booking", "inquiry", "newsletter"].indexOf(type) === -1) {
      return { ok: false, error: "Unknown request type." };
    }
    var email = String(input.email || "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return { ok: false, error: "Please enter a valid email address." };
    }
    if (type === "newsletter" && data.requests.some(function (r) {
      return r.type === "newsletter" && r.email && r.email.toLowerCase() === email;
    })) {
      return { ok: false, error: "That email is already subscribed." };
    }
    var user = currentUser();
    if (type === "booking" && !user) {
      return { ok: false, error: "Please sign in to make a booking." };
    }
    var fields = {};
    var rawFields = input.fields || {};
    Object.keys(rawFields).forEach(function (key) {
      var value = rawFields[key];
      if (value == null) return;
      fields[key] = String(value).slice(0, 500);
    });
    var request = {
      id: uid(),
      ref: makeRef(type),
      type: type,
      name: String(input.name || "").trim().slice(0, 120),
      email: email,
      phone: String(input.phone || "").trim().slice(0, 40),
      message: String(input.message || "").trim().slice(0, 1200),
      fields: fields,
      status: "new",
      createdAt: new Date().toISOString(),
      sample: false,
      userId: user ? user.id : null
    };
    data.requests.unshift(request);
    emit();

    var remote;
    if (type === "newsletter") {
      remote = postJson("/site-data/subscriber", { slug: SLUG, email: email, name: request.name });
    } else {
      remote = postJson("/site-data/request", {
        slug: SLUG,
        type: type,
        ref: request.ref,
        name: request.name,
        email: email,
        phone: request.phone,
        message: request.message,
        fields: fields
      });
    }
    remote = remote.then(function (out) {
      if (out.status >= 200 && out.status < 300 && out.body && out.body.ok === true) {
        return { ok: true, request: out.body.request, subscriber: out.body.subscriber };
      }
      return { ok: false, error: (out.body && out.body.error) || "It could not be saved with the business." };
    });

    return { ok: true, request: request, remote: remote };
  }

  function requests() {
    return data.requests.slice().sort(function (a, b) {
      return new Date(b.createdAt) - new Date(a.createdAt);
    });
  }

  function myRequests() {
    var user = currentUser();
    if (!user) return [];
    return requests().filter(function (r) {
      return r.userId === user.id || (r.email && r.email.toLowerCase() === user.email.toLowerCase());
    });
  }

  function guestRequests() {
    return requests().filter(function (r) {
      return !r.userId && !r.sample && r.type !== "newsletter";
    });
  }

  function syncRequests(email, refs) {
    var cleanEmail = String(email || "").trim().toLowerCase();
    var list = Array.isArray(refs) ? refs.filter(Boolean) : [];
    if (!cleanEmail || list.length === 0) return Promise.resolve([]);
    return postJson("/site-data/lookup", { slug: SLUG, email: cleanEmail, refs: list })
      .then(function (out) {
        if (out.status === 200 && out.body && Array.isArray(out.body.requests)) {
          var updated = false;
          out.body.requests.forEach(function (sr) {
            if (sr.sample || sr.type === "newsletter") return;
            var existing = data.requests.find(function (r) { return r.ref === sr.ref; });
            if (existing) {
              if (existing.status === "cancelled" && sr.status !== "cancelled") {
                return;
              }
              if (existing.status !== sr.status) {
                existing.status = sr.status;
                updated = true;
              }
            } else {
              data.requests.push({
                id: sr.id || uid(),
                ref: sr.ref,
                type: sr.type,
                name: "",
                email: cleanEmail,
                phone: "",
                message: "",
                fields: sr.fields || {},
                status: sr.status,
                createdAt: sr.createdAt,
                sample: false,
                userId: null
              });
              updated = true;
            }
          });
          if (updated) emit();
          return out.body.requests;
        }
        return [];
      });
  }

  function updateRequestStatus(id, status) {
    var request = data.requests.find(function (r) { return r.id === id; });
    if (!request) return { ok: false, error: "Request not found." };
    var allowed = window.DukanCategory ? window.DukanCategory.statusOptions(request.type) : [status];
    if (allowed.indexOf(status) === -1) return { ok: false, error: "That status is not allowed." };
    request.status = status;
    emit();
    return { ok: true };
  }

  function cancelRequest(id) {
    var request = data.requests.find(function (r) { return r.id === id; });
    if (!request) return { ok: false, error: "Request not found." };
    var user = currentUser();
    var isOwner = user
      ? (request.userId === user.id || (request.email && request.email.toLowerCase() === user.email.toLowerCase()))
      : !request.userId;
    if (!isOwner) {
      return { ok: false, error: "You can only cancel your own request." };
    }
    if (request.type !== "booking" && request.type !== "inquiry") {
      return { ok: false, error: "This request cannot be cancelled." };
    }
    request.status = "cancelled";
    emit();
    postJson("/site-data/cancel", { slug: SLUG, ref: request.ref, email: request.email });
    return { ok: true };
  }

  function deleteRequest(id) {
    data.requests = data.requests.filter(function (r) { return r.id !== id; });
    emit();
  }

  function clearSamples() {
    data.requests = data.requests.filter(function (r) { return !r.sample; });
    emit();
  }

  function subscribers() {
    return requests().filter(function (r) { return r.type === "newsletter"; });
  }

  window.addEventListener("storage", function (e) {
    if (e.key === DATA_KEY) {
      data = load();
      window.dispatchEvent(new CustomEvent("dukan:store"));
    }
  });

  window.DukanStore = {
    slug: SLUG,
    ownerEmail: OWNER_EMAIL,
    customerEmail: CUSTOMER_EMAIL,
    ready: ready,
    currentUser: currentUser,
    login: login,
    register: register,
    logout: logout,
    updateProfile: updateProfile,
    createRequest: createRequest,
    requests: requests,
    myRequests: myRequests,
    guestRequests: guestRequests,
    syncRequests: syncRequests,
    updateRequestStatus: updateRequestStatus,
    cancelRequest: cancelRequest,
    deleteRequest: deleteRequest,
    clearSamples: clearSamples,
    subscribers: subscribers
  };
})();
