// Client for the Apps Script Web App backend. Every call is a POST with a
// JSON body {action, token, ...params}; the Apps Script always responds
// {ok: true, result} or {ok: false, error}.
window.RT = window.RT || {};

(function () {
  "use strict";

  function getConfig() {
    return window.RT.config; // {url, token} — set by app.js after loading settings
  }

  async function call(action, params) {
    const cfg = getConfig();
    if (!cfg || !cfg.url) {
      const err = new Error("not_configured");
      err.code = "not_configured";
      throw err;
    }
    const body = Object.assign({ action: action, token: cfg.token || "" }, params || {});

    let res;
    try {
      res = await fetch(cfg.url, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" }, // avoids a CORS preflight on Apps Script
        body: JSON.stringify(body),
        redirect: "follow"
      });
    } catch (e) {
      const err = new Error("network_error");
      err.code = "network_error";
      err.cause = e;
      throw err;
    }

    if (!res.ok) {
      const err = new Error("http_" + res.status);
      err.code = "http_error";
      err.status = res.status;
      throw err;
    }

    let json;
    try { json = await res.json(); } catch (e) {
      const err = new Error("bad_response");
      err.code = "bad_response";
      throw err;
    }

    if (!json.ok) {
      const err = new Error(json.error || "unknown_error");
      err.code = json.error === "unauthorized" ? "unauthorized" : "server_error";
      throw err;
    }
    return json.result;
  }

  window.RT.api = {
    ping: () => call("ping", {}),
    getStructure: () => call("getStructure", {}),
    logSet: (params) => call("logSet", params),
    addExercise: (params) => call("addExercise", params),
    updateExerciseImage: (params) => call("updateExerciseImage", params)
  };
})();
