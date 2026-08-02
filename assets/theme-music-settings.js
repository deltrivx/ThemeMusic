// Theme Music Plugin — Settings Page UI
// Layout / wiring / IPC helpers. Pure DOM + fetch.
(function () {
  "use strict";

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  // ----------------------------------------------------------------
  // API helpers
  // ----------------------------------------------------------------
  function apiBase() {
    return "/plugins/theme.music";
  }

  function apiUrl(action, params) {
    var u = apiBase() + "/ucwc-music-api.php?action=" + encodeURIComponent(action);
    if (params && typeof params === "object") {
      Object.keys(params).forEach(function (k) {
        if (params[k] === undefined || params[k] === null) return;
        u += "&" + encodeURIComponent(k) + "=" + encodeURIComponent(String(params[k]));
      });
    }
    return u;
  }

  function apiGet(action, params) {
    return fetch(apiUrl(action, params), { credentials: "same-origin", cache: "no-store" })
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      });
  }

  function apiPost(action, body) {
    return fetch(apiUrl(action), {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "Content-Type": "application/x-www-form-urlencoded; charset=utf-8" },
      body: body || ""
    }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    });
  }

  function boot() {
    var tag = document.querySelector("script[src*='theme-music-settings.js']");
    if (!tag) return;
    var root = document.currentScript || tag;

    var form = $("#theme-music-form");
    if (!form) return;

    var msgEl = $(".tm-msg");
    var sourceSel = $("#tm-music-source");
    var sourceRows = $$("[data-tm-source]");

    // ----------------------------------------------------------------
    // Source-row visibility: only the row matching current MUSIC_SOURCE
    // is shown. Both the local and remote (Navidrome / FnOS) inputs use
    // data-tm-source="<source>" so we can toggle hidden without rewriting
    // the markup.
    // ----------------------------------------------------------------
    function hideRow(row) {
      if (!row) return;
      row.classList.add("tm-hidden");
      row.setAttribute("aria-hidden", "true");
    }

    function showRow(row) {
      if (!row) return;
      row.classList.remove("tm-hidden");
      row.setAttribute("aria-hidden", "false");
    }

    function syncSourceRows() {
      if (!sourceSel) return;
      var cur = (sourceSel.value || "local").toLowerCase();
      sourceRows.forEach(function (row) {
        var want = (row.getAttribute("data-tm-source") || "").toLowerCase();
        if (!want) return;
        if (want === cur) showRow(row); else hideRow(row);
      });
    }

    // ----------------------------------------------------------------
    // Mobile mode: when "same" is picked, hide other mobile controls
    // ----------------------------------------------------------------
    var mobileSel = $("#tm-run-mode-mobile");
    var mobileExtras = $$("#tm-vol-mobile-wrap, #tm-autoplay-mobile, #tm-shuffle-mobile, #tm-repeat-mobile");

    function syncMobileRows() {
      if (!mobileSel) return;
      var v = (mobileSel.value || "same").toLowerCase();
      var show = (v !== "same");
      mobileExtras.forEach(function (el) {
        if (show) showRow(el); else hideRow(el);
      });
    }

    if (sourceSel) {
      sourceSel.addEventListener("change", syncSourceRows);
      syncSourceRows();
    }
    if (mobileSel) {
      mobileSel.addEventListener("change", syncMobileRows);
      syncMobileRows();
    }

    // ----------------------------------------------------------------
    // Volume slider → numeric readout
    // ----------------------------------------------------------------
    function bindVolume(inputId, labelId) {
      var input = document.getElementById(inputId);
      var label = document.getElementById(labelId);
      if (!input || !label) return;
      function paint() { label.textContent = String(input.value); }
      input.addEventListener("input", paint);
      paint();
    }
    bindVolume("tm-music-volume", "tm-music-volume-val");
    bindVolume("tm-music-volume-mobile", "tm-music-volume-mobile-val");

    // ----------------------------------------------------------------
    // Service toggle: write SERVICE= enabled/disabled via API
    // ----------------------------------------------------------------
    var verBar = $("#tm-ver-bar");
    var svcToggle = $("#tm-service-toggle");
    var svcState = $("#tm-service-state");
    var svcLabel = $(".tm-service-switch-text");

    function paintSvc() {
      if (!svcToggle) return;
      var on = !!svcToggle.checked;
      if (svcState) svcState.textContent = on ? "开" : "关";
      if (svcLabel) svcLabel.classList.toggle("tm-on", on);
      if (verBar) verBar.setAttribute("data-tm-service", on ? "enabled" : "disabled");
      svcToggle.setAttribute("aria-checked", on ? "true" : "false");
    }

    if (svcToggle) {
      svcToggle.addEventListener("change", function () {
        var on = svcToggle.checked;
        var prevState = svcState ? svcState.textContent : "";
        if (svcState) svcState.textContent = "…";
        apiPost("set_service", "service=" + (on ? "enabled" : "disabled"))
          .then(function (j) {
            if (j && j.ok) {
              paintSvc();
            } else {
              svcToggle.checked = !on;
              if (svcState) svcState.textContent = prevState;
              alert("无法切换总开关：" + ((j && j.error) || "未知错误"));
            }
          })
          .catch(function (e) {
            svcToggle.checked = !on;
            if (svcState) svcState.textContent = prevState;
            alert("无法切换总开关：" + (e && e.message || "网络错误"));
          });
      });
      paintSvc();
      if (verBar) verBar.hidden = false;
    }

    // ----------------------------------------------------------------
    // Test connection buttons (Navidrome / FnOS)
    // ----------------------------------------------------------------
    function bindTest(btnId, statusId, source) {
      var btn = document.getElementById(btnId);
      var status = document.getElementById(statusId);
      if (!btn) return;
      btn.addEventListener("click", function () {
        if (status) { status.textContent = "测试中…"; status.classList.remove("green", "red"); }
        var fields;
        if (source === "navidrome") {
          fields = {
            url: ($("#tm-navidrome-url") || {}).value || "",
            user: ($("#tm-navidrome-user") || {}).value || "",
            password: ($("#tm-navidrome-password") || {}).value || ""
          };
        } else if (source === "fnos") {
          fields = {
            url: ($("#tm-fnos-url") || {}).value || "",
            user: ($("#tm-fnos-user") || {}).value || "",
            password: ($("#tm-fnos-password") || {}).value || ""
          };
        } else { return; }
        apiPost("test_" + source, "url=" + encodeURIComponent(fields.url) +
          "&user=" + encodeURIComponent(fields.user) +
          "&password=" + encodeURIComponent(fields.password))
          .then(function (j) {
            if (j && j.ok) {
              if (status) { status.textContent = "连接成功"; status.classList.add("green"); }
            } else {
              if (status) { status.textContent = "连接失败：" + ((j && j.error) || "未知错误"); status.classList.add("red"); }
            }
          })
          .catch(function (e) {
            if (status) { status.textContent = "网络错误：" + (e && e.message || ""); status.classList.add("red"); }
          });
      });
    }
    bindTest("tm-btn-test-navidrome", "tm-navidrome-status", "navidrome");
    bindTest("tm-btn-test-fnos", "tm-fnos-status", "fnos");

    // ----------------------------------------------------------------
    // Path browse: open WebGUI file tree, write back to input
    // ----------------------------------------------------------------
    function bindBrowse(browseSel, inputSel) {
      $$(browseSel).forEach(function (btn) {
        btn.addEventListener("click", function () {
          var input = $(inputSel);
          if (!input) return;
          var root = "/mnt/user";
          try {
            if (window.__TM_BOOT__ && window.__TM_BOOT__.pickroot) root = window.__TM_BOOT__.pickroot;
          } catch (e) {}
          if (typeof openFileBrowser === "function") {
            openFileBrowser(input, "default", root, "", "");
          } else if (typeof openPath === "function") {
            openPath(input);
          }
        });
      });
    }
    bindBrowse(".ucwc-path-browse", ".ucwc-local-path");

    // ----------------------------------------------------------------
    // Done button → return to previous page
    // ----------------------------------------------------------------
    var doneBtn = $("#tm-btn-done");
    if (doneBtn) {
      doneBtn.addEventListener("click", function () {
        if (typeof done === "function") { done(); return; }
        if (window.history && window.history.length > 1) window.history.back();
        else window.location.href = "/";
      });
    }

    // ----------------------------------------------------------------
    // Version bar: check / log / panel
    // ----------------------------------------------------------------
    var barCurrent = $("#tm-bar-current");
    var barLatest = $("#tm-bar-latest");
    var barExtra = $("#tm-bar-extra");
    var btnCheck = $("#tm-btn-check");
    var btnLog = $("#tm-btn-log");
    var panel = $("#tm-panel");
    var panelMask = $("#tm-panel-mask");
    var panelBody = $("#tm-panel-body");
    var panelActions = $("#tm-panel-actions");
    var panelTitle = $("#tm-panel-title");
    var panelClose = $("#tm-panel-close");

    function openPanel(title) {
      if (!panel) return;
      if (panelTitle) panelTitle.textContent = title || "版本管理";
      panel.classList.add("tm-open");
      if (panelMask) panelMask.classList.add("tm-open");
    }
    function closePanel() {
      if (!panel) return;
      panel.classList.remove("tm-open");
      if (panelMask) panelMask.classList.remove("tm-open");
    }
    if (panelClose) panelClose.addEventListener("click", closePanel);
    if (panelMask) panelMask.addEventListener("click", closePanel);

    function paintVersions(ver) {
      if (!ver) return;
      var current = ver.current || barCurrent.textContent || "—";
      var latest = ver.latest || "";
      if (barCurrent) barCurrent.textContent = current;
      if (barLatest) barLatest.textContent = latest && latest !== current ? ("最新: " + latest) : "";
      if (ver.note && barExtra) {
        barExtra.textContent = ver.note;
        barExtra.hidden = false;
      } else if (barExtra) {
        barExtra.hidden = true;
      }
    }

    if (btnCheck) {
      btnCheck.addEventListener("click", function () {
        btnCheck.disabled = true;
        if (barLatest) barLatest.textContent = "检查中…";
        apiGet("check_update")
          .then(function (j) { paintVersions(j); })
          .catch(function () { if (barLatest) barLatest.textContent = "检查失败"; })
          .then(function () { btnCheck.disabled = false; });
      });
    }
    if (btnLog) {
      btnLog.addEventListener("click", function () {
        openPanel("更新日志");
        if (panelBody) panelBody.textContent = "加载中…";
        apiGet("changelog")
          .then(function (j) {
            if (!panelBody) return;
            if (j && j.text) {
              panelBody.innerHTML = "";
              var pre = document.createElement("pre");
              pre.style.whiteSpace = "pre-wrap";
              pre.textContent = j.text;
              panelBody.appendChild(pre);
            } else {
              panelBody.textContent = "暂无日志";
            }
          })
          .catch(function () { if (panelBody) panelBody.textContent = "加载失败"; });
      });
    }

    // ----------------------------------------------------------------
    // Storage status: poll until player injects a state file
    // ----------------------------------------------------------------
    var storageDetected = $("#tm-storage-detected");
    var storageStatus = $("#tm-storage-status");
    function pollStorage() {
      apiGet("storage_status")
        .then(function (j) {
          if (!j) return;
          if (storageDetected) storageDetected.textContent = j.detected || "—";
          if (storageStatus) storageStatus.textContent = j.status || "等待播放";
        })
        .catch(function () {})
        .then(function () { setTimeout(pollStorage, 5000); });
    }
    pollStorage();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
