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
        u += "&" + encodeURIComponent(k) + "=" + encodeURIComponent(params[k]);
      });
    }
    return u;
  }

  function phpGet(action, params) {
    return fetch(apiUrl(action, params), { method: "GET", credentials: "same-origin" })
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      });
  }

  function phpPost(action, body) {
    return fetch(apiUrl(action), {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {}),
    }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    });
  }

  function phpRawUrl(action) {
    return apiUrl(action);
  }

  // ----------------------------------------------------------------
  // Field collectors
  // ----------------------------------------------------------------
  function readMusicConfig() {
    return {
      MUSIC_DIR: ($("#tm-music-dir") || {}).value || "/mnt/user/music",
      MUSIC_SHARE: ($("#tm-music-share") || {}).value || "/mnt/user/music",
      MUSIC_DISKS: ($("#tm-music-disks") || {}).value || "/mnt/disk1/music,/mnt/disk2/music",
      MUSIC_SMB: ($("#tm-music-smb") || {}).value || "",
      MUSIC_NFS: ($("#tm-music-nfs") || {}).value || "",
      MUSIC_FNOS_URL: ($("#tm-fnos-url") || {}).value || "",
      MUSIC_FNOS_USER: ($("#tm-fnos-user") || {}).value || "",
      MUSIC_FNOS_PASSWORD: ($("#tm-fnos-password") || {}).value || "",
      MUSIC_NAVIDROME_URL: ($("#tm-navidrome-url") || {}).value || "",
      MUSIC_NAVIDROME_USER: ($("#tm-navidrome-user") || {}).value || "",
      MUSIC_NAVIDROME_PASSWORD: ($("#tm-navidrome-password") || {}).value || "",
      MUSIC_CARD_MODE: (($("#tm-card-mode") || {}).value || "card"),
      MUSIC_CHIP_MODE: (($("#tm-chip-mode") || {}).value || "chip"),
    };
  }

  function writeMusicConfig(cfg) {
    if (!cfg) return;
    var map = {
      "tm-music-dir": "MUSIC_DIR",
      "tm-music-share": "MUSIC_SHARE",
      "tm-music-disks": "MUSIC_DISKS",
      "tm-music-smb": "MUSIC_SMB",
      "tm-music-nfs": "MUSIC_NFS",
      "tm-fnos-url": "MUSIC_FNOS_URL",
      "tm-fnos-user": "MUSIC_FNOS_USER",
      "tm-fnos-password": "MUSIC_FNOS_PASSWORD",
      "tm-navidrome-url": "MUSIC_NAVIDROME_URL",
      "tm-navidrome-user": "MUSIC_NAVIDROME_USER",
      "tm-navidrome-password": "MUSIC_NAVIDROME_PASSWORD",
      "tm-card-mode": "MUSIC_CARD_MODE",
      "tm-chip-mode": "MUSIC_CHIP_MODE",
    };
    Object.keys(map).forEach(function (id) {
      var el = $("#" + id);
      if (el && cfg[map[id]] !== undefined && cfg[map[id]] !== null) {
        el.value = cfg[map[id]];
      }
    });
  }

  // ----------------------------------------------------------------
  // Toast
  // ----------------------------------------------------------------
  function toast(msg, kind) {
    var t = $("#tm-toast");
    if (!t) {
      t = document.createElement("div");
      t.id = "tm-toast";
      t.className = "tm-toast";
      document.body.appendChild(t);
    }
    t.className = "tm-toast tm-toast-show" + (kind ? " tm-toast-" + kind : "");
    t.textContent = msg;
    clearTimeout(t._h);
    t._h = setTimeout(function () {
      t.className = "tm-toast";
    }, 2200);
  }

  // ----------------------------------------------------------------
  // Field mode (card / chip)
  // ----------------------------------------------------------------
  function wireFieldMode() {
    var card = $("#tm-card-mode");
    var chip = $("#tm-chip-mode");
    if (card) card.addEventListener("change", function () {
      toast("已切换为「卡片」显示模式");
    });
    if (chip) chip.addEventListener("change", function () {
      toast("已切换为「胶囊」显示模式");
    });
  }

  // ----------------------------------------------------------------
  // Save / load config
  // ----------------------------------------------------------------
  function wireSave() {
    var btn = $("#tm-save");
    if (!btn) return;
    btn.addEventListener("click", function () {
      var cfg = readMusicConfig();
      phpPost("save_cfg", cfg).then(function (r) {
        if (r && r.ok) {
          toast("配置已保存", "ok");
          refreshStorageStatus();
        } else {
          toast("保存失败: " + (r && r.error ? r.error : "未知错误"), "err");
        }
      }).catch(function (e) {
        toast("保存失败: " + e.message, "err");
      });
    });
  }

  function loadConfig() {
    phpGet("config").then(function (r) {
      if (r && r.ok && r.config) writeMusicConfig(r.config);
    }).catch(function (e) {
      console.warn("[ThemeMusic] load config failed:", e);
    });
  }

  // ----------------------------------------------------------------
  // FnOS connection test
  // ----------------------------------------------------------------
  function wireFnosTest() {
    var btn = $("#tm-fnos-test");
    if (!btn) return;
    var status = $("#tm-fnos-status");
    btn.addEventListener("click", function () {
      var url = (($("#tm-fnos-url") || {}).value || "").trim();
      var user = (($("#tm-fnos-user") || {}).value || "").trim();
      var password = (($("#tm-fnos-password") || {}).value || "").trim();
      if (status) {
        status.textContent = "正在连接…";
        status.className = "tm-status tm-status-pending";
      }
      var body = new URLSearchParams();
      body.set("url", url);
      body.set("user", user);
      body.set("password", password);
      fetch(phpRawUrl("fnos_test"), {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      })
        .then(function (r) {
          if (!r.ok) throw new Error("HTTP " + r.status);
          return r.json();
        })
        .then(function (j) {
          if (j && j.ok) {
            if (status) {
              status.textContent = "连接成功！";
              status.className = "tm-status tm-status-ok";
            }
            toast("飞牛音乐连接成功", "ok");
          } else {
            if (status) {
              status.textContent = "连接失败: " + (j && j.error ? j.error : "未知错误");
              status.className = "tm-status tm-status-err";
            }
            toast("飞牛连接失败: " + (j && j.error ? j.error : "未知错误"), "err");
          }
        })
        .catch(function (e) {
          if (status) {
            status.textContent = "请求失败: " + e.message;
            status.className = "tm-status tm-status-err";
          }
          toast("飞牛连接失败: " + e.message, "err");
        });
    });
  }

  // ----------------------------------------------------------------
  // Navidrome connection test
  // ----------------------------------------------------------------
  function wireNavidromeTest() {
    var btn = $("#tm-navidrome-test");
    if (!btn) return;
    var status = $("#tm-navidrome-status");
    btn.addEventListener("click", function () {
      var url = (($("#tm-navidrome-url") || {}).value || "").trim();
      var user = (($("#tm-navidrome-user") || {}).value || "").trim();
      var password = (($("#tm-navidrome-password") || {}).value || "").trim();
      if (status) {
        status.textContent = "正在连接…";
        status.className = "tm-status tm-status-pending";
      }
      var body = new URLSearchParams();
      body.set("url", url);
      body.set("user", user);
      body.set("password", password);
      fetch(phpRawUrl("navidrome_test"), {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      })
        .then(function (r) {
          if (!r.ok) throw new Error("HTTP " + r.status);
          return r.json();
        })
        .then(function (j) {
          if (j && j.ok) {
            if (status) {
              status.textContent = "连接成功！";
              status.className = "tm-status tm-status-ok";
            }
            toast("Navidrome 连接成功", "ok");
          } else {
            if (status) {
              status.textContent = "连接失败: " + (j && j.error ? j.error : "未知错误");
              status.className = "tm-status tm-status-err";
            }
            toast("Navidrome 连接失败: " + (j && j.error ? j.error : "未知错误"), "err");
          }
        })
        .catch(function (e) {
          if (status) {
            status.textContent = "请求失败: " + e.message;
            status.className = "tm-status tm-status-err";
          }
          toast("Navidrome 连接失败: " + e.message, "err");
        });
    });
  }

  // ----------------------------------------------------------------
  // Storage status (detected label only — single-line, single strategy)
  // ----------------------------------------------------------------
  function detectedLabel(strategy) {
    switch ((strategy || "").toString()) {
      case "local_disk":   return "本地磁盘：等待唤醒";
      case "local_share":  return "Unraid 用户共享：已就绪";
      case "smb":          return "SMB 远端默认挂载";
      case "nfs":          return "NFS 远端默认挂载";
      case "fnos":         return "飞牛音乐 (FnOS)";
      case "navidrome":    return "Navidrome 远端 API";
      case "invalid":      return "本地音乐目录不可访问";
      case "empty":        return "本地音乐目录为空";
      default:             return "等待播放自动检测";
    }
  }

  function wireStorageStatus() {
    var detected = $("#tm-storage-detected");
    var status = $("#tm-storage-status");
    if (!detected && !status) return;
    function refresh() {
      phpGet("storage_status").then(function (j) {
        if (!j) return;
        var strat = (j.strategy || "").toString();
        // 1) 始终只显示「自动检测」单条 — 按 strategy 单独渲染
        if (detected) {
          if (j.ok) {
            detected.textContent = "自动检测：" + detectedLabel(strat);
            detected.className = "tm-status tm-status-ok";
          } else {
            detected.textContent = "自动检测：" + detectedLabel(strat || "invalid");
            detected.className = "tm-status tm-status-err";
          }
        }
        // 2) status span 显示实时存储状态（磁盘唤醒 / SMB 已就绪等）
        if (status) {
          if (j.ok) {
            status.textContent = j.label || detectedLabel(strat);
            status.className = "tm-status tm-status-ok";
          } else {
            status.textContent = j.label || "未就绪";
            status.className = "tm-status tm-status-err";
          }
        }
      }).catch(function (e) {
        if (status) {
          status.textContent = "状态查询失败: " + e.message;
          status.className = "tm-status tm-status-err";
        }
      });
    }
    refresh();
    setInterval(refresh, 5000);
  }

  function refreshStorageStatus() {
    wireStorageStatus();
  }

  // ----------------------------------------------------------------
  // Init
  // ----------------------------------------------------------------
  function bootUi() {
    loadConfig();
    wireFieldMode();
    wireSave();
    wireFnosTest();
    wireNavidromeTest();
    wireStorageStatus();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootUi);
  } else {
    bootUi();
  }
})();
