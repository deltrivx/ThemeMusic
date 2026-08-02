/**
 * Theme Music settings UI — Apply unlock, path/fileTree align, independent version management.
 * Update API: /plugins/theme.music/theme-music-update.php (NOT ThemeEffects).
 */
(function () {
  "use strict";

  var form = document.getElementById("theme-music-form");
  var API = "/plugins/theme.music/theme-music-update.php";
  var boot = window.__TM_BOOT__ || {};
  var LOCAL_VERSION = boot.version || "";
  var panel, mask, body, actions, title;
  var busy = false;
  var cache = { versions: null, latest: "", selected: "" };
  var READ_ACTIONS = {
    status: 1,
    check_update: 1,
    changelog: 1,
    list_versions: 1,
    job_status: 1,
  };

  function applyButtons() {
    if (!form) return [];
    var list = [];
    var all = form.querySelectorAll(
      'input[type="submit"], button[type="submit"], #tm-btn-save, input[name="SAVE_THEME_MUSIC"]'
    );
    for (var i = 0; i < all.length; i++) {
      var v = (all[i].value || all[i].textContent || "").trim();
      if (
        v === "应用" ||
        v === "Apply" ||
        all[i].id === "tm-btn-save" ||
        all[i].name === "SAVE_THEME_MUSIC"
      ) {
        if (list.indexOf(all[i]) < 0) list.push(all[i]);
      }
    }
    return list;
  }

  function enableApply(switchDone) {
    if (!form) return;
    var btns = applyButtons();
    for (var i = 0; i < btns.length; i++) {
      btns[i].disabled = false;
      btns[i].removeAttribute("disabled");
      btns[i].classList.add("lock");
    }
    if (switchDone) {
      var done = form.querySelectorAll(
        '#tm-btn-done, input[type="button"][value="完成"], input[type="button"][value="Done"]'
      );
      for (var j = 0; j < done.length; j++) {
        var dv = (done[j].value || "").trim();
        if (dv === "完成" || dv === "Done") {
          done[j].value = dv === "Done" ? "Reset" : "重置";
          done[j].onclick = null;
          done[j].removeAttribute("onclick");
          (function (btn) {
            btn.addEventListener(
              "click",
              function (e) {
                e.preventDefault();
                try {
                  if (typeof refresh === "function") refresh(0);
                  else window.location.reload();
                } catch (err) {
                  window.location.reload();
                }
              },
              false
            );
          })(done[j]);
        }
      }
    }
  }

  function onDirty() {
    enableApply(true);
  }

  /**
   * Uniform control column (user: 长短不一):
   * 1) temporarily content-size all selects and measure max natural width
   * 2) pin every select + path field to that same pixel width
   * 3) browse stays absolutely inside the path field (ThemeEffects inset pattern)
   */
  function alignCtrlWidth() {
    if (!form) return;
    var names = [
      "MUSIC_RUN_MODE",
      "MUSIC_RUN_MODE_MOBILE",
      "MUSIC_AUTOPLAY",
      "MUSIC_AUTOPLAY_MOBILE",
      "MUSIC_SOURCE",
      "MUSIC_REPEAT",
      "MUSIC_REPEAT_MOBILE",
      "MUSIC_SHUFFLE",
      "MUSIC_SHUFFLE_MOBILE",
    ];
    var probes = [];
    var i, el, n, w;
    for (i = 0; i < names.length; i++) {
      el = form.querySelector('select[name="' + names[i] + '"]');
      if (el) probes.push(el);
    }
    if (!probes.length) {
      var all = form.querySelectorAll("dd > select, select");
      for (i = 0; i < all.length && probes.length < 8; i++) probes.push(all[i]);
    }
    if (!probes.length) return;

    // Measure at natural content size first.
    for (i = 0; i < probes.length; i++) {
      try {
        if (probes[i].style) {
          probes[i].style.setProperty("width", "max-content", "important");
          probes[i].style.setProperty("min-width", "max-content", "important");
          probes[i].style.removeProperty("max-width");
        }
      } catch (ePrep) {}
    }
    try {
      void form.offsetWidth;
    } catch (eReflow) {}

    w = 0;
    for (i = 0; i < probes.length; i++) {
      try {
        var r = probes[i].getBoundingClientRect();
        n = r && r.width ? r.width : probes[i].offsetWidth || 0;
        if (n > w) w = n;
      } catch (e0) {}
    }
    if (!(w > 40)) return;
    w = Math.round(w);
    /* Longest option text (e.g. 仅仪表盘 / 开启拦截) needs room; keep a sensible floor. */
    if (w < 220) w = 220;
    if (w > 420) w = 420;
    var px = w + "px";
    form.style.setProperty("--tm-ctrl-w", px);
    try {
      document.documentElement.style.setProperty("--tm-ctrl-w", px);
    } catch (e2) {}

    // Pin ALL form selects to the same column width (no more 长短不一).
    try {
      var allSel = form.querySelectorAll("dd > select, select");
      for (i = 0; i < allSel.length; i++) {
        if (!allSel[i].style) continue;
        allSel[i].style.setProperty("width", px, "important");
        allSel[i].style.setProperty("min-width", px, "important");
        allSel[i].style.setProperty("max-width", "100%", "important");
        allSel[i].style.setProperty("box-sizing", "border-box", "important");
      }
    } catch (ePin) {}

    var fields = form.querySelectorAll(".tm-path-field, .ucwc-path-field");
    for (i = 0; i < fields.length; i++) {
      fields[i].style.setProperty("position", "relative", "important");
      fields[i].style.setProperty("display", "inline-flex", "important");
      fields[i].style.setProperty("align-items", "center", "important");
      fields[i].style.setProperty("width", px, "important");
      fields[i].style.setProperty("max-width", "100%", "important");
      fields[i].style.setProperty("box-sizing", "border-box", "important");
      fields[i].style.setProperty("min-width", "0", "important");
      var inp = fields[i].querySelector(".tm-local-path, .ucwc-local-path");
      if (inp) {
        inp.style.setProperty("flex", "1 1 auto", "important");
        inp.style.setProperty("width", "100%", "important");
        inp.style.setProperty("max-width", "none", "important");
        inp.style.setProperty("min-width", "0", "important");
        inp.style.setProperty("padding-right", "36px", "important");
        inp.style.setProperty("box-sizing", "border-box", "important");
      }
      // Pin browse icon inside the field (Unraid button CSS can knock it into flow).
      var btn = fields[i].querySelector(".tm-path-browse, .ucwc-path-browse");
      if (btn) {
        btn.style.setProperty("position", "absolute", "important");
        btn.style.setProperty("right", "2px", "important");
        btn.style.setProperty("top", "50%", "important");
        btn.style.setProperty("transform", "translateY(-50%)", "important");
        btn.style.setProperty("left", "auto", "important");
        btn.style.setProperty("bottom", "auto", "important");
        btn.style.setProperty("z-index", "3", "important");
        btn.style.setProperty("display", "inline-flex", "important");
        btn.style.setProperty("align-items", "center", "important");
        btn.style.setProperty("justify-content", "center", "important");
        btn.style.setProperty("width", "30px", "important");
        btn.style.setProperty("height", "28px", "important");
        btn.style.setProperty("margin", "0", "important");
        btn.style.setProperty("padding", "0", "important");
        btn.style.setProperty("border", "none", "important");
        btn.style.setProperty("background", "transparent", "important");
        btn.style.setProperty("box-shadow", "none", "important");
        btn.style.setProperty("flex", "0 0 auto", "important");
        btn.style.setProperty("float", "none", "important");
      }
    }
    // Volume: ThemeEffects uses width:100% of a flexible row — keep readable bar, not forced to select px.
    var vol = form.querySelector(".tm-vol");
    if (vol) {
      vol.style.setProperty("max-width", "420px", "important");
      vol.style.setProperty("width", "100%", "important");
      vol.style.removeProperty("min-width");
    }
  }

  function wireFileTreePickers() {
    try {
      if (typeof window.jQuery === "undefined" || !jQuery.fn || !jQuery.fn.fileTreeAttach) {
        return false;
      }
      var $ = jQuery;
      var $els = $(".tm-local-path, .ucwc-local-path, #tm-music-local-dir");
      $els.each(function () {
        var $el = $(this);
        if (!$el.length || $el.data("tmFileTree")) return;
        $el.attr("autocomplete", "off");
        $el.attr("spellcheck", "false");
        if (!$el.attr("data-pickroot")) {
          var pr = (boot && boot.pickroot) || "/mnt/user";
          $el.attr("data-pickroot", pr);
          $el.attr("data-picktop", pr);
        }
        $el.attr("data-pickfolders", "true");
        if (!$el.attr("data-pickcloseonfile")) $el.attr("data-pickcloseonfile", "false");
        $el.fileTreeAttach();
        $el.data("tmFileTree", 1);
        $el.on("change.tm input.tm", function () {
          onDirty();
          setTimeout(alignCtrlWidth, 0);
        });
      });
      $(document)
        .off("click.tmPathBrowse", ".tm-path-browse, .ucwc-path-browse")
        .on("click.tmPathBrowse", ".tm-path-browse, .ucwc-path-browse", function (ev) {
          ev.preventDefault();
          ev.stopPropagation();
          var $btn = $(this);
          var $wrap = $btn.closest(".tm-path-field, .ucwc-path-field");
          var $inp = $wrap.find(".tm-local-path, .ucwc-local-path").first();
          if (!$inp.length) $inp = $btn.siblings(".tm-local-path, .ucwc-local-path").first();
          if (!$inp.length) return;
          try {
            $inp.trigger("click");
            $inp.trigger("focus");
          } catch (e1) {}
        });
      return true;
    } catch (e) {
      return false;
    }
  }

  function csrfToken() {
    var nodes = document.querySelectorAll('input[name="csrf_token"]');
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].value) return nodes[i].value;
    }
    if (typeof csrf_token === "string" && csrf_token) return csrf_token;
    if (typeof window.csrf_token === "string" && window.csrf_token) return window.csrf_token;
    try {
      if (window.top && typeof window.top.csrf_token === "string" && window.top.csrf_token) {
        return window.top.csrf_token;
      }
    } catch (e0) {}
    try {
      var m = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/);
      if (m) return decodeURIComponent(m[1]);
    } catch (e) {}
    return "";
  }

  function setBusy(on, text) {
    busy = !!on;
    if (panel) panel.classList.toggle("busy", busy);
    if (on && text) {
      var p = document.getElementById("tm-busy-msg");
      if (p) p.textContent = text;
    }
  }

  function openPanel(t) {
    if (!panel || !mask) return;
    title.textContent = t || "版本管理";
    panel.style.display = "block";
    mask.style.display = "block";
  }
  function closePanel() {
    if (busy) return;
    if (panel) panel.style.display = "none";
    if (mask) mask.style.display = "none";
  }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function chips(v) {
    if (!v) return "";
    var c = [];
    if (v.channel === "latest") c.push("最新");
    if (v.channel === "beta" || (v.id && /beta/i.test(String(v.id)))) c.push("Beta");
    if (v.id && v.id === LOCAL_VERSION) c.push("当前");
    if (v.music) c.push("音乐");
    return c
      .map(function (x) {
        return '<span class="tm-chip">' + esc(x) + "</span>";
      })
      .join("");
  }

  function isBetaVersionId(id) {
    return !!(id && /beta/i.test(String(id)));
  }

  function parseVersionParts(id) {
    var s = String(id || "").trim().replace(/^v/i, "");
    if (!s) return null;
    var m = s.match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:[-_.]?(beta|alpha|rc|b)(\d*))?/i);
    if (!m) return null;
    var preKind = (m[4] || "").toLowerCase();
    var preNum = m[5] ? parseInt(m[5], 10) || 0 : preKind ? 0 : -1;
    var preRank = -1;
    if (preKind === "rc") preRank = 3;
    else if (preKind === "beta" || preKind === "b") preRank = 2;
    else if (preKind === "alpha") preRank = 1;
    else if (preKind) preRank = 0;
    return {
      major: parseInt(m[1], 10) || 0,
      minor: parseInt(m[2], 10) || 0,
      patch: parseInt(m[3], 10) || 0,
      preRank: preRank,
      preNum: preRank < 0 ? 0 : preNum,
      raw: s,
    };
  }

  function compareVersions(a, b) {
    var pa = parseVersionParts(a);
    var pb = parseVersionParts(b);
    if (!pa && !pb) return 0;
    if (!pa) return -1;
    if (!pb) return 1;
    if (pa.major !== pb.major) return pa.major - pb.major;
    if (pa.minor !== pb.minor) return pa.minor - pb.minor;
    if (pa.patch !== pb.patch) return pa.patch - pb.patch;
    var ra = pa.preRank < 0 ? 100 : pa.preRank;
    var rb = pb.preRank < 0 ? 100 : pb.preRank;
    if (ra !== rb) return ra - rb;
    if (pa.preRank < 0 && pb.preRank < 0) return 0;
    return pa.preNum - pb.preNum;
  }

  function isVersionNewer(a, b) {
    return compareVersions(a, b) > 0;
  }

  function sameVersionId(a, b) {
    if (!a || !b) return false;
    if (String(a) === String(b)) return true;
    return compareVersions(a, b) === 0;
  }

  function pickStableLatest(data) {
    var versions = (data && data.versions) || [];
    var i, v;
    for (i = 0; i < versions.length; i++) {
      v = versions[i];
      if (v && v.channel === "latest" && !isBetaVersionId(v.id)) return v;
    }
    for (i = 0; i < versions.length; i++) {
      v = versions[i];
      if (v && v.channel !== "beta" && !isBetaVersionId(v.id)) return v;
    }
    if (data && data.latest && !isBetaVersionId(data.latest.id || data.latest_version)) {
      return data.latest;
    }
    return data && data.latest ? data.latest : null;
  }

  function pickBestBeta(data) {
    var versions = (data && data.versions) || [];
    var best = null;
    var i, v;
    for (i = 0; i < versions.length; i++) {
      v = versions[i];
      if (!v || !v.id) continue;
      if (!(v.channel === "beta" || isBetaVersionId(v.id))) continue;
      if (!best || isVersionNewer(v.id, best.id)) best = v;
    }
    return best;
  }

  function pickBetaLatest(data, opts) {
    opts = opts || {};
    var versions = (data && data.versions) || [];
    var stable = pickStableLatest(data);
    var stableId = (stable && stable.id) || data.latest_version || "";
    var localId = opts.localVersion || "";
    var floorId = stableId;
    if (localId && !isBetaVersionId(localId) && isVersionNewer(localId, floorId || "0")) {
      floorId = localId;
    }
    var best = null;
    var i, v;
    for (i = 0; i < versions.length; i++) {
      v = versions[i];
      if (!v || !v.id) continue;
      if (!(v.channel === "beta" || isBetaVersionId(v.id))) continue;
      if (floorId && !isVersionNewer(v.id, floorId)) continue;
      if (!best || isVersionNewer(v.id, best.id)) best = v;
    }
    return best;
  }

  function parseJsonResponse(t) {
    var j = null;
    try {
      j = JSON.parse(t);
    } catch (e) {}
    if (!j) {
      var i = t.indexOf("{");
      var k = t.lastIndexOf("}");
      if (i >= 0 && k > i) {
        try {
          j = JSON.parse(t.slice(i, k + 1));
        } catch (e2) {}
      }
    }
    return j;
  }

  function api(action, extra, timeoutMs, forceGet) {
    var isRead = !!READ_ACTIONS[action];
    var useGet = isRead || !!forceGet;
    var opts = {
      credentials: "same-origin",
      headers: { "X-Requested-With": "XMLHttpRequest", Accept: "application/json" },
      cache: "no-store",
    };
    var url = API + "?UCWC_ACTION=" + encodeURIComponent(action) + "&_ts=" + Date.now();
    var ctrl = null;
    var timer = 0;
    var ms = timeoutMs != null ? timeoutMs : isRead ? 20000 : 12000;
    if (typeof AbortController !== "undefined" && ms > 0) {
      ctrl = new AbortController();
      opts.signal = ctrl.signal;
      timer = setTimeout(function () {
        try {
          ctrl.abort();
        } catch (e0) {}
      }, ms);
    }

    var token = csrfToken();
    if (useGet) {
      if (extra) {
        Object.keys(extra).forEach(function (k) {
          if (extra[k] != null) url += "&" + encodeURIComponent(k) + "=" + encodeURIComponent(extra[k]);
        });
      }
      if (!isRead && token) {
        url += "&csrf_token=" + encodeURIComponent(token);
      }
      opts.method = "GET";
    } else {
      var params = new URLSearchParams();
      params.set("UCWC_ACTION", action);
      if (token) {
        params.set("csrf_token", token);
        opts.headers["X-CSRF-TOKEN"] = token;
      }
      if (extra) {
        Object.keys(extra).forEach(function (k) {
          if (extra[k] != null) params.set(k, String(extra[k]));
        });
      }
      opts.method = "POST";
      opts.headers["Content-Type"] = "application/x-www-form-urlencoded; charset=UTF-8";
      opts.body = params.toString();
      url = API + "?UCWC_ACTION=" + encodeURIComponent(action) + "&_ts=" + Date.now();
    }

    return fetch(url, opts)
      .then(function (r) {
        return r.text().then(function (t) {
          if (r.status === 302 || (/<html/i.test(t) && /login/i.test(t))) {
            throw new Error("未登录或会话已过期，请重新登录 Unraid。");
          }
          if (!t || !String(t).trim()) {
            throw new Error(
              useGet
                ? "接口空响应（可能被重定向或 PHP 错误）。"
                : "接口空响应：写操作需要有效 CSRF。请刷新页面后重试。"
            );
          }
          var j = parseJsonResponse(t);
          if (!j) throw new Error("接口返回非 JSON：" + String(t).slice(0, 120));
          if (!r.ok && !j.ok) throw new Error(j.error || j.message || "HTTP " + r.status);
          return j;
        });
      })
      .catch(function (e) {
        if (e && (e.name === "AbortError" || /aborted/i.test(String(e.message || e)))) {
          throw new Error(
            "请求超时（>" +
              Math.round(ms / 1000) +
              "s）。若卡在启动，请刷新后重试；安装已改为后台任务，通常应在数秒内返回 job_id。"
          );
        }
        throw e;
      })
      .finally(function () {
        if (timer) clearTimeout(timer);
      });
  }

  function updateBar(data) {
    var cur = document.getElementById("tm-bar-current");
    var latest = document.getElementById("tm-bar-latest");
    var extra = document.getElementById("tm-bar-extra");
    if (!data) return;
    if (data.local) {
      LOCAL_VERSION = data.local.version || LOCAL_VERSION;
      if (cur) {
        cur.textContent = data.local.installed
          ? data.local.version || "已安装（版本未知）"
          : "未安装";
      }
      if (extra) {
        extra.textContent = "";
        extra.hidden = true;
      }
    }
    if (latest && data.latest_version) {
      var tip = "";
      if (data.update_available) tip = "有更新";
      else if (data.local && data.local.installed && data.local.version === data.latest_version)
        tip = "";
      latest.textContent = tip ? " · " + tip : "";
      latest.hidden = !tip;
    }
  }

  /** Title master switch: enable/disable whole Theme Music runtime (SERVICE). */
  function wireServiceToggle() {
    var tog = document.getElementById("tm-service-toggle");
    if (!tog || tog.getAttribute("data-tm-wired") === "1") return;
    tog.setAttribute("data-tm-wired", "1");
    var stateEl = document.getElementById("tm-service-state");
    var label = tog.closest(".tm-service-switch");

    function setUi(on, busyState) {
      tog.checked = !!on;
      tog.setAttribute("aria-checked", on ? "true" : "false");
      if (stateEl) stateEl.textContent = on ? "开" : "关";
      if (label) {
        if (busyState) label.classList.add("is-busy");
        else label.classList.remove("is-busy");
      }
    }

    tog.addEventListener("change", function () {
      var wantOn = !!tog.checked;
      setUi(wantOn, true);
      var tok =
        (typeof window.csrf_token === "string" && window.csrf_token) ||
        (typeof csrf_token === "string" && csrf_token) ||
        "";
      try {
        var inp = document.querySelector('input[name="csrf_token"]');
        if (inp && inp.value) tok = inp.value;
      } catch (e0) {}
      var body =
        "SAVE_THEME_MUSIC=1&UCWC_SECTION=service&SERVICE=" +
        encodeURIComponent(wantOn ? "enabled" : "disabled");
      if (tok) body += "&csrf_token=" + encodeURIComponent(tok);
      var headers = { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" };
      if (tok) headers["X-CSRF-TOKEN"] = tok;
      fetch("/plugins/theme.music/theme-music-save.php", {
        method: "POST",
        headers: headers,
        body: body,
        credentials: "same-origin",
        redirect: "follow",
      })
        .then(function (r) {
          return r.text().then(function (t) {
            var data = null;
            try {
              data = JSON.parse(t);
            } catch (e1) {
              data = null;
            }
            return { okHttp: r.ok, data: data, raw: t };
          });
        })
        .then(function (res) {
          var data = res.data || {};
          if (!res.okHttp || !data.ok) {
            setUi(!wantOn, false);
            var msg = (data && (data.message || data.error)) || "切换失败，请重试";
            try {
              if (window.swal) swal({ title: "主题音乐", text: msg, type: "error" });
              else alert(msg);
            } catch (e2) {
              alert(msg);
            }
            return;
          }
          setUi((data.service || "") === "enabled", true);
          setTimeout(function () {
            try {
              window.location.reload();
            } catch (e3) {
              location.href = location.href;
            }
          }, 280);
        })
        .catch(function () {
          setUi(!wantOn, false);
          try {
            if (window.swal) swal({ title: "主题音乐", text: "网络错误，开关未保存", type: "error" });
            else alert("网络错误，开关未保存");
          } catch (e4) {
            alert("网络错误，开关未保存");
          }
        });
    });
  }

  /** Mount: 音乐 switch after left title text; version + actions stay on right. */
  function mountVersionInPageTitle() {
    try {
      var existing = document.getElementById("tm-title-ver");
      var existingLeft = document.getElementById("tm-title-switch");
      if (
        existing &&
        existing.querySelector("#tm-btn-check") &&
        ((existingLeft && existingLeft.querySelector("#tm-service-toggle")) ||
          existing.querySelector("#tm-service-toggle") ||
          document.getElementById("tm-service-toggle"))
      ) {
        var ex = document.getElementById("tm-bar-extra");
        if (ex) {
          ex.textContent = "";
          ex.hidden = true;
        }
        if (existing.querySelector("#tm-service-toggle") && !existingLeft) {
          /* fall through to re-home switch left */
        } else if (existingLeft && existingLeft.querySelector("#tm-service-toggle")) {
          return;
        }
      }
      var src = document.getElementById("tm-ver-bar");
      if (!src && !existing) return;
      var titles = document.querySelectorAll("div.title");
      var host = null;
      for (var i = 0; i < titles.length; i++) {
        var t = titles[i];
        if (t.closest && t.closest("#theme-music-form")) continue;
        var leftProbe = t.querySelector("span.left") || t;
        var txt = (leftProbe.textContent || "").replace(/\s+/g, " ").trim();
        if (txt.indexOf("Theme Music") >= 0 || txt.indexOf("主题音乐") >= 0) {
          host = t;
          break;
        }
      }
      if (!host) {
        for (var j = 0; j < titles.length; j++) {
          if (titles[j].closest && titles[j].closest("#theme-music-form")) continue;
          host = titles[j];
          break;
        }
      }
      if (!host) host = document.querySelector("#displaybox .content > .title, .content > .title");
      if (!host) return;

      var left = host.querySelector("span.left");
      if (!left) {
        left = document.createElement("span");
        left.className = "left";
        host.insertBefore(left, host.firstChild);
      }
      var right = host.querySelector("span.right");
      if (!right) {
        right = document.createElement("span");
        right.className = "right inline-flex flex-row items-center gap-1";
        host.appendChild(right);
      }

      var wrap = existing;
      if (!wrap) {
        wrap = document.createElement("span");
        wrap.id = "tm-title-ver";
        wrap.className = "tm-title-ver";
      }
      if (src) {
        while (src.firstChild) wrap.appendChild(src.firstChild);
        src.setAttribute("hidden", "");
        src.setAttribute("aria-hidden", "true");
      }

      var sw = wrap.querySelector(".tm-service-switch");
      if (!sw) {
        var togEl = document.getElementById("tm-service-toggle");
        if (togEl) sw = togEl.closest(".tm-service-switch");
      }
      var leftSlot = existingLeft;
      if (!leftSlot) {
        leftSlot = document.createElement("span");
        leftSlot.id = "tm-title-switch";
        leftSlot.className = "tm-title-switch";
      }
      if (sw && sw.parentNode !== leftSlot) {
        leftSlot.appendChild(sw);
      }
      if (leftSlot.parentNode !== left) {
        left.appendChild(leftSlot);
      }
      if (wrap.parentNode !== right) {
        right.appendChild(wrap);
      }
      var extra = document.getElementById("tm-bar-extra");
      if (extra) {
        extra.textContent = "";
        extra.hidden = true;
      }
    } catch (e) {}
  }

  function showCheck(data, opts) {
    opts = opts || {};
    var betaMode = !!opts.beta;
    openPanel(betaMode ? "检查 Beta 更新" : "检查更新");
    updateBar(data);
    var local = data.local || {};
    var localVerRaw = local.installed ? local.version || "" : "";
    var stableMeta = pickStableLatest(data) || data.latest || null;
    var stableId = (stableMeta && stableMeta.id) || data.latest_version || "";
    var bestBeta = betaMode ? pickBestBeta(data) : null;
    var forwardBeta = betaMode ? pickBetaLatest(data, { localVersion: localVerRaw }) : null;
    var latestMeta = betaMode ? null : stableMeta || {};
    var betaState = "";
    var updateAvail = false;
    var remoteId = "-";
    var installTarget = null;

    if (betaMode) {
      if (!bestBeta || !bestBeta.id) {
        betaState = "none";
        latestMeta = null;
      } else if (!forwardBeta || !forwardBeta.id) {
        if (!stableId || isBetaVersionId(stableId)) {
          latestMeta = bestBeta;
          installTarget = bestBeta;
          remoteId = bestBeta.id;
          if (!local.installed || !localVerRaw) {
            betaState = "install";
            updateAvail = true;
          } else if (sameVersionId(localVerRaw, bestBeta.id)) {
            betaState = "reinstall";
            updateAvail = false;
          } else if (isVersionNewer(bestBeta.id, localVerRaw)) {
            betaState = "update";
            updateAvail = true;
          } else {
            betaState = "reinstall";
            updateAvail = false;
          }
        } else {
          betaState = "no_forward";
          latestMeta = null;
        }
      } else {
        latestMeta = forwardBeta;
        installTarget = forwardBeta;
        remoteId = forwardBeta.id;
        if (!local.installed || !localVerRaw) {
          betaState = "install";
          updateAvail = true;
        } else if (sameVersionId(localVerRaw, forwardBeta.id)) {
          betaState = "reinstall";
          updateAvail = false;
        } else if (isVersionNewer(forwardBeta.id, localVerRaw)) {
          betaState = "update";
          updateAvail = true;
        } else {
          betaState = "reinstall";
          updateAvail = false;
        }
      }
    } else {
      latestMeta = stableMeta || pickBestBeta(data) || data.latest || {};
      remoteId = (latestMeta && latestMeta.id) || data.latest_version || "-";
      installTarget = latestMeta;
      if (latestMeta && latestMeta.id) {
        updateAvail = !!(local.installed && localVerRaw && isVersionNewer(latestMeta.id, localVerRaw));
      } else {
        updateAvail = !!data.update_available;
      }
    }

    var html = "";
    html += "<p>当前：" + esc(local.installed ? local.version || "未知" : "未安装");
    if (local.updated_at) html += "（" + esc(local.updated_at) + "）";
    html += "</p>";

    if (betaMode && (betaState === "none" || betaState === "no_forward")) {
      html += '<p class="tm-ok">无最新 Beta 版。</p>';
      if (betaState === "none") {
        html += '<p class="tm-muted ucwc-muted">远程暂无 Beta 包。</p>';
      } else {
        html +=
          '<p class="tm-muted ucwc-muted">列表中的 Beta 均不高于当前正式版' +
          (stableId ? "（" + esc(stableId) + "）" : "") +
          "，无需降级安装旧 Beta。</p>";
      }
    } else {
      if (betaMode) remoteId = (latestMeta && latestMeta.id) || remoteId;
      html +=
        "<p>" +
        (betaMode ? "远程 Beta：" : "远程最新：") +
        "<strong>" +
        esc(remoteId) +
        "</strong>";
      if (latestMeta && latestMeta.label) html += " — " + esc(latestMeta.label);
      if (latestMeta && latestMeta.released_at) html += "（" + esc(latestMeta.released_at) + "）";
      html += "<br>" + chips(latestMeta || {}) + "</p>";
      if (betaMode) {
        if (betaState === "update") html += '<p class="tm-ok">发现新的 Beta 版本，可更新体验。</p>';
        else if (betaState === "reinstall")
          html +=
            '<p class="tm-ok">已安装最新 Beta，可重装。</p>' +
            '<p class="tm-muted ucwc-muted">当前与远程一致，重新安装可修复本地文件。</p>';
        else if (betaState === "install")
          html += '<p class="tm-warn-inline">本地未检测到安装，可一键安装 Beta 版。</p>';
        else html += '<p class="tm-ok">发现可用 Beta 版本。</p>';
      } else if (updateAvail) {
        html += '<p class="tm-ok">发现新版本，可升级到最新版。</p>';
      } else if (local.installed) {
        html += '<p class="tm-ok">已是最新版。仍可重新安装以修复文件。</p>';
      } else {
        html += '<p class="tm-warn-inline">本地未检测到安装，可一键安装最新版。</p>';
      }
    }
    if (!betaMode || (latestMeta && latestMeta.id)) {
      html +=
        '<p class="tm-muted ucwc-muted">安装方式：<strong>OTA</strong> 仅下载变更/缺失文件；<strong>全量</strong> 重新下载全部包文件。与 ThemeEffects 独立更新。</p>';
    }
    body.innerHTML = html;
    actions.innerHTML = "";

    if (!betaMode || (latestMeta && latestMeta.id)) {
      var targetId = "";
      var useLatestAction = false;
      if (betaMode) {
        targetId = (installTarget && installTarget.id) || (latestMeta && latestMeta.id) || "";
      } else if (latestMeta && latestMeta.id) {
        targetId = latestMeta.id;
      } else {
        useLatestAction = true;
      }
      var otaLabel, fullLabel;
      if (betaMode) {
        if (betaState === "update" || betaState === "install") {
          otaLabel = "OTA 安装此 Beta";
          fullLabel = "全量安装此 Beta";
        } else {
          otaLabel = "OTA 重装此 Beta";
          fullLabel = "全量重装此 Beta";
        }
      } else if (updateAvail) {
        otaLabel = "OTA 升级到最新版";
        fullLabel = "全量升级到最新版";
      } else if (local.installed) {
        otaLabel = "OTA 重装最新版";
        fullLabel = "全量重装最新版";
      } else {
        otaLabel = "OTA 安装最新版";
        fullLabel = "全量安装最新版";
      }
      function doInstall(mode) {
        if (useLatestAction) runInstall("install_latest", "", 0, mode);
        else runInstall("install_version", targetId, 0, mode);
      }
      var btnOta = document.createElement("input");
      btnOta.type = "button";
      btnOta.value = otaLabel;
      btnOta.title = "仅下载与服务器不一致或缺失的文件（推荐）";
      btnOta.addEventListener("click", function () {
        doInstall("ota");
      });
      actions.appendChild(btnOta);
      var btnFull = document.createElement("input");
      btnFull.type = "button";
      btnFull.value = fullLabel;
      btnFull.title = "重新下载安装包内全部文件（修复损坏时用）";
      btnFull.addEventListener("click", function () {
        doInstall("full");
      });
      actions.appendChild(btnFull);
    }

    function switchCheckMode(toBeta) {
      openPanel(toBeta ? "检查 Beta 更新" : "检查更新");
      body.innerHTML = "<p>正在检查" + (toBeta ? " Beta 版" : "正式版") + "更新…</p>";
      actions.innerHTML = "";
      api("check_update")
        .then(function (d) {
          showCheck(d, { beta: !!toBeta });
        })
        .catch(function (e) {
          body.innerHTML = '<p class="tm-err">' + esc(e.message || e) + "</p>";
          actions.innerHTML = "";
          var c0 = document.createElement("input");
          c0.type = "button";
          c0.value = "关闭";
          c0.addEventListener("click", closePanel);
          actions.appendChild(c0);
        });
    }
    if (!betaMode) {
      var btnBeta = document.createElement("input");
      btnBeta.type = "button";
      btnBeta.value = "检查 Beta 版更新";
      btnBeta.addEventListener("click", function () {
        switchCheckMode(true);
      });
      actions.appendChild(btnBeta);
    } else {
      var btnStable = document.createElement("input");
      btnStable.type = "button";
      btnStable.value = "检查正式版更新";
      btnStable.addEventListener("click", function () {
        switchCheckMode(false);
      });
      actions.appendChild(btnStable);
    }
    var btn2 = document.createElement("input");
    btn2.type = "button";
    btn2.value = "关闭";
    btn2.addEventListener("click", closePanel);
    actions.appendChild(btn2);
  }

  function showChangelog(data, preselect) {
    openPanel("更新日志");
    cache.versions = data.versions || [];
    cache.latest = data.latest_version || "";
    var sel =
      preselect ||
      (data.selected && data.selected.id) ||
      cache.latest ||
      (cache.versions[0] && cache.versions[0].id) ||
      "";
    cache.selected = sel;
    renderChangelog();
  }

  function renderChangelog() {
    var versions = cache.versions || [];
    var sel = cache.selected;
    var cur = null;
    var list = versions
      .map(function (v) {
        if (v.id === sel) cur = v;
        var cls = "tm-ver-item" + (v.id === sel ? " active" : "");
        return (
          '<button type="button" class="' +
          cls +
          '" data-id="' +
          esc(v.id) +
          '"><strong>' +
          esc(v.id) +
          "</strong> · " +
          esc(v.released_at || "") +
          "<br>" +
          esc(v.label || "") +
          "<br>" +
          chips(v) +
          "</button>"
        );
      })
      .join("");
    var log = (cur && (cur.changelog || cur.label)) || "暂无该版本说明。";
    body.innerHTML =
      '<div class="tm-ver-grid">' +
      '<div class="tm-ver-list">' +
      list +
      "</div>" +
      '<div><div class="tm-log">' +
      esc(log) +
      "</div></div></div>";
    Array.prototype.forEach.call(body.querySelectorAll(".tm-ver-item"), function (el) {
      el.addEventListener("click", function () {
        cache.selected = el.getAttribute("data-id");
        renderChangelog();
      });
    });
    actions.innerHTML = "";
    var go = document.createElement("input");
    go.type = "button";
    go.value = "OTA 安装此版本";
    go.title = "仅下载变更/缺失文件";
    go.addEventListener("click", function () {
      var id = cache.selected || "";
      if (!id) return;
      if (!window.confirm("OTA 安装 " + id + " ？仅下载变更文件，已一致的会跳过。")) return;
      runInstall("install_version", id, 0, "ota");
    });
    actions.appendChild(go);
    var goFull = document.createElement("input");
    goFull.type = "button";
    goFull.value = "全量安装此版本";
    goFull.title = "重新下载全部包文件";
    goFull.addEventListener("click", function () {
      var id = cache.selected || "";
      if (!id) return;
      if (!window.confirm("全量安装 " + id + " ？将重新下载全部文件。")) return;
      runInstall("install_version", id, 0, "full");
    });
    actions.appendChild(goFull);

    var un = document.createElement("input");
    un.type = "button";
    un.value = "一键卸载插件";
    un.addEventListener("click", function () {
      if (
        !window.confirm(
          "确定卸载 Theme Music？\n将删除插件文件，本设置页也会消失。flash 配置会保留。"
        )
      )
        return;
      if (!window.confirm("再次确认：卸载后需重新安装插件才能使用。继续？")) return;
      runInstall("uninstall", "");
    });
    actions.appendChild(un);

    var c = document.createElement("input");
    c.type = "button";
    c.value = "关闭";
    c.addEventListener("click", closePanel);
    actions.appendChild(c);
  }

  function ensureProgressUi(resetLog) {
    if (body) {
      Array.prototype.slice
        .call(body.querySelectorAll("#tm-busy-msg, #tm-out, #tm-progress-wrap"))
        .forEach(function (n) {
          if (n && n.id !== "tm-progress-wrap") {
            if (n.id === "tm-busy-msg" || n.id === "tm-out") {
              if (!n.closest || !n.closest("#tm-progress-wrap")) n.remove();
            }
          }
        });
    }
    var wrap = document.getElementById("tm-progress-wrap");
    if (!wrap) {
      wrap = document.createElement("div");
      wrap.id = "tm-progress-wrap";
      wrap.innerHTML =
        '<p id="tm-busy-msg" class="tm-muted ucwc-muted">准备中…</p>' +
        '<div class="tm-progress" aria-hidden="false">' +
        '<div class="tm-progress-bar" id="tm-progress-bar" style="width:2%"></div>' +
        "</div>" +
        '<div class="tm-progress-meta"><strong id="tm-progress-pct" class="tm-progress-pct">0%</strong></div>' +
        '<pre class="tm-log" id="tm-out" aria-live="polite"></pre>';
      if (body) body.appendChild(wrap);
    } else if (!wrap.querySelector("#tm-out")) {
      var pre = document.createElement("pre");
      pre.className = "tm-log";
      pre.id = "tm-out";
      pre.setAttribute("aria-live", "polite");
      wrap.appendChild(pre);
    }
    var out = document.getElementById("tm-out");
    if (out) {
      out.style.display = "block";
      if (resetLog) out.textContent = "";
    }
    return wrap;
  }

  var _tmLastPct = 0;
  var _tmLastStage = "";
  var _tmProgressStartedAt = 0;
  var _tmHeartTimer = 0;

  function clearProgressHeartbeat() {
    if (_tmHeartTimer) {
      try {
        clearInterval(_tmHeartTimer);
      } catch (eH) {}
      _tmHeartTimer = 0;
    }
  }

  function startProgressHeartbeat() {
    clearProgressHeartbeat();
    _tmProgressStartedAt = Date.now();
    _tmHeartTimer = setInterval(function () {
      if (_tmLastPct > 0 && _tmLastPct < 90) {
        var soft = Math.min(90, _tmLastPct + 1);
        var el = document.getElementById("tm-progress-pct");
        var age = Date.now() - (_tmProgressStartedAt || Date.now());
        if (age > 2500 && soft > _tmLastPct && soft - _tmLastPct <= 8) {
          var bar = document.getElementById("tm-progress-bar");
          if (bar) bar.style.width = soft + "%";
          if (el) el.textContent = soft + "%";
          var msg = document.getElementById("tm-busy-msg");
          if (msg && _tmLastStage) {
            var sec = Math.floor(age / 1000);
            msg.textContent = _tmLastStage + "中…（已用时 " + sec + "s）";
          }
        }
      }
    }, 1200);
  }

  function setProgress(pct, stage, line) {
    ensureProgressUi(false);
    var bar = document.getElementById("tm-progress-bar");
    var pctEl = document.getElementById("tm-progress-pct");
    var msg = document.getElementById("tm-busy-msg");
    var n = _tmLastPct;
    if (pct != null && pct !== "") {
      n = Math.max(0, Math.min(100, parseInt(pct, 10) || 0));
      if (n < _tmLastPct && n > 5) n = _tmLastPct;
      _tmLastPct = n;
      _tmProgressStartedAt = Date.now();
      if (bar) bar.style.width = n + "%";
      if (pctEl) pctEl.textContent = n + "%";
    } else if (pctEl && _tmLastPct >= 0) {
      pctEl.textContent = _tmLastPct + "%";
      n = _tmLastPct;
    }
    if (stage) _tmLastStage = stage;
    if (msg) {
      var base = line || stage || _tmLastStage || "执行中…";
      msg.textContent =
        String(base).replace(/\s*\d+%\s*/g, " ").replace(/\s{2,}/g, " ").replace(/[…\.]*$/, "") +
        "…";
    }
  }

  function appendJobLog(chunk) {
    ensureProgressUi(false);
    var out = document.getElementById("tm-out");
    if (!out || chunk == null || chunk === "") return;
    out.style.display = "block";
    out.textContent += chunk;
    out.scrollTop = out.scrollHeight;
  }

  function showInstallResultActions(ok, pageMayVanish) {
    if (!actions) return;
    actions.innerHTML = "";
    if (ok && !pageMayVanish) {
      var ref = document.createElement("input");
      ref.type = "button";
      ref.value = "刷新页面";
      ref.addEventListener("click", function () {
        try {
          window.location.replace("/Settings/ThemeMusic?_ts=" + Date.now());
        } catch (e) {
          window.location.href = "/Settings/ThemeMusic";
        }
      });
      actions.appendChild(ref);
    }
    if (pageMayVanish) {
      var dash = document.createElement("input");
      dash.type = "button";
      dash.value = "返回仪表盘";
      dash.addEventListener("click", function () {
        try {
          window.location.replace("/Dashboard");
        } catch (e2) {
          window.location.href = "/Dashboard";
        }
      });
      actions.appendChild(dash);
    }
    var c = document.createElement("input");
    c.type = "button";
    c.value = "关闭";
    c.addEventListener("click", closePanel);
    actions.appendChild(c);
  }

  function finishInstall(j) {
    clearProgressHeartbeat();
    setBusy(false);
    var ok = !(j && j.ok === false);
    var msg = (j && (j.message || j.stage)) || (ok ? "完成" : "失败");
    _tmLastPct = 100;
    setProgress(100, ok ? "完成" : "失败", msg);
    if (j && j.local) updateBar({ local: j.local, latest_version: j.version });
    else if (j) updateBar(j);
    appendJobLog("\n==== " + (ok ? "完成" : "失败") + " ====\n" + msg + "\n");
    if (ok) appendJobLog("请强制刷新 WebGUI（Ctrl+F5），或点「刷新页面」。\n");
    else appendJobLog("安装未成功。完整日志见上方，可关闭后重试。\n");
    var vanish = !!(j && j.page_may_vanish);
    if (vanish) appendJobLog("Theme Music 设置页可能已移除，可返回仪表盘。\n");
    showInstallResultActions(ok, vanish);
    if (ok && vanish) {
      setTimeout(function () {
        try {
          window.location.replace("/Dashboard");
        } catch (e3) {
          window.location.href = "/Dashboard";
        }
      }, 2500);
    }
  }

  function pollJob(jobId, offset, vanishHint, failStreak) {
    var fails = failStreak || 0;
    api("job_status", { job_id: jobId, offset: offset || 0 }, 15000)
      .then(function (j) {
        if (!j || !j.ok) throw new Error((j && (j.error || j.message)) || "进度查询失败");
        var job = j.job || {};
        if (j.log) appendJobLog(j.log);
        setProgress(
          job.pct != null ? job.pct : 0,
          job.stage || "",
          job.message || job.stage || "执行中…"
        );
        if (job.done) {
          finishInstall({
            ok: !!job.ok,
            message: job.message || (job.ok ? "完成" : "失败"),
            local: job.local,
            page_may_vanish: job.page_may_vanish != null ? job.page_may_vanish : vanishHint,
            version: job.version,
          });
          return;
        }
        setTimeout(function () {
          pollJob(jobId, j.next_offset || offset || 0, vanishHint, 0);
        }, 700);
      })
      .catch(function (e) {
        if (fails < 8) {
          appendJobLog("\n[重试 " + (fails + 1) + "/8] " + String(e.message || e) + "\n");
          setProgress(null, "重试中", "进度查询暂时失败，正在重试…");
          setTimeout(function () {
            pollJob(jobId, offset || 0, vanishHint, fails + 1);
          }, 1200);
          return;
        }
        clearProgressHeartbeat();
        setBusy(false);
        appendJobLog("\n==== 失败 ====\n进度查询失败：" + String(e.message || e) + "\n");
        setProgress(100, "失败", "进度查询失败");
        showInstallResultActions(false, false);
      });
  }

  function runInstall(action, version, attempt, installMode) {
    if (busy && !attempt) return;
    var tryN = attempt || 1;
    var maxTry = 4;
    var mode = installMode === "full" ? "full" : action === "uninstall" ? "" : "ota";
    setBusy(true, "正在启动任务…");
    if (body && tryN === 1) body.innerHTML = "";
    ensureProgressUi(tryN === 1);
    _tmLastPct = 0;
    _tmLastStage = "启动任务";
    clearProgressHeartbeat();
    setProgress(
      3,
      "启动任务",
      tryN > 1 ? "重试提交安装请求（" + tryN + "/" + maxTry + "）…" : "正在提交安装请求…"
    );
    appendJobLog(
      "[" +
        new Date().toLocaleTimeString() +
        "] 提交 " +
        action +
        (version ? " " + version : "") +
        (mode ? " [" + (mode === "full" ? "全量" : "OTA") + "]" : "") +
        (tryN > 1 ? "（重试 " + tryN + "/" + maxTry + "）" : "") +
        "…\n"
    );
    var extra = { async: "1" };
    if (version) extra.version = version;
    if (mode) extra.install_mode = mode;
    var forceGet = tryN % 2 === 1;
    appendJobLog("传输方式：" + (forceGet ? "GET+csrf" : "POST") + "\n");
    api(action, extra, 10000, forceGet)
      .then(function (j) {
        if (!j || !j.ok) {
          setBusy(false);
          var err = (j && (j.message || j.error)) || "操作失败";
          appendJobLog("==== 失败 ====\n" + err + "\n");
          setProgress(100, "失败", err);
          showInstallResultActions(false, false);
          return;
        }
        if (j.async && j.job_id) {
          _tmLastPct = 6;
          startProgressHeartbeat();
          setProgress(6, "任务已启动", j.message || "任务已启动，正在拉取进度…");
          appendJobLog(
            "job_id=" +
              j.job_id +
              (j.enqueue_ms != null ? "（入队 " + j.enqueue_ms + "ms）" : "") +
              "\n"
          );
          pollJob(j.job_id, 0, !!j.page_may_vanish);
          return;
        }
        if (j.output) appendJobLog(String(j.output).slice(0, 8000) + "\n");
        else if (j.message) appendJobLog(String(j.message) + "\n");
        finishInstall(j);
      })
      .catch(function (e) {
        var err = String(e && e.message ? e.message : e);
        var retryable =
          /超时|timeout|aborted|空响应|非 JSON|504|502|401|未登录|会话|网络|Failed to fetch|NetworkError|CSRF/i.test(
            err
          );
        if (retryable && tryN < maxTry) {
          appendJobLog("[提示] " + err + " — 将自动重试（切换传输方式）…\n");
          setProgress(3, "等待重试", "Web 鉴权/进程繁忙，稍后重试…");
          setTimeout(function () {
            busy = false;
            runInstall(action, version, tryN + 1, mode || installMode);
          }, 1200 * tryN);
          return;
        }
        setBusy(false);
        appendJobLog("==== 失败 ====\n" + err + "\n");
        setProgress(100, "失败", err);
        showInstallResultActions(false, false);
      });
  }

  function wire(id, fn) {
    var el = document.getElementById(id);
    if (el) el.addEventListener("click", fn);
  }

  function bindVersionUi() {
    panel = document.getElementById("tm-panel");
    mask = document.getElementById("tm-panel-mask");
    body = document.getElementById("tm-panel-body");
    actions = document.getElementById("tm-panel-actions");
    title = document.getElementById("tm-panel-title");
    var closer = document.getElementById("tm-panel-close");
    if (closer) closer.addEventListener("click", closePanel);
    if (mask) mask.addEventListener("click", closePanel);

    mountVersionInPageTitle();
    wireServiceToggle();

    wire("tm-btn-check", function () {
      openPanel("检查更新");
      body.innerHTML = "<p>正在检查更新…</p>";
      actions.innerHTML = "";
      api("check_update")
        .then(function (d) {
          showCheck(d, { beta: false });
        })
        .catch(function (e) {
          body.innerHTML = '<p class="tm-err">' + esc(e.message || e) + "</p>";
        });
    });
    wire("tm-btn-log", function () {
      openPanel("更新日志");
      body.innerHTML = "<p>正在加载更新日志…</p>";
      actions.innerHTML = "";
      api("changelog")
        .then(function (d) {
          showChangelog(d);
        })
        .catch(function (e) {
          body.innerHTML = '<p class="tm-err">' + esc(e.message || e) + "</p>";
        });
    });

    api("status", null, 12000)
      .then(function (d) {
        updateBar(d);
      })
      .catch(function () {});
  }

  /**
   * ThemeEffects-style row hide for mobile profile when run mode = same.
   */
  function hideRow(el, hide) {
    if (!el) return;
    var i, n, dd, dt, next, tr, dl;

    function mark(node, on) {
      if (!node) return;
      if (on) {
        node.classList.add("ucwc-row-hidden");
        node.classList.add("tm-row-hidden");
        node.style.setProperty("display", "none", "important");
        node.style.setProperty("height", "0", "important");
        node.style.setProperty("margin", "0", "important");
        node.style.setProperty("padding", "0", "important");
        node.style.setProperty("border", "0", "important");
        node.style.setProperty("visibility", "hidden", "important");
        node.style.setProperty("max-height", "0", "important");
        node.style.setProperty("overflow", "hidden", "important");
      } else {
        node.classList.remove("ucwc-row-hidden");
        node.classList.remove("tm-row-hidden");
        ["display", "height", "margin", "padding", "border", "visibility", "max-height", "overflow"].forEach(function (p) {
          node.style.removeProperty(p);
        });
      }
    }

    function isHelpish(node) {
      if (!node || node.nodeType !== 1) return false;
      if (node.tagName === "BLOCKQUOTE" || node.tagName === "P") return true;
      if (node.classList && (node.classList.contains("help") || node.classList.contains("inline_help"))) return true;
      if (node.querySelector && node.querySelector("select,input,textarea,button")) return false;
      var t = (node.textContent || "").replace(/\s+/g, " ").trim();
      if (!t) return true;
      return !node.querySelector || !node.querySelector("select,input,textarea,button,a[href]");
    }

    function hideFollowingHelp(from, on) {
      var cur = from ? from.nextElementSibling : null;
      while (cur) {
        if (cur.tagName === "DL" || cur.tagName === "TABLE" || cur.tagName === "FORM") break;
        if (cur.tagName === "TR" && cur.querySelector && cur.querySelector("select,input,textarea,button")) break;
        if (isHelpish(cur) || cur.tagName === "BLOCKQUOTE") {
          mark(cur, on);
          cur = cur.nextElementSibling;
          continue;
        }
        if (!(cur.textContent || "").replace(/\s+/g, "").length) {
          mark(cur, on);
          cur = cur.nextElementSibling;
          continue;
        }
        break;
      }
    }

    n = el;
    for (i = 0; i < 14 && n; i++) {
      if (n.tagName === "DL") {
        dl = n;
        var controls = dl.querySelectorAll("select,input,textarea,button");
        if (controls.length > 1) {
          dd = null;
          var p = el;
          for (var j = 0; j < 10 && p && p !== dl; j++) {
            if (p.tagName === "DD") {
              dd = p;
              break;
            }
            p = p.parentNode;
          }
          if (dd) {
            mark(dd, hide);
            dt = dd.previousElementSibling;
            while (dt && dt.tagName !== "DT" && dt.tagName !== "DD") dt = dt.previousElementSibling;
            if (dt && dt.tagName === "DT") mark(dt, hide);
            return;
          }
        }
        mark(dl, hide);
        hideFollowingHelp(dl, hide);
        return;
      }
      if (n.tagName === "TR") {
        tr = n;
        mark(tr, hide);
        next = tr.nextElementSibling;
        while (next && next.tagName === "TR") {
          if (next.querySelector && next.querySelector("select,input,textarea,button")) break;
          mark(next, hide);
          next = next.nextElementSibling;
        }
        hideFollowingHelp(tr, hide);
        return;
      }
      if (n.tagName === "FORM" || n.tagName === "TABLE") break;
      n = n.parentNode;
    }
    dd = null;
    n = el;
    for (i = 0; i < 12 && n; i++) {
      if (n.tagName === "DD") {
        dd = n;
        break;
      }
      if (n.tagName === "DL" || n.tagName === "FORM") break;
      n = n.parentNode;
    }
    if (!dd) {
      mark(el, hide);
      return;
    }
    mark(dd, hide);
    dt = dd.previousElementSibling;
    while (dt && dt.tagName !== "DT" && dt.tagName !== "DD") dt = dt.previousElementSibling;
    if (dt && dt.tagName === "DT") mark(dt, hide);
    hideFollowingHelp(dd, hide);
  }

  function syncMobileRows() {
    if (!form) return;
    var m = form.querySelector('select[name="MUSIC_RUN_MODE_MOBILE"]');
    var same = !m || String(m.value || "same") === "same";
    hideRow(form.querySelector('[name="MUSIC_VOLUME_MOBILE"]'), same);
    hideRow(form.querySelector('[name="MUSIC_AUTOPLAY_MOBILE"]'), same);
    hideRow(form.querySelector('[name="MUSIC_SHUFFLE_MOBILE"]'), same);
    hideRow(form.querySelector('[name="MUSIC_REPEAT_MOBILE"]'), same);
  }

  /**
   * ThemeEffects wallpaper-style: local music dir only when source = local.
   */
  function syncSourceRows() {
    if (!form) return;
    var src = form.querySelector('select[name="MUSIC_SOURCE"]');
    var val = src ? String(src.value || "local") : "local";
    var isLocal = val === "local";
    var isNavidrome = val === "navidrome";
    var isFnos = val === "fnos";
    hideRow(form.querySelector('[name="MUSIC_LOCAL_DIR"]'), !isLocal);
    hideRow(document.getElementById("tm-music-local-dir"), !isLocal);
    [
      "tm-navidrome-url",
      "tm-navidrome-user",
      "tm-navidrome-password",
      "tm-btn-test-navidrome",
    ].forEach(function (id) {
      hideRow(document.getElementById(id), !isNavidrome);
    });
    [
      "tm-fnos-url",
      "tm-fnos-user",
      "tm-fnos-password",
    ].forEach(function (id) {
      hideRow(document.getElementById(id), !isFnos);
    });
  }

  function wireNavidromeTest() {
    var btn = document.getElementById("tm-btn-test-navidrome");
    var out = document.getElementById("tm-navidrome-status");
    var url = document.getElementById("tm-navidrome-url");
    var user = document.getElementById("tm-navidrome-user");
    var password = document.getElementById("tm-navidrome-password");
    if (!btn || !out) return;
    btn.addEventListener("click", function (ev) {
      if (ev) {
        ev.preventDefault();
        ev.stopPropagation();
      }
      var values = {
        url: url ? String(url.value || "").trim() : "",
        user: user ? String(user.value || "").trim() : "",
        password: password ? String(password.value || "") : "",
      };
      if (!values.url || !values.user) {
        out.textContent = "请先填写 Navidrome 地址和用户名";
        return;
      }
      btn.disabled = true;
      out.textContent = "正在连接…";
      var csrf = csrfToken();
      var body = "url=" + encodeURIComponent(values.url) +
        "&user=" + encodeURIComponent(values.user) +
        "&password=" + encodeURIComponent(values.password);
      if (csrf) body += "&csrf_token=" + encodeURIComponent(csrf);
      fetch("/plugins/theme.music/ucwc-music-api.php?action=navidrome_test&_ts=" + Date.now(), {
        method: "POST",
        credentials: "same-origin",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        },
        body: body,
        cache: "no-store",
      })
        .then(function (r) {
          return r.json();
        })
        .then(function (j) {
          if (!j || !j.ok) {
            out.textContent = (j && j.error) || "连接失败";
            return;
          }
          var bits = ["连接正常"];
          if (j.server_version) bits.push("Navidrome " + j.server_version);
          if (typeof j.song_count === "number") bits.push(j.song_count + " 首");
          out.textContent = bits.join(" · ");
        })
        .catch(function () {
          out.textContent = "连接请求失败";
        })
        .then(function () {
          btn.disabled = false;
        });
    });
  }

  function wireForm() {
    if (!form) return;
    var vol = document.getElementById("tm-music-volume");
    var lab = document.getElementById("tm-music-volume-val");
    if (vol && lab) {
      vol.addEventListener("input", function () {
        lab.textContent = String(vol.value);
        onDirty();
      });
      vol.addEventListener("change", onDirty);
    }
    var volM = document.getElementById("tm-music-volume-mobile");
    var labM = document.getElementById("tm-music-volume-mobile-val");
    if (volM && labM) {
      volM.addEventListener("input", function () {
        labM.textContent = String(volM.value);
        onDirty();
      });
      volM.addEventListener("change", onDirty);
    }
    var pathEl = document.getElementById("tm-music-local-dir");
    if (pathEl) {
      pathEl.addEventListener("input", onDirty);
      pathEl.addEventListener("change", onDirty);
    }
    form.addEventListener("input", onDirty);
    form.addEventListener("change", function () {
      onDirty();
      syncMobileRows();
      syncSourceRows();
    });
    var mobSel = form.querySelector('select[name="MUSIC_RUN_MODE_MOBILE"]');
    if (mobSel) {
      mobSel.addEventListener("change", function () {
        syncMobileRows();
        onDirty();
      });
    }
    var srcSel = form.querySelector('select[name="MUSIC_SOURCE"]');
    if (srcSel) {
      srcSel.addEventListener("change", function () {
        syncSourceRows();
        onDirty();
        setTimeout(alignCtrlWidth, 0);
      });
    }
    syncMobileRows();
    syncSourceRows();
    wireNavidromeTest();
    var sels = form.querySelectorAll("select");
    for (var si = 0; si < sels.length; si++) {
      sels[si].addEventListener("change", onDirty);
      sels[si].addEventListener("input", onDirty);
    }

    try {
      if (window.jQuery) {
        window.jQuery(form)
          .find("select,input[type=text],input[type=range],textarea")
          .on("input change", onDirty);
      }
    } catch (e) {}

    try {
      var saveBtn = document.getElementById("tm-btn-save");
      if (saveBtn && window.MutationObserver) {
        var dirty = false;
        var moTimer = 0;
        form.addEventListener(
          "change",
          function () {
            dirty = true;
          },
          true
        );
        form.addEventListener(
          "input",
          function () {
            dirty = true;
          },
          true
        );
        var mo = new MutationObserver(function () {
          if (!dirty || !saveBtn.disabled) return;
          if (moTimer) return;
          moTimer = setTimeout(function () {
            moTimer = 0;
            if (!dirty) return;
            saveBtn.disabled = false;
            saveBtn.removeAttribute("disabled");
            saveBtn.classList.add("lock");
          }, 0);
        });
        mo.observe(saveBtn, { attributes: true, attributeFilter: ["disabled"] });
      }
    } catch (e2) {}
  }

  function formatBytes(n) {
    n = Number(n) || 0;
    if (n < 1024) return n + " B";
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
    return (n / (1024 * 1024)).toFixed(1) + " MB";
  }

  function wireCacheClear() {
    var status = document.getElementById("tm-cache-status");
    var map = [
      ["tm-btn-clear-legacy-cache", "all", "启动盘旧"],
    ];
    function setStatus(msg, isErr) {
      if (!status) return;
      status.textContent = msg || "";
      status.style.color = isErr ? "var(--orange-800, #c80)" : "";
    }
    function run(what, label) {
      setStatus("正在清理" + label + "缓存…");
      var url =
        "/plugins/theme.music/ucwc-music-api.php?action=clear_cache&what=" +
        encodeURIComponent(what) +
        "&_ts=" +
        Date.now();
      fetch(url, {
        credentials: "same-origin",
        headers: { Accept: "application/json" },
        cache: "no-store",
      })
        .then(function (r) {
          return r.json();
        })
        .then(function (j) {
          if (!j || !j.ok) {
            setStatus((j && j.error) || "清理失败", true);
            return;
          }
          var parts = [];
          var totalN = 0;
          var totalB = 0;
          ["lyrics", "cover"].forEach(function (k) {
            if (!j[k]) return;
            totalN += Number(j[k].removed) || 0;
            totalB += Number(j[k].bytes) || 0;
            if (j[k].error) parts.push(k + ":" + j[k].error);
          });
          if (parts.length) {
            setStatus("部分失败：删除 " + totalN + " 个（" + formatBytes(totalB) + "）；" + parts.join("；"), true);
          } else {
            setStatus("已清理 " + label + "缓存：删除 " + totalN + " 个文件（" + formatBytes(totalB) + "）");
          }
        })
        .catch(function () {
          setStatus("清理请求失败", true);
        });
    }
    for (var i = 0; i < map.length; i++) {
      (function (id, what, label) {
        var btn = document.getElementById(id);
        if (!btn) return;
        btn.addEventListener(
          "click",
          function (ev) {
            try {
              if (ev) {
                ev.preventDefault();
                ev.stopPropagation();
              }
            } catch (e0) {}
            // Avoid marking the main form dirty / unlocking Apply solely for cache ops
            run(what, label);
          },
          false
        );
      })(map[i][0], map[i][1], map[i][2]);
    }
  }

  function wireStorageStatus() {
    var detected = document.getElementById("tm-storage-detected");
    var status = document.getElementById("tm-storage-status");
    function getJson(url) {
      return fetch(url, {
        credentials: "same-origin",
        headers: { Accept: "application/json" },
        cache: "no-store",
      }).then(function (r) { return r.json(); });
    }
    if (detected) {
      getJson("/plugins/theme.music/ucwc-music-api.php?action=config&_ts=" + Date.now())
        .then(function (j) {
          var s = j && j.storage;
          detected.textContent = s && s.label ? "自动检测：" + s.label : "自动检测：等待有效音源";
        })
        .catch(function () { detected.textContent = "自动检测暂不可用"; });
    }
    if (!status) return;
    var stopped = false;
    function poll() {
      if (stopped) return;
      getJson("/plugins/theme.music/ucwc-music-api.php?action=storage_status&_ts=" + Date.now())
        .then(function (j) {
          if (!j) return;
          status.textContent = j.label || "等待播放自动检测";
          status.style.color = j.status === "failed" ? "var(--orange-800, #c80)" : "";
        })
        .catch(function () {});
    }
    poll();
    var timer = setInterval(poll, 2000);
    window.addEventListener("pagehide", function () {
      stopped = true;
      clearInterval(timer);
    }, { once: true });
  }

  function bootUi() {
    wireForm();
    syncMobileRows();
    syncSourceRows();
    wireFileTreePickers();
    alignCtrlWidth();
    bindVersionUi();
    wireCacheClear();
    wireStorageStatus();
    setTimeout(syncMobileRows, 0);
    setTimeout(syncSourceRows, 0);
    setTimeout(alignCtrlWidth, 50);
    setTimeout(alignCtrlWidth, 300);
    setTimeout(wireFileTreePickers, 100);
    setTimeout(wireFileTreePickers, 400);
    setTimeout(function () {
      mountVersionInPageTitle();
      wireServiceToggle();
    }, 0);
    setTimeout(function () {
      mountVersionInPageTitle();
      wireServiceToggle();
    }, 200);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootUi);
  } else {
    bootUi();
  }
  window.addEventListener("resize", function () {
    alignCtrlWidth();
  });
  try {
    if (window.jQuery) {
      window.jQuery(function () {
        setTimeout(alignCtrlWidth, 0);
        setTimeout(alignCtrlWidth, 200);
        setTimeout(wireFileTreePickers, 50);
        setTimeout(function () {
          mountVersionInPageTitle();
          wireServiceToggle();
        }, 50);
      });
    }
  } catch (e) {}
})();
