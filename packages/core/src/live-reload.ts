export const LIVE_RELOAD_SCRIPT = `
(function () {
  var INITIAL_DELAY = 500;
  var MAX_DELAY = 5000;
  var es = null;
  var timer = null;
  var delay = INITIAL_DELAY;
  var hadError = false;

  function reload() {
    if (typeof window.__xSoftReload === "function") {
      window.__xSoftReload();
    } else {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      if (es) {
        es.close();
        es = null;
      }
      window.location.reload();
    }
  }

  function scheduleReconnect() {
    if (timer !== null) return;
    var wait = delay;
    delay = Math.min(delay * 2, MAX_DELAY);
    timer = setTimeout(function () {
      timer = null;
      connect();
    }, wait);
  }

  function connect() {
    if (es) {
      es.close();
      es = null;
    }
    var current = new EventSource("/__x/reload");
    es = current;
    current.onopen = function () {
      if (es !== current) return;
      delay = INITIAL_DELAY;
      if (hadError) {
        hadError = false;
        reload();
      }
    };
    current.addEventListener("reload", function () {
      if (es !== current) return;
      reload();
    });
    current.addEventListener("hb", function () {});
    current.onerror = function () {
      if (es !== current) return;
      es = null;
      current.close();
      hadError = true;
      scheduleReconnect();
    };
  }

  connect();
})();
`.trim();
