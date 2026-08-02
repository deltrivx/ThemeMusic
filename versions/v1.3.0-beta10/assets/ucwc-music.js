/**
 * ThemeMusic player — dashboard card + sitewide capsule
 * Layout: left cover/meta + buttons; progress/controls under buttons (full width of btn row);
 *         right panel toggles 曲目 ⇄ 歌词 (default 曲目). Local LRC sidecar sync.
 * Cross-page: the chip stays embedded in the Tower page with an inline <audio> element.
 * No popup windows are used. Page navigation stops playback.
 */
(function (global) {
  "use strict";

  var LS_KEY = "ucwc_music_v1";
  var PLAY_KEY = "ucwc_music_play_v1";
  var PLAY_TTL_MS = 6 * 60 * 60 * 1000; // 6h
  var LIBRARY_CACHE_KEY = "ucwc_music_library_v2";
  var LIBRARY_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
  var LYRIC_DRIFT_KEY = "ucwc_music_lyric_drift_v1";
  var apiBase = "/plugins/theme.music/ucwc-music-api.php";
  var state = {
    tracks: [],
    index: 0,
    playing: false,
    shuffle: false,
    repeat: "off", // off | one | all
    volume: 0.7,
    sideMode: "list", // list | lyrics | info (info is transient)
    sideBeforeInfo: "list",
    loaded: false,
    error: "",
    listFilter: "",
    /* artist | title | path | size — display order only; state.index still points into tracks[] */
    listSort: "artist",
    listTruncated: false,
    listLimit: 0,
    listTip: "",
    listRenderLimit: 300,
    libraryScanning: false,
    lyrics: {
      id: "",
      lines: [],
      offsetMs: 0,
      driftMs: 0,
      active: -1,
      loading: false,
      empty: true,
      unsynced: false,
      seq: 0,
    },
    cover: {
      id: "",
      url: "",
      blobUrl: "",
      loading: false,
      seq: 0,
      paintGen: 0,
      paintedId: "", // track id currently shown in <img>
      missId: "", // confirmed no-cover for this track (stop empty clear/retry loop)
    },
  };
  var audio = null;
  var root = null;
  var chip = null;
  var chipEls = {};
  var els = {};
  var seeking = false;
  var seekingSince = 0;
  var bootDone = false;
  var playPersistTimer = null;
  var resumePending = null;
  var gestureBound = false;
  var gestureResumeWanted = false;
  var lyricsSyncLast = 0;
  var resumeIntent = false; // user was playing; keep trying across navigations
  var lastNavSave = 0;
  var mountTimer = null;
  var resumeAttempted = false;
  var chipDrag = { on: false, moved: false, ox: 0, oy: 0, sx: 0, sy: 0 };
  var CHIP_POS_KEY = "ucwc_music_chip_pos_v1";
  var DASH_POS_KEY = "ucwc_music_dash_pos_v3";
  var DASH_POS_SERVER_TS = 0;
  var dashPosServerLoaded = false;
  var dashPosSaveTimer = 0;
  var rightPaneFitTimer = 0;
  /* Left stays fixed at ideal; right fills residual (no hard max — kills empty strip). */
  var RIGHT_W_MIN = 140;
  var LEFT_W_IDEAL = 286;
  var LEFT_W_MIN = 200;
  var PANE_GAP = 14;
  var BODY_PAD_X = 28; // .ucwc-music-body 14+14
  var audioGen = 0; // bump when reloading src to ignore stale play()
  var lastSrcId = "";
  var playRetryTimer = null;
  var playRetryCount = 0;
  var playAttemptToken = 0;
  var autoplayPolicyBlocked = false;
  var pendingResume = false;
  var uiPlayStableUntil = 0;
  var pendingSeekTo = 0;
  var resumeLockId = "";
  var listFetchSeq = 0;
  var listFilterTimer = 0;
  var libraryPollTimer = 0;
  /** After one successful play() in this document, later programmatic plays are freer on mobile. */
  var mediaUnlocked = false;
  var unlockCtx = null;
  var stallRecoverAt = 0;
  var stallZeroSince = 0;
  function rawCfg() {
    // ThemeMusic owns __UCWC_MUSIC__ so ThemeEffects (music.enable=false) cannot
    // clobber sitewide play when both plugins are installed.
    var m = global.__UCWC_MUSIC__;
    if (m && typeof m === "object") return m;
    var t = global.__UCWC_THEME__ || {};
    return t.music || {};
  }

  function isMobileDevice() {
    try {
      var w = window.innerWidth || document.documentElement.clientWidth || 0;
      if (w > 0 && w < 768 && isCoarsePointer()) return true;
      if (isCoarsePointer() && w > 0 && w <= 900) return true;
    } catch (e0) {}
    return false;
  }

  /** Effective playback profile: PC flat fields, or mobile overrides when not "same". */
  function cfg() {
    var c = rawCfg() || {};
    if (!isMobileDevice()) return c;
    var mob = c.mobile && typeof c.mobile === "object" ? c.mobile : null;
    if (!mob) return c;
    var mm = String(mob.run_mode || "same").toLowerCase();
    if (mm === "same" || mm === "") return c;
    var out = {};
    var k;
    for (k in c) {
      if (Object.prototype.hasOwnProperty.call(c, k) && k !== "mobile") out[k] = c[k];
    }
    if (mm === "card" || mm === "chip" || mm === "both") {
      out.run_mode = mm;
      out.ui = mm;
      out.dash_only = mm === "card";
    }
    if (typeof mob.volume === "number") out.volume = mob.volume;
    if (typeof mob.autoplay === "boolean") out.autoplay = mob.autoplay;
    if (typeof mob.shuffle === "boolean") out.shuffle = mob.shuffle;
    if (mob.repeat === "off" || mob.repeat === "one" || mob.repeat === "all") out.repeat = mob.repeat;
    return out;
  }

  function enabled() {
    var c = cfg();
    // accept truthy enable from PHP bool / "yes" / 1
    var en = c.enable;
    var on =
      en === true ||
      en === 1 ||
      en === "1" ||
      en === "yes" ||
      en === "true" ||
      en === "on";
    var source = String(c.source || "local").toLowerCase();
    return on && (source === "local" || source === "navidrome" || source === "fnos");
  }

  function isDashboard() {
    try {
      // Strict: only real Unraid dashboard shell, not title/path false positives
      // (Settings pages etc. must NOT count as dashboard or sitewide path breaks).
      if (document.querySelector("table.dashboard, table.share_status.dashboard")) return true;
      var p = (location.pathname || "").toLowerCase().replace(/\/+$/, "") || "/";
      if (p === "/" || p === "/dashboard" || p === "/dashboard.htm" || p === "/dashboard.php") return true;
      // Unraid sometimes uses Main as home without table yet
      if (p === "/main" || p === "/main.htm") {
        if (document.querySelector("#db-box, #db_box, #dashboard, .grid-stack")) return true;
      }
    } catch (e) {}
    return false;
  }

  /**
   * MUSIC_RUN_MODE (preferred) / legacy MUSIC_DASH_ONLY:
   *  card → 仅仪表盘卡片（离开仪表盘停播）
   *  chip → 全站胶囊（仪表盘也不挂卡片）
   *  both → 仪表盘卡片 + 全站胶囊
   */
  function runMode() {
    var c = cfg();
    var m = String(c.run_mode || c.ui || "").toLowerCase();
    if (m === "card" || m === "chip" || m === "both") return m;
    // legacy: dash_only false → both (old sitewide = card + chip)
    var d = c.dash_only;
    if (d === false || d === 0 || d === "0" || d === "no" || d === "false" || d === "off") return "both";
    return "card";
  }

  function wantCardUi() {
    var m = runMode();
    return m === "card" || m === "both";
  }

  function isSitewidePlay() {
    var m = runMode();
    if (m === "chip" || m === "both") return true;
    return false;
  }

  function shouldShowCard() {
    return enabled() && isDashboard() && wantCardUi();
  }

  function shouldRunEngine() {
    if (!enabled()) return false;
    if (isDashboard()) return true;
    return isSitewidePlay();
  }

  function markPendingResume(on) {
    pendingResume = !!on;
    if (on) uiPlayStableUntil = Date.now() + 5000;
    else uiPlayStableUntil = 0;
  }

  function isUiPlaying() {
    return !!(audio && !audio.paused);
  }

  function writePlaySession(obj) {
    try {
      var payload = JSON.stringify(obj);
      try {
        sessionStorage.setItem(PLAY_KEY, payload);
      } catch (e0) {}
      try {
        localStorage.setItem(PLAY_KEY, payload);
      } catch (e1) {}
    } catch (e) {}
  }

  function savePlaySession(forcePlaying) {
    try {
      var t = current();
      var livePlaying = !!(audio && !audio.paused);
      if (livePlaying) resumeIntent = true;
      var playing = typeof forcePlaying === "boolean" ? forcePlaying : livePlaying;
      var id = t && t.id ? t.id : "";
      var curT = 0;
      if (pendingSeekTo > 0.5 && id) curT = pendingSeekTo;
      if (audio && isFinite(audio.currentTime) && audio.currentTime > 0.25) {
        if (!(pendingSeekTo > 1 && audio.currentTime < 0.35 && pendingSeekTo - audio.currentTime > 2)) {
          curT = audio.currentTime;
        }
      }
      var prev = null;
      try { prev = loadPlaySession(); } catch (ePrev) {}
      if (curT < 0.5 && prev && prev.id && id && prev.id === id && typeof prev.t === "number" && prev.t > 0.5) {
        curT = prev.t;
      }
      if (curT < 0.5 && prev && !id && typeof prev.t === "number" && prev.t > 0.5) {
        curT = prev.t;
        if (prev.id) id = prev.id;
      }
      var idx = state.index;
      if ((!state.tracks.length || idx < 0) && prev && typeof prev.index === "number") idx = prev.index;
      var payload = {
        playing: !!playing,
        intent: !!(resumeIntent || playing),
        index: idx,
        t: curT,
        id: id,
        vol: state.volume,
        sitewide: isSitewidePlay(),
        ts: Date.now(),
      };
      writePlaySession(payload);
    } catch (e) {}
  }

  /** Navigation flush: keep playing intent even if audio already tearing down. */
  function savePlaySessionForNav() {
    try {
      var now = Date.now();
      if (now - lastNavSave < 40) return;
      lastNavSave = now;
      var live = !!(audio && !audio.paused);
      if (live) resumeIntent = true;
      if (resumeIntent || live || state.playing) {
        savePlaySession(true);
      } else {
        savePlaySession(false);
      }
    } catch (e) {}
  }

  /**
   * Mobile tab swipe-away / background: pause live HTMLAudio so process does not
   * keep decoding after UI discard. Keep resumeIntent + session so Unraid full
   * navigations and tab return can still resume.
   */
  function pauseForBackground(reason) {
    try {
      // Cancel a play() promise that may resolve after visibility/pagehide.
      // The next visible page starts a fresh resume attempt.
      playAttemptToken++;
      clearPlayRetries();
      var live = !!(audio && !audio.paused);
      if (live) {
        resumeIntent = true;
        try {
          audio.pause();
        } catch (e0) {}
        state.playing = false;
      }
      if (resumeIntent || live || state.playing) {
        savePlaySession(false);
      } else {
        savePlaySession(false);
      }
      try {
        if (navigator.mediaSession) navigator.mediaSession.playbackState = "paused";
      } catch (e1) {}
      try {
        updatePlayBtn();
        syncSitewideChip();
        updateChipUi();
      } catch (e2) {}
    } catch (e) {}
  }

  function onDocumentHidden(reason) {
    try {
      savePlaySessionForNav();
      pauseForBackground(reason || "hidden");
    } catch (e) {}
  }

  function clearPlayRetries() {
    if (playRetryTimer) {
      try {
        clearTimeout(playRetryTimer);
      } catch (e0) {}
      playRetryTimer = null;
    }
    playRetryCount = 0;
  }

  /** Keep trying play() for a short window after navigation (best-effort vs autoplay policy). */
  function schedulePlayRetries(reason) {
    // Lifecycle and media callbacks can request recovery together. Preserve a
    // single retry owner instead of launching overlapping play() promises.
    if (autoplayPolicyBlocked || playRetryTimer || (pendingResume && playRetryCount > 0)) return;
    clearPlayRetries();
    playRetryCount = 0;
    markPendingResume(true);
    var delays = [120, 280, 500, 900, 1500, 2500, 4000];
    function tick() {
      try {
        if (document.visibilityState === "hidden" && !isSitewidePlay()) {
          clearPlayRetries();
          markPendingResume(false);
          return;
        }
      } catch (eVis) {}
      if (!audio) audio = ensureAudio();
      if (!audio) return;
      if (!audio.paused && !audioHasError(audio)) {
        clearPlayRetries();
        markPendingResume(false);
        gestureResumeWanted = false;
        state.playing = true;
        updatePlayBtn();
        syncSitewideChip();
        return;
      }
      if (!(resumeIntent || gestureResumeWanted || sessionWantsResume(loadPlaySession()))) {
        clearPlayRetries();
        markPendingResume(false);
        updatePlayBtn();
        return;
      }
      if (playRetryCount >= delays.length) {
        gestureResumeWanted = true;
        // Stop claiming in-progress resume for UI; audio is paused → play icon
        markPendingResume(false);
        clearPlayRetries();
        state.playing = false;
        bindGestureUnlock();
        updatePlayBtn();
        if (!isDashboard() && isSitewidePlay()) syncSitewideChip("点击播放以续播");
        return;
      }
      var wait = delays[playRetryCount++];
      playRetryTimer = setTimeout(function () {
        playRetryTimer = null;
        if (audio && !audio.paused && !audioHasError(audio)) {
          clearPlayRetries();
          return;
        }
        try {
          // Sticky demuxer error: rebuild before another doomed play()
          if (audioHasError(audio) || (audio && audio.error)) {
            var keep = pendingSeekTo > 0.5 ? pendingSeekTo : 0;
            if (keep > 12) keep = 0;
            hardResetAudio("retry-error");
            var tr = current();
            if (tr) {
              lastSrcId = tr.id;
              audio.src = trackUrl(tr.id);
              try {
                audio.load();
              } catch (eLd) {}
            }
            pendingSeekTo = keep;
          } else if (pendingSeekTo > 0.5 && audio && isFinite(audio.duration) && audio.duration > 0 && !audioHasError(audio)) {
            try {
              if (Math.abs((audio.currentTime || 0) - pendingSeekTo) > 1.25) {
                audio.currentTime = Math.min(pendingSeekTo, Math.max(0, audio.duration - 0.25));
              }
            } catch (eSeek) {
              pendingSeekTo = 0;
            }
          }
          tryPlayUnlocked(audio, function (playError) {
            if (isAutoplayPolicyError(playError)) {
              autoplayPolicyBlocked = true;
              clearPlayRetries();
              markPendingResume(false);
              gestureResumeWanted = true;
              state.playing = false;
              bindGestureUnlock();
              updatePlayBtn();
              if (isDashboard() && isCoarsePointer()) setStatus("点一下任意处可续播");
              else if (isSitewidePlay()) syncSitewideChip("点一下播放以续播");
              return;
            }
            tick();
          });
          setTimeout(function () {
            if (audio && audio.paused && playRetryCount > 0) {
              /* tick continues via onBlocked or next delay */
            }
          }, 40);
        } catch (e1) {
          tick();
        }
      }, wait);
    }
    tick();
  }

  function bindMediaSession() {
    try {
      if (!("mediaSession" in navigator)) return;
      navigator.mediaSession.setActionHandler("play", function () {
        resumeIntent = true;
        if (!tryResumeFromSession(true) && state.tracks.length) playAt(state.index, true);
      });
      navigator.mediaSession.setActionHandler("pause", function () {
        if (audio) audio.pause();
        resumeIntent = false;
        savePlaySession(false);
        updatePlayBtn();
      });
      navigator.mediaSession.setActionHandler("previoustrack", function () {
        prev();
      });
      navigator.mediaSession.setActionHandler("nexttrack", function () {
        next(false);
      });
    } catch (e0) {}
  }

  function updateMediaSessionMeta() {
    try {
      if (!("mediaSession" in navigator)) return;
      var t = current();
      var meta = {
        title: (t && t.title) || "ThemeMusic",
        artist: (t && t.artist) || "",
        album: (t && t.album) || "ThemeMusic",
      };
      if (state.cover && state.cover.url && state.cover.id === (t && t.id)) {
        meta.artwork = [
          { src: state.cover.url, sizes: "300x300", type: "image/jpeg" },
          { src: state.cover.url, sizes: "96x96", type: "image/jpeg" },
        ];
      }
      navigator.mediaSession.metadata = new MediaMetadata(meta);
      navigator.mediaSession.playbackState = isUiPlaying() ? "playing" : "paused";
    } catch (e0) {}
  }

  function bindNavFlush() {
    try {
      document.addEventListener(
        "click",
        function (ev) {
          if (!(resumeIntent || state.playing || isUiPlaying())) return;
          var el = ev.target;
          var hops = 0;
          while (el && hops++ < 6) {
            if (el.tagName === "A" && el.getAttribute && el.getAttribute("href")) {
              var href = el.getAttribute("href") || "";
              if (href && href.charAt(0) !== "#" && href.indexOf("javascript:") !== 0) {
                savePlaySessionForNav();
              }
              break;
            }
            el = el.parentNode;
          }
        },
        true
      );
    } catch (e0) {}
  }

  function parsePlaySession(raw) {
    if (!raw) return null;
    try {
      var o = JSON.parse(raw);
      if (!o || typeof o !== "object") return null;
      if (typeof o.ts === "number" && Date.now() - o.ts > PLAY_TTL_MS) return null;
      return o;
    } catch (e) {
      return null;
    }
  }

  function loadPlaySession() {
    var a = null;
    var b = null;
    try {
      a = parsePlaySession(sessionStorage.getItem(PLAY_KEY));
    } catch (e0) {}
    try {
      b = parsePlaySession(localStorage.getItem(PLAY_KEY));
    } catch (e1) {}
    if (a && b) return (a.ts || 0) >= (b.ts || 0) ? a : b;
    return a || b;
  }

  function clearPlaySession() {
    try {
      sessionStorage.removeItem(PLAY_KEY);
    } catch (e0) {}
    try {
      localStorage.removeItem(PLAY_KEY);
    } catch (e1) {}
  }

  function schedulePlayPersist() {
    if (playPersistTimer) return;
    playPersistTimer = setTimeout(function () {
      playPersistTimer = null;
      savePlaySession();
    }, 600);
  }

  function stopEngine(clearSession) {
    playAttemptToken++;
    markPendingResume(false);
    clearPlayRetries();
    if (audio) {
      try {
        audio.pause();
      } catch (e0) {}
    }
    state.playing = false;
    updatePlayBtn();
    // Sitewide keeps chip; only hide when fully stopping sitewide session
    if (clearSession || !isSitewidePlay()) hideResumeChip();
    if (clearSession) {
      resumeIntent = false;
      gestureResumeWanted = false;
      clearPlaySession();
    } else {
      savePlaySession(false);
    }
  }

  function hideCardUi() {
    if (root) {
      try {
        root.classList.add("ucwc-music-hidden");
        if (root.parentNode) root.parentNode.removeChild(root);
      } catch (e0) {}
    }
    var host = document.getElementById("ucwc-music-dash-host");
    if (host) {
      try {
        if (host.parentNode) host.parentNode.removeChild(host);
      } catch (e1) {}
    }
    // Detached card must not keep els bindings (onTime would paint a dead tree).
    root = null;
    els = {};
    stopUiSyncTimer();
  }

  /** True when card DOM is still live in the current document (Unraid full reloads wipe body). */
  function cardDomLive() {
    try {
      return !!(root && root.isConnected && document.body && document.body.contains(root));
    } catch (e0) {
      return false;
    }
  }

  /**
   * After full page navigation the in-memory `root`/`els` may point at a detached tree
   * while a new empty card was never built (buildUi early-returns on truthy root).
   * Drop dead refs so mount() can rebuild and rebind time/play controls to live audio.
   */
  function ensureLiveCardRefs() {
    if (!root) {
      // Orphan card left in DOM from a previous partial paint — remove so we own one tree.
      try {
        var orphan = document.getElementById("ucwc-music-card");
        if (orphan && orphan.parentNode) orphan.parentNode.removeChild(orphan);
        var ohost = document.getElementById("ucwc-music-dash-host");
        if (ohost && ohost.parentNode && !ohost.querySelector("#ucwc-music-card")) {
          ohost.parentNode.removeChild(ohost);
        }
      } catch (eOr) {}
      return false;
    }
    if (cardDomLive()) {
      // Re-bind els if individual nodes were replaced under the same root id.
      if (!els.cur || !els.cur.isConnected || !els.play || !els.play.isConnected) {
        rebindCardEls();
      }
      return true;
    }
    /*
     * Unraid may replace/clone the card subtree during sortable/dashboard paint.
     * Adopt the live replacement instead of appending a second card beside it.
     * DOM attributes survive cloneNode(), listener registrations do not, so
     * rebindCardEls() also restores per-card drag guards.
     */
    try {
      var replacement = document.getElementById("ucwc-music-card");
      if (replacement && replacement !== root && replacement.isConnected) {
        root = replacement;
        els = {};
        rebindCardEls();
        startUiSyncTimer();
        return true;
      }
    } catch (eAdopt) {}
    try {
      if (dashMo) {
        try {
          dashMo.disconnect();
        } catch (eD) {}
        dashMo = null;
      }
    } catch (e0) {}
    root = null;
    els = {};
    stopUiSyncTimer();
    return false;
  }

  /** Refresh els.* from the live card root (after rebuild or partial DOM replace). */
  function rebindCardEls() {
    if (!root || !root.isConnected) return false;
    try {
      els.art = root.querySelector(".ucwc-music-art");
      els.title = root.querySelector(".ucwc-music-title");
      els.sub = root.querySelector(".ucwc-music-sub");
      els.cur = root.querySelector(".ucwc-music-time.cur");
      els.dur = root.querySelector(".ucwc-music-time.end");
      els.seek = root.querySelector(".ucwc-music-seek");
      els.play = root.querySelector(".ucwc-music-btn.play");
      els.prev = root.querySelector(".ucwc-music-btn.prev");
      els.next = root.querySelector(".ucwc-music-btn.next");
      els.shuffle = root.querySelector(".ucwc-music-btn.shuffle");
      els.repeat = root.querySelector(".ucwc-music-btn.repeat");
      els.listBtn = root.querySelector(".ucwc-music-btn.list");
      els.vol = root.querySelector(".ucwc-music-vol input");
      els.statusRow = root.querySelector(".ucwc-music-status-row");
      els.status = root.querySelector(".ucwc-music-status");
      els.infoBtn = root.querySelector(".ucwc-music-info-btn");
      els.sourceLabel = root.querySelector(".ucwc-music-source-label");
      els.infoPop = root.querySelector(".ucwc-music-info-panel");
      els.list = root.querySelector(".ucwc-music-list");
      els.lyricsScroll = root.querySelector(".ucwc-music-lyrics-scroll");
      els.lyricsHint = root.querySelector(".ucwc-music-lyrics-hint");
      els.sideLabel = root.querySelector(".ucwc-music-side-label");
      els.sideSearch = root.querySelector(".ucwc-music-side-search");
      els.sideSearchWrap = root.querySelector(".ucwc-music-side-search-wrap");
      els.sideRescan = root.querySelector(".ucwc-music-side-btn.rescan");
      els.sideSort = root.querySelector(".ucwc-music-side-btn.sort");
      els.sideLyricRefetch = root.querySelector(".ucwc-music-side-btn.lyric-refetch");
      els.sideLyricEarlier = root.querySelector(".ucwc-music-side-btn.lyric-earlier");
      els.sideLyricOffset = root.querySelector(".ucwc-music-side-btn.lyric-offset");
      els.sideLyricLater = root.querySelector(".ucwc-music-side-btn.lyric-later");
      els.sideFilterCount = root.querySelector(".ucwc-music-side-filter-count");
      bindStableCardActions();
      bindCardDragGuards(root);
      bindNativeDashboardControls(root);
      return !!(els.cur && els.play);
    } catch (e0) {
      return false;
    }
  }

  var uiSyncTimer = null;
  function stopUiSyncTimer() {
    if (uiSyncTimer) {
      try {
        clearInterval(uiSyncTimer);
      } catch (e0) {}
      uiSyncTimer = null;
    }
  }
  /**
   * Cross-page FLAC/SMB resume often yields play() success with duration=0 / currentTime=0 forever.
   * Detect and hard-reset from 0 so the card clock and real audio recover.
   */
  function recoverStalledPlayback(reason) {
    if (!audio || !state.tracks.length) return false;
    if (!(resumeIntent || gestureResumeWanted || (audio && !audio.paused))) return false;
    // A paused element blocked by autoplay policy is waiting for a gesture,
    // not stalled. Rebuilding it here caused an endless pause/play loop.
    if (audio.paused) {
      stallZeroSince = 0;
      return false;
    }
    var now = Date.now();
    if (now - stallRecoverAt < 2500) return false;
    var cur = audio.currentTime || 0;
    var dur = audio.duration || 0;
    var mediaError = audioHasError(audio);
    var networkFailed = false;
    try {
      networkFailed = audio.networkState === 3 && !!audio.error;
    } catch (eNetwork) {}
    // A remote stream can legitimately remain at readyState=0 while the
    // browser opens the connection. Only recover after an explicit media or
    // network error; otherwise this watchdog deletes a healthy stream URL.
    if (!mediaError && !networkFailed) {
      stallZeroSince = 0;
      return false;
    }
    if (!stallZeroSince) stallZeroSince = now;
    if (now - stallZeroSince < 1600) return false;
    stallRecoverAt = now;
    stallZeroSince = 0;
    try {
      setStatus(isCoarsePointer() ? "恢复播放中…" : "音轨恢复中…");
    } catch (eS) {}
    pendingSeekTo = 0;
    resumeLockId = "";
    var idx = state.index;
    try {
      hardResetAudio("stall:" + (reason || "watch"));
      primeAudioTrack(idx, 0);
      playAt(idx, true, 0);
    } catch (eR) {
      return false;
    }
    return true;
  }

  /** Keep card progress/buttons in sync even if a timeupdate is missed after remount. */
  function startUiSyncTimer() {
    stopUiSyncTimer();
    if (!shouldShowCard()) return;
    uiSyncTimer = setInterval(function () {
      try {
        if (!shouldShowCard()) {
          stopUiSyncTimer();
          return;
        }
        // Always recover detached card refs (Unraid full/partial content replace)
        if (!cardDomLive()) {
          ensureLiveCardRefs();
          if (shouldShowCard() && !root) {
            try {
              buildUi();
              rebindCardEls();
              placeInDashboard(root);
              updateMeta();
              renderList();
            } catch (eB) {}
          }
        }
        if (audio) {
          // Never let a stuck seeking flag freeze the clock for long
          if (seeking && seekingSince && Date.now() - seekingSince > 1200) {
            seeking = false;
            seekingSince = 0;
          }
          recoverStalledPlayback("ui-sync");
          var cur = audio.currentTime || 0;
          var dur = audio.duration || 0;
          paintProgressTo(document.getElementById("ucwc-music-card") || root, cur, dur);
          updatePlayBtn();
        }
      } catch (e1) {}
    }, 400);
  }

  function hideResumeChip() {
    if (!chip) return;
    try {
      if (chip.parentNode) chip.parentNode.removeChild(chip);
    } catch (e0) {}
  }

  /** Sitewide: chip always visible (dashboard + other pages); card and chip stay in sync. */
  function syncSitewideChip(hint) {
    if (!enabled() || !isSitewidePlay()) {
      hideResumeChip();
      return;
    }
    showResumeChip(hint || "");
  }

  function loadChipPos() {
    try {
      var raw = localStorage.getItem(CHIP_POS_KEY);
      if (!raw) return null;
      var o = JSON.parse(raw);
      if (!o || typeof o.x !== "number" || typeof o.y !== "number") return null;
      return o;
    } catch (e0) {
      return null;
    }
  }

  function saveChipPos(x, y) {
    try {
      localStorage.setItem(CHIP_POS_KEY, JSON.stringify({ x: x, y: y }));
    } catch (e0) {}
  }

  function setChipXY(x, y) {
    if (!chip) return;
    var w = chip.offsetWidth || 280;
    var h = chip.offsetHeight || 56;
    var maxX = Math.max(8, (window.innerWidth || 800) - w - 8);
    var maxY = Math.max(8, (window.innerHeight || 600) - h - 8);
    x = Math.min(maxX, Math.max(8, Number(x) || 8));
    y = Math.min(maxY, Math.max(8, Number(y) || 8));
    // Anchor top-left + transform so Unraid CSS cannot pin right/bottom
    try {
      chip.style.setProperty("left", "0px", "important");
      chip.style.setProperty("top", "0px", "important");
      chip.style.setProperty("right", "auto", "important");
      chip.style.setProperty("bottom", "auto", "important");
      chip.style.setProperty("transform", "translate3d(" + x + "px," + y + "px,0)", "important");
      chip.style.setProperty("will-change", "transform");
    } catch (e0) {
      chip.style.left = "0px";
      chip.style.top = "0px";
      chip.style.right = "auto";
      chip.style.bottom = "auto";
      chip.style.transform = "translate3d(" + x + "px," + y + "px,0)";
    }
    chip.setAttribute("data-ucwc-x", String(Math.round(x)));
    chip.setAttribute("data-ucwc-y", String(Math.round(y)));
    return { x: x, y: y };
  }

  function clearChipXY() {
    if (!chip) return;
    // Prefer transform-space default (bottom-right) so fixed positioning
    // is independent of Unraid/theme right/bottom quirks and IAB viewports.
    try {
      var w = chip.offsetWidth || 300;
      var h = chip.offsetHeight || 56;
      var vw = window.innerWidth || document.documentElement.clientWidth || 800;
      var vh = window.innerHeight || document.documentElement.clientHeight || 600;
      var x = Math.max(8, vw - w - 18);
      var y = Math.max(8, vh - h - 18);
      setChipXY(x, y);
      // Do not persist default — only user-dragged positions are saved.
      chip.removeAttribute("data-ucwc-x");
      chip.removeAttribute("data-ucwc-y");
      return;
    } catch (eDef) {}
    try {
      chip.style.removeProperty("transform");
      chip.style.removeProperty("will-change");
      chip.style.removeProperty("left");
      chip.style.removeProperty("top");
      chip.style.setProperty("right", "18px", "important");
      chip.style.setProperty("bottom", "18px", "important");
    } catch (e0) {
      chip.style.transform = "";
      chip.style.left = "";
      chip.style.top = "";
      chip.style.right = "18px";
      chip.style.bottom = "18px";
    }
    chip.removeAttribute("data-ucwc-x");
    chip.removeAttribute("data-ucwc-y");
  }

  function applyChipPos() {
    if (!chip) return;
    var pos = loadChipPos();
    if (!pos) {
      // default: bottom-right via transform (not CSS right/bottom alone)
      clearChipXY();
      return;
    }
    setChipXY(pos.x, pos.y);
  }

  function bindChipDrag() {
    if (!chip || chip._ucwcDragBound) return;
    chip._ucwcDragBound = true;
    var onMove = function (ev) {
      if (!chipDrag.on || !chip) return;
      var pt = ev.touches && ev.touches[0] ? ev.touches[0] : ev;
      if (!pt || typeof pt.clientX !== "number") return;
      var dx = pt.clientX - chipDrag.sx;
      var dy = pt.clientY - chipDrag.sy;
      if (Math.abs(dx) + Math.abs(dy) > 2) chipDrag.moved = true;
      setChipXY(chipDrag.ox + dx, chipDrag.oy + dy);
      try {
        if (ev.cancelable) ev.preventDefault();
        ev.stopPropagation();
      } catch (eP) {}
    };
    var onUp = function (ev) {
      if (!chipDrag.on) return;
      chipDrag.on = false;
      if (chip) chip.classList.remove("ucwc-music-chip-dragging");
      try {
        document.removeEventListener("pointermove", onMove, true);
        document.removeEventListener("pointerup", onUp, true);
        document.removeEventListener("pointercancel", onUp, true);
        document.removeEventListener("mousemove", onMove, true);
        document.removeEventListener("mouseup", onUp, true);
        document.removeEventListener("touchmove", onMove, true);
        document.removeEventListener("touchend", onUp, true);
      } catch (e0) {}
      if (chip && chipDrag.moved) {
        var x = parseFloat(chip.getAttribute("data-ucwc-x") || "");
        var y = parseFloat(chip.getAttribute("data-ucwc-y") || "");
        if (!isFinite(x) || !isFinite(y)) {
          var r = chip.getBoundingClientRect();
          x = r.left;
          y = r.top;
        }
        saveChipPos(x, y);
      }
      setTimeout(function () {
        chipDrag.moved = false;
      }, 60);
    };
    function startDrag(ev) {
      if (ev.button != null && ev.button !== 0) return;
      var t = ev.target;
      if (t && t.closest && t.closest("button, .ucwc-music-chip-btn, a, input")) return;
      chipDrag.on = true;
      chipDrag.moved = false;
      var pt = ev.touches && ev.touches[0] ? ev.touches[0] : ev;
      chipDrag.sx = pt.clientX;
      chipDrag.sy = pt.clientY;
      var ox = parseFloat(chip.getAttribute("data-ucwc-x") || "");
      var oy = parseFloat(chip.getAttribute("data-ucwc-y") || "");
      if (!isFinite(ox) || !isFinite(oy)) {
        var r = chip.getBoundingClientRect();
        ox = r.left;
        oy = r.top;
      }
      chipDrag.ox = ox;
      chipDrag.oy = oy;
      // lock current pos into transform space immediately
      setChipXY(ox, oy);
      chip.classList.add("ucwc-music-chip-dragging");
      try {
        if (ev.pointerId != null && chip.setPointerCapture) chip.setPointerCapture(ev.pointerId);
      } catch (eC) {}
      try {
        document.addEventListener("pointermove", onMove, true);
        document.addEventListener("pointerup", onUp, true);
        document.addEventListener("pointercancel", onUp, true);
        document.addEventListener("mousemove", onMove, true);
        document.addEventListener("mouseup", onUp, true);
        document.addEventListener("touchmove", onMove, { capture: true, passive: false });
        document.addEventListener("touchend", onUp, true);
      } catch (e1) {}
      try {
        if (ev.cancelable && ev.type === "touchstart") ev.preventDefault();
      } catch (e2) {}
    }
    chip.addEventListener("pointerdown", startDrag, true);
    chip.addEventListener("mousedown", startDrag, true);
    chip.addEventListener("touchstart", startDrag, { capture: true, passive: false });
  }

  function activeLyricText() {
    var lines = state.lyrics && state.lyrics.lines;
    if (!lines || !lines.length) return "";
    var idx = state.lyrics.active;
    if (idx < 0 || idx >= lines.length) {
      if (audio && isFinite(audio.currentTime)) {
        idx = findLyricIndex(lyricClockMs());
      }
    }
    if (idx < 0 || idx >= lines.length) return "";
    return lines[idx].text || "";
  }

  function updateChipUi() {
    if (!chip) return;
    var t = current();
    var name = (t && t.title) || "音乐";
    var sess = loadPlaySession();
    if ((!t || !t.title) && sess && sess.id && state.tracks.length) {
      for (var i = 0; i < state.tracks.length; i++) {
        if (state.tracks[i] && state.tracks[i].id === sess.id) {
          name = state.tracks[i].title || name;
          break;
        }
      }
    }
    if (chipEls.title) chipEls.title.textContent = name;
    if (chipEls.lrc) {
      var line = activeLyricText();
      if (line) chipEls.lrc.textContent = line;
      else if (isUiPlaying()) chipEls.lrc.textContent = "♪ 播放中";
      else if (pendingResume && playRetryCount > 0) chipEls.lrc.textContent = "尝试续播…";
      else if (resumeIntent || gestureResumeWanted) chipEls.lrc.textContent = "已暂停 · 点击播放";
      else chipEls.lrc.textContent = "点击播放续播";
    }
    if (chipEls.play) {
      var playingChip = isUiPlaying();
      chipEls.play.innerHTML = playingChip ? svgIcon("pause") : svgIcon("play");
      chipEls.play.title = playingChip ? "暂停" : "播放";
      chipEls.play.setAttribute("aria-label", chipEls.play.title);
      chipEls.play.classList.toggle("is-playing", playingChip);
      chipEls.play.classList.toggle("is-paused", !playingChip);
    }
  }

  function showResumeChip(label) {
    // Sitewide: chip always visible (dashboard + other pages). Card and chip stay in sync.
    if (!enabled() || !isSitewidePlay()) {
      if (chip && chip.parentNode) {
        try {
          chip.parentNode.removeChild(chip);
        } catch (eH) {}
      }
      return;
    }
    // Always keep chip when sitewide engine runs
    if (!chip) {
      chip = document.createElement("div");
      chip.id = "ucwc-music-resume-chip";
      chip.className = "ucwc-music-resume-chip";
      chip.setAttribute("role", "region");
      chip.setAttribute("aria-label", "全站音乐控制");
      chip.innerHTML =
        '<div class="ucwc-music-chip-row">' +
        '  <span class="ucwc-music-chip-handle" title="拖动" aria-hidden="true">⋮⋮</span>' +
        '  <span class="ucwc-music-chip-ico" aria-hidden="true">♪</span>' +
        '  <div class="ucwc-music-chip-meta">' +
        '    <div class="ucwc-music-chip-title"></div>' +
        '    <div class="ucwc-music-chip-lrc"></div>' +
        "  </div>" +
        '  <div class="ucwc-music-chip-btns">' +
        '    <button type="button" class="ucwc-music-chip-btn prev" title="上一首" aria-label="上一首"></button>' +
        '    <button type="button" class="ucwc-music-chip-btn primary play" title="播放" aria-label="播放"></button>' +
        '    <button type="button" class="ucwc-music-chip-btn next" title="下一首" aria-label="下一首"></button>' +
        "  </div>" +
        "</div>";
      chipEls.title = chip.querySelector(".ucwc-music-chip-title");
      chipEls.lrc = chip.querySelector(".ucwc-music-chip-lrc");
      chipEls.prev = chip.querySelector(".ucwc-music-chip-btn.prev");
      chipEls.play = chip.querySelector(".ucwc-music-chip-btn.play");
      chipEls.next = chip.querySelector(".ucwc-music-chip-btn.next");
      if (chipEls.prev) {
        chipEls.prev.innerHTML = svgIcon("prev");
        chipEls.prev.addEventListener("click", function (ev) {
          if (chipDrag.moved) return;
          runTransportAction("prev", ev);
        });
      }
      if (chipEls.next) {
        chipEls.next.innerHTML = svgIcon("next");
        chipEls.next.addEventListener("click", function (ev) {
          if (chipDrag.moved) return;
          runTransportAction("next", ev);
        });
      }
      if (chipEls.play) {
        chipEls.play.innerHTML = svgIcon("play");
        chipEls.play.addEventListener("click", function (ev) {
          if (chipDrag.moved) return;
          gestureResumeWanted = true;
          resumeIntent = true;
          runTransportAction("play", ev);
        });
      }
      bindChipDrag();
      // Bubble only: stop Unraid nav AFTER chip button handlers run.
      // Capture-phase stopPropagation would swallow play/prev/next clicks.
      chip.addEventListener("click", function (ev) {
        try {
          ev.preventDefault();
          ev.stopPropagation();
        } catch (eNav) {}
      });
      chip.setAttribute("data-ucwc-chip-no-nav", "1");
    }
    try {
      // Prefer body; fall back to html. Keep chip outside Unraid #template overflow.
      var hostEl = document.body || document.documentElement;
      if (chip.parentNode !== hostEl) hostEl.appendChild(chip);
    } catch (e1) {
      return;
    }
    // Inline critical geometry so theme/Unraid CSS cannot zero-size or un-fix the chip.
    // z-index above ThemeEffects mouse canvas (2147483000) so chip stays on top.
    try {
      chip.style.setProperty("position", "fixed", "important");
      chip.style.setProperty("z-index", "2147483646", "important");
      chip.style.setProperty("display", "flex", "important");
      chip.style.setProperty("flex-direction", "column", "important");
      chip.style.setProperty("visibility", "visible", "important");
      chip.style.setProperty("opacity", "1", "important");
      chip.style.setProperty("pointer-events", "auto", "important");
      chip.style.setProperty("width", "min(340px, calc(100vw - 24px))", "important");
      chip.style.setProperty("min-width", "min(280px, calc(100vw - 24px))", "important");
      chip.style.setProperty("max-width", "min(340px, calc(100vw - 24px))", "important");
      chip.style.setProperty("min-height", "56px", "important");
      chip.style.setProperty("height", "auto", "important");
      chip.style.setProperty("box-sizing", "border-box", "important");
      chip.style.setProperty("padding", "10px 12px", "important");
      chip.style.setProperty("margin", "0", "important");
      chip.style.setProperty("border-radius", "16px", "important");
      chip.style.setProperty("border", "2px solid rgba(0, 243, 255, 0.85)", "important");
      chip.style.setProperty("background", "rgba(8, 14, 28, 0.98)", "important");
      chip.style.setProperty("color", "#eef6ff", "important");
      chip.style.setProperty(
        "box-shadow",
        "0 12px 36px rgba(0,0,0,0.65), 0 0 0 1px rgba(0,243,255,0.25), 0 0 24px rgba(0,243,255,0.35)",
        "important"
      );
      chip.style.setProperty("overflow", "visible", "important");
      chip.style.setProperty("clip", "auto", "important");
      chip.style.setProperty("clip-path", "none", "important");
      chip.style.setProperty("filter", "none", "important");
      chip.style.setProperty("mix-blend-mode", "normal", "important");
      chip.style.setProperty("isolation", "isolate", "important");
      chip.style.setProperty("contain", "none", "important");
      chip.style.setProperty("inset", "auto", "important");
      chip.style.setProperty("backdrop-filter", "blur(12px)", "important");
      chip.style.setProperty("-webkit-backdrop-filter", "blur(12px)", "important");
    } catch (eStyle) {}
    // Keep chip as last child of body so equal z-index overlays (TE mouse) cannot cover it.
    try {
      var hostNow = document.body || document.documentElement;
      if (hostNow && chip.parentNode === hostNow) hostNow.appendChild(chip);
    } catch (eRe) {}
    applyChipPos();
    // Re-apply default/saved pos after layout so width/height are known.
    try {
      if (window.requestAnimationFrame) {
        window.requestAnimationFrame(function () {
          try {
            var h2 = document.body || document.documentElement;
            if (h2 && chip && chip.parentNode === h2) h2.appendChild(chip);
          } catch (eR2) {}
          applyChipPos();
        });
      } else {
        setTimeout(function () {
          applyChipPos();
        }, 0);
      }
      // Late reassert after ThemeEffects loaders/canvas mount.
      setTimeout(function () {
        if (!chip || !chip.parentNode) return;
        try {
          var h3 = document.body || document.documentElement;
          if (h3) h3.appendChild(chip);
          chip.style.setProperty("z-index", "2147483646", "important");
        } catch (eR3) {}
        applyChipPos();
        updateChipUi();
      }, 400);
    } catch (ePos) {}
    updateChipUi();
    if (label && chipEls.lrc && !(audio && !audio.paused)) {
      // soft hint only when not already playing
      if (!activeLyricText()) chipEls.lrc.textContent = label;
    }
  }

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function isCoarsePointer() {
    try {
      if (window.matchMedia && window.matchMedia("(pointer: coarse)").matches) return true;
      if (window.matchMedia && window.matchMedia("(hover: none)").matches) return true;
    } catch (e0) {}
    try {
      return (navigator.maxTouchPoints || 0) > 0 || "ontouchstart" in window;
    } catch (e1) {
      return false;
    }
  }

  /** Best-effort WebAudio + HTMLAudio unlock while still inside a user gesture. */
  function unlockMediaPipeline() {
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (AC) {
        if (!unlockCtx) unlockCtx = new AC();
        if (unlockCtx.state === "suspended") unlockCtx.resume();
        // tiny silent buffer kick — establishes media engagement on some WebViews
        var buf = unlockCtx.createBuffer(1, 1, 22050);
        var src = unlockCtx.createBufferSource();
        src.buffer = buf;
        src.connect(unlockCtx.destination);
        if (typeof src.start === "function") src.start(0);
        else if (typeof src.noteOn === "function") src.noteOn(0);
      }
    } catch (eAc) {}
    try {
      var a = ensureAudio();
      // Synchronous play() inside gesture is what mobile actually honors.
      if (a && a.paused && a.src) {
        var p = a.play();
        if (p && typeof p.then === "function") {
          p.then(function () {
            mediaUnlocked = true;
            try {
              if (a.muted) a.muted = false;
              a.volume = state.volume;
            } catch (e0) {}
          }).catch(function () {});
        } else if (a && !a.paused) {
          mediaUnlocked = true;
        }
      }
    } catch (eHtml) {}
  }

  /**
   * Prepare audio element for a track WITHOUT requiring play success.
   * Used so the next user gesture can call play() synchronously (mobile policy).
   */
  function primeAudioTrack(idx, startAt) {
    if (!state.tracks.length) return null;
    state.index = ((idx % state.tracks.length) + state.tracks.length) % state.tracks.length;
    var t = current();
    if (!t) return null;
    var a = ensureAudio();
    var seekTo = typeof startAt === "number" && isFinite(startAt) && startAt > 0 ? startAt : 0;
    if (seekTo > 0.5) pendingSeekTo = seekTo;
    if (lastSrcId !== t.id || !a.src) {
      lastSrcId = t.id;
      try {
        a.src = trackUrl(t.id);
        a.load();
      } catch (eL) {}
    }
    function applySeek() {
      var target = pendingSeekTo > 0.5 ? pendingSeekTo : seekTo;
      if (!(target > 0.25)) return;
      try {
        if (isFinite(a.duration) && a.duration > 0) {
          a.currentTime = Math.min(target, Math.max(0, a.duration - 0.25));
        } else {
          a.currentTime = target;
        }
      } catch (eS) {}
    }
    try {
      a.addEventListener("loadedmetadata", applySeek, { once: true });
      a.addEventListener("canplay", applySeek, { once: true });
    } catch (eE) {
      setTimeout(applySeek, 80);
    }
    updateMeta();
    return a;
  }

  /** Mobile Safari/Chrome: any user gesture can unlock autoplay after a blocked play().
   * Critical: call HTMLMediaElement.play() SYNCHRONOUSLY in the gesture handler.
   * Waiting for canplay (async) loses the user-activation token on real mobile. */
  function bindGestureUnlock() {
    if (gestureBound) return;
    gestureBound = true;
    var unlocking = false;
    var tryUnlock = function (ev) {
      try {
        if (!enabled() || !shouldRunEngine()) return;
        if (isSitewidePlay()) return;
        if (!isSitewidePlay() && !isDashboard()) return;
        // Card/chip controls own their user activation. Let their transport
        // handler call play() synchronously instead of pre-playing here and
        // making the following click appear to need a second/third press.
        var eventTarget = ev && ev.target;
        if (
          eventTarget &&
          eventTarget.closest &&
          eventTarget.closest(
            "#ucwc-music-card button, #ucwc-music-card input, #ucwc-music-card .ucwc-music-item, " +
              "#ucwc-music-resume-chip button"
          )
        ) return;
        if (audio && !audio.paused) {
          gestureResumeWanted = false;
          mediaUnlocked = true;
          return;
        }
        var sess = loadPlaySession();
        var want =
          gestureResumeWanted ||
          resumeIntent ||
          pendingResume ||
          sessionWantsResume(sess) ||
          !!(cfg().autoplay && isDashboard());
        if (!want) return;
        // Ignore pure scroll / drag chrome; accept real taps
        if (ev && ev.type === "touchmove") return;
        if (ev && ev.type === "pointermove") return;
        if (unlocking) return;
        unlocking = true;
        autoplayPolicyBlocked = false;
        gestureResumeWanted = false;
        resumeIntent = true;
        markPendingResume(true);

        // 1) Unlock audio pipeline while still in the gesture stack
        unlockMediaPipeline();

        var a = ensureAudio();
        var idx = state.index;
        var tSeek = pendingSeekTo > 0.5 ? pendingSeekTo : 0;
        if (sess) {
          idx = resolveSessionIndex(sess);
          if (typeof sess.t === "number" && sess.t > 0.5) tSeek = sess.t;
        }
        // 2) Ensure src is set BEFORE play() so the gesture-tied play() has a resource
        if (!a.src || lastSrcId !== (state.tracks[idx] && state.tracks[idx].id)) {
          primeAudioTrack(idx, tSeek);
          a = ensureAudio();
        } else if (tSeek > 0.5) {
          try {
            if (isFinite(a.duration) && a.duration > 0 && Math.abs((a.currentTime || 0) - tSeek) > 1) {
              a.currentTime = Math.min(tSeek, a.duration - 0.25);
            }
          } catch (eSeek) {}
        }

        // 3) SYNCHRONOUS play() — do not defer to canplay
        var played = false;
        try {
          a.muted = false;
          a.volume = state.volume;
          var p0 = a.play();
          if (p0 && typeof p0.then === "function") {
            p0
              .then(function () {
                mediaUnlocked = true;
                played = true;
                clearPlayRetries();
                markPendingResume(false);
                gestureResumeWanted = false;
                state.playing = true;
                state.index = idx;
                updatePlayBtn();
                savePlaySession(true);
                syncSitewideChip();
                updateChipUi();
              })
              .catch(function () {
                // muted kick then unmute (still chained from gesture in most engines)
                try {
                  a.muted = true;
                  var p1 = a.play();
                  if (p1 && typeof p1.then === "function") {
                    p1
                      .then(function () {
                        try {
                          a.muted = false;
                          a.volume = state.volume;
                        } catch (eU) {}
                        mediaUnlocked = true;
                        markPendingResume(false);
                        state.playing = true;
                        updatePlayBtn();
                        savePlaySession(true);
                        syncSitewideChip();
                      })
                      .catch(function () {
                        gestureResumeWanted = true;
                        schedulePlayRetries("gesture-block");
                      });
                  }
                } catch (eM) {
                  gestureResumeWanted = true;
                  schedulePlayRetries("gesture-block");
                }
              });
          } else if (a && !a.paused) {
            mediaUnlocked = true;
            played = true;
            markPendingResume(false);
            state.playing = true;
            updatePlayBtn();
            savePlaySession(true);
          }
        } catch (ePlay) {
          played = false;
        }

        // 4) Also run full resume path (seek/meta) — play may already be running
        try {
          if (!played) tryResumeFromSession(true);
        } catch (eR) {}

        setTimeout(function () {
          unlocking = false;
          if (audio && audio.paused && (resumeIntent || sessionWantsResume(loadPlaySession()))) {
            gestureResumeWanted = true;
            schedulePlayRetries("gesture");
            if (isCoarsePointer()) {
              if (isDashboard()) setStatus("点一下屏幕任意处开始播放");
              else syncSitewideChip("点播放或点屏幕续播");
            }
          }
        }, 120);
      } catch (eU) {
        unlocking = false;
      }
    };
    var opts = { capture: true, passive: true };
    try {
      document.addEventListener("pointerdown", tryUnlock, opts);
      document.addEventListener("touchstart", tryUnlock, opts);
      document.addEventListener("touchend", tryUnlock, opts);
      document.addEventListener("click", tryUnlock, opts);
      document.addEventListener("keydown", tryUnlock, opts);
    } catch (e0) {}
  }

  function svgIcon(name) {
    var common =
      ' xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
    if (name === "play") {
      return '<svg' + common + '><polygon points="6 4 20 12 6 20 6 4" fill="currentColor" stroke="none"/></svg>';
    }
    if (name === "pause") {
      return (
        '<svg' +
        common +
        '><rect x="6" y="5" width="4" height="14" fill="currentColor" stroke="none"/>' +
        '<rect x="14" y="5" width="4" height="14" fill="currentColor" stroke="none"/></svg>'
      );
    }
    if (name === "prev") {
      return (
        '<svg' +
        common +
        '><polygon points="19 20 9 12 19 4 19 20" fill="currentColor" stroke="none"/>' +
        '<line x1="5" y1="4" x2="5" y2="20"/></svg>'
      );
    }
    if (name === "next") {
      return (
        '<svg' +
        common +
        '><polygon points="5 4 15 12 5 20 5 4" fill="currentColor" stroke="none"/>' +
        '<line x1="19" y1="4" x2="19" y2="20"/></svg>'
      );
    }
    if (name === "shuffle") {
      return (
        '<svg' +
        common +
        '><polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/>' +
        '<polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/>' +
        '<line x1="4" y1="4" x2="9" y2="9"/></svg>'
      );
    }
    if (name === "repeat") {
      return (
        '<svg' +
        common +
        '><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/>' +
        '<polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>'
      );
    }
    if (name === "repeat-one") {
      return (
        '<svg' +
        common +
        '><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/>' +
        '<polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>' +
        '<path d="M12 9v6"/><path d="M10.5 10.5 12 9"/></svg>'
      );
    }
    if (name === "repeat-off") {
      return (
        '<svg' +
        common +
        '><polyline points="17 1 21 5 17 9"/><path d="M5.5 5.5H21"/>' +
        '<polyline points="7 23 3 19 7 15"/><path d="M3 19h14a4 4 0 0 0 4-4v-2"/>' +
        '<line x1="4" y1="3" x2="20" y2="21" stroke-width="2.5"/></svg>'
      );
    }
    if (name === "list") {
      return (
        '<svg' +
        common +
        '><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/>' +
        '<line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/>' +
        '<line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>'
      );
    }
    if (name === "lyrics") {
      return (
        '<svg' +
        common +
        '><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3" fill="currentColor" stroke="none"/>' +
        '<circle cx="18" cy="16" r="3" fill="currentColor" stroke="none"/></svg>'
      );
    }
    if (name === "refresh") {
      return (
        '<svg' +
        common +
        '><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/>' +
        '<path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>'
      );
    }
    /* Folder refresh — rescan local library */
    if (name === "rescan") {
      return (
        '<svg' +
        common +
        '><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>' +
        '<path d="M12 11v5"/><path d="M9.5 13.5L12 11l2.5 2.5"/></svg>'
      );
    }
    /* Lyric re-match — text lines + small refresh arc */
    if (name === "lyric-refetch") {
      return (
        '<svg' +
        common +
        '><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>' +
        '<polyline points="14 2 14 8 20 8"/>' +
        '<line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="13" y2="17"/>' +
        '<path d="M16.5 15.5a2.5 2.5 0 1 0-0.2 1.6"/><polyline points="18.2 14.2 16.5 15.5 15.2 13.8"/></svg>'
      );
    }
    if (name === "info") {
      return (
        '<svg' +
        common +
        '><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/>' +
        '<line x1="12" y1="8" x2="12.01" y2="8"/></svg>'
      );
    }
    /* List sort — A/Z with direction chevrons */
    if (name === "sort") {
      return (
        '<svg' +
        common +
        '><path d="M3 6h13"/><path d="M3 12h9"/><path d="M3 18h6"/>' +
        '<path d="M17 8l3-3 3 3"/><path d="M20 5v14"/></svg>'
      );
    }
    if (name === "vol") {
      return (
        '<svg' +
        common +
        ' class="ucwc-music-vol-ico"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" stroke="none"/>' +
        '<path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>'
      );
    }
    return "";
  }

  var LIST_SORT_MODES = ["artist", "title", "path", "size"];

  function normalizeListSort(v) {
    v = String(v || "").toLowerCase();
    if (LIST_SORT_MODES.indexOf(v) >= 0) return v;
    return "artist";
  }

  function listSortLabel(mode) {
    mode = normalizeListSort(mode || state.listSort);
    if (mode === "title") return "曲名";
    if (mode === "path") return "路径";
    if (mode === "size") return "大小";
    return "歌手";
  }

  function trackSortKey(t, mode) {
    if (!t) return "";
    mode = normalizeListSort(mode);
    if (mode === "title") {
      return String(t.title || t.id || "").toLowerCase();
    }
    if (mode === "path") {
      return String(t.id || t.path || "").toLowerCase();
    }
    if (mode === "size") {
      /* numeric pad so string compare works; larger first via reverse in compare */
      var n = Number(t.size) || 0;
      return ("000000000000" + n).slice(-12);
    }
    return (
      String(t.artist || "").toLowerCase() +
      "\0" +
      String(t.album || "").toLowerCase() +
      "\0" +
      String(t.title || t.id || "").toLowerCase()
    );
  }

  function compareTracksForSort(a, b, mode) {
    mode = normalizeListSort(mode);
    if (mode === "size") {
      var sa = Number(a && a.size) || 0;
      var sb = Number(b && b.size) || 0;
      if (sb !== sa) return sb - sa; /* larger first */
      return trackSortKey(a, "title").localeCompare(trackSortKey(b, "title"), "zh");
    }
    var ka = trackSortKey(a, mode);
    var kb = trackSortKey(b, mode);
    if (ka === kb) {
      return String((a && a.id) || "").localeCompare(String((b && b.id) || ""), "zh");
    }
    try {
      return ka.localeCompare(kb, "zh");
    } catch (e0) {
      return ka < kb ? -1 : 1;
    }
  }

  /** Indices into state.tracks in current listSort order (filter applied by caller). */
  function sortedTrackIndices(filterQ) {
    var q = filterQ == null ? (state.listFilter || "").trim() : filterQ;
    var idxs = [];
    var i;
    for (i = 0; i < state.tracks.length; i++) {
      if (!trackMatchesFilter(state.tracks[i], q)) continue;
      idxs.push(i);
    }
    var mode = normalizeListSort(state.listSort);
    idxs.sort(function (ia, ib) {
      return compareTracksForSort(state.tracks[ia], state.tracks[ib], mode);
    });
    return idxs;
  }

  function syncSortBtn() {
    if (!els.sideSort) return;
    var lab = listSortLabel(state.listSort);
    els.sideSort.setAttribute("title", "排序：" + lab + "（点击切换）");
    els.sideSort.setAttribute("aria-label", "排序：" + lab);
    els.sideSort.setAttribute("data-sort", normalizeListSort(state.listSort));
  }

  function cycleListSort() {
    var cur = normalizeListSort(state.listSort);
    var i = LIST_SORT_MODES.indexOf(cur);
    if (i < 0) i = 0;
    state.listSort = LIST_SORT_MODES[(i + 1) % LIST_SORT_MODES.length];
    state.listRenderLimit = 300;
    syncSortBtn();
    saveLs();
    renderList();
    if (!state.error || /共 \d+ 首|已截断|筛选|排序|目录内无/.test(state.error)) {
      setStatus(libraryStatusText());
    }
  }

  function libraryStatusText() {
    var n = state.tracks.length;
    if (!n) return state.libraryScanning ? "正在后台建立曲库索引…" : (state.loaded ? "目录内无支持的音频" : "");
    var base = "共 " + n + " 首";
    if (state.libraryScanning) base += " · 后台更新中";
    if (state.listTruncated) {
      base += "（已截断" + (state.listLimit ? "·上限 " + state.listLimit : "") + "）";
    }
    var q = (state.listFilter || "").trim();
    if (q) {
      var shown = 0;
      var i;
      for (i = 0; i < state.tracks.length; i++) {
        if (trackMatchesFilter(state.tracks[i], q)) shown++;
      }
      base += " · 筛选 " + shown;
    }
    return base;
  }

  function clearPlaybackProgressStatus() {
    var msg = String(state.error || "");
    if (
      /正在尝试自动续播|续播中|恢复播放中|正在恢复播放|音轨恢复中|点一下.*(?:续播|开始播放)/.test(msg)
    ) {
      setStatus(libraryStatusText());
    }
  }

  function trackMatchesFilter(t, q) {
    if (!q) return true;
    if (!t) return false;
    var hay = ((t.artist || "") + " " + (t.title || "") + " " + (t.album || "") + " " + (t.id || "")).toLowerCase();
    var parts = String(q).toLowerCase().split(/\s+/);
    var i;
    for (i = 0; i < parts.length; i++) {
      if (!parts[i]) continue;
      if (hay.indexOf(parts[i]) < 0) return false;
    }
    return true;
  }

  function loadLs() {
    try {
      var raw = localStorage.getItem(LS_KEY);
      if (!raw) return;
      var o = JSON.parse(raw);
      if (typeof o.index === "number") state.index = o.index;
      if (typeof o.volume === "number") state.volume = Math.max(0, Math.min(1, o.volume));
      if (typeof o.shuffle === "boolean") state.shuffle = o.shuffle;
      if (o.repeat === "off" || o.repeat === "one" || o.repeat === "all") state.repeat = o.repeat;
      if (o.sideMode === "list" || o.sideMode === "lyrics") state.sideMode = o.sideMode;
      else if (typeof o.listOpen === "boolean") state.sideMode = o.listOpen ? "list" : "list";
      if (o.listSort) state.listSort = normalizeListSort(o.listSort);
    } catch (e) {}
  }

  var saveLsTimer = 0;
  function persistedSideMode() {
    return state.sideMode === "info"
      ? (state.sideBeforeInfo === "lyrics" ? "lyrics" : "list")
      : state.sideMode;
  }
  function saveLs() {
    /* Defer disk write so rapid shuffle/repeat clicks stay snappy on the main thread */
    if (saveLsTimer) {
      try {
        clearTimeout(saveLsTimer);
      } catch (e0) {}
    }
    saveLsTimer = setTimeout(function () {
      saveLsTimer = 0;
      try {
        localStorage.setItem(
          LS_KEY,
          JSON.stringify({
            index: state.index,
            volume: state.volume,
            shuffle: state.shuffle,
            repeat: state.repeat,
            sideMode: persistedSideMode(),
            listSort: normalizeListSort(state.listSort),
          })
        );
      } catch (e) {}
    }, 0);
  }
  function saveLsNow() {
    if (saveLsTimer) {
      try {
        clearTimeout(saveLsTimer);
      } catch (e0) {}
      saveLsTimer = 0;
    }
    try {
      localStorage.setItem(
        LS_KEY,
        JSON.stringify({
          index: state.index,
          volume: state.volume,
          shuffle: state.shuffle,
          repeat: state.repeat,
          sideMode: persistedSideMode(),
          listSort: normalizeListSort(state.listSort),
        })
      );
    } catch (e) {}
  }

  function fmt(sec) {
    if (!isFinite(sec) || sec < 0) sec = 0;
    sec = Math.floor(sec);
    var m = Math.floor(sec / 60);
    var s = sec % 60;
    return m + ":" + (s < 10 ? "0" : "") + s;
  }

  function trackUrl(id) {
    // Stable URL per track — Date.now() bust caused full reload + seek-to-0 races
    var v = 1;
    try { v = encodeURIComponent(String(id || "")).length || 1; } catch (e0) { v = 1; }
    return apiBase + "?action=stream&path=" + encodeURIComponent(id) + "&id=" + encodeURIComponent(id) + "&_v=" + v;
  }

  function current() {
    if (!state.tracks.length) return null;
    if (state.index < 0) state.index = 0;
    if (state.index >= state.tracks.length) state.index = 0;
    return state.tracks[state.index];
  }

  function sourceLabelText() {
    var s = String((cfg() && cfg().source) || "local").toLowerCase();
    if (s === "local" || s === "") return "本地音源";
    if (s === "navidrome") return "Navidrome";
    if (s === "fnos") return "飞牛音乐";
    if (s === "subsonic") return "Subsonic";
    if (s === "jellyfin") return "Jellyfin";
    if (s === "plex") return "Plex";
    return s;
  }

  function syncSourceLabel() {
    if (els.sourceLabel) els.sourceLabel.textContent = sourceLabelText();
  }

  function closeTrackInfoPop() {
    if (state.sideMode !== "info") return;
    state.sideMode = state.sideBeforeInfo === "lyrics" ? "lyrics" : "list";
    updateSidePanel();
    saveLs();
  }

  function formatBytes(n) {
    n = Number(n) || 0;
    if (n <= 0) return "";
    if (n < 1024) return n + " B";
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
    return (n / (1024 * 1024)).toFixed(2) + " MB";
  }

  function renderTrackInfoPop() {
    if (!els.infoPop) return;
    var t = current();
    if (!t) {
      els.infoPop.innerHTML =
        '<div class="ucwc-music-info-pop-title">当前无曲目</div>' +
        '<div class="ucwc-music-info-pop-row"><span class="ucwc-music-info-pop-k">提示</span>' +
        '<span class="ucwc-music-info-pop-v">请先选择或扫描曲库</span></div>';
      return;
    }
    var rows = [];
    function add(k, v) {
      if (v == null || v === "") return;
      rows.push(
        '<div class="ucwc-music-info-pop-row"><span class="ucwc-music-info-pop-k">' +
          k +
          '</span><span class="ucwc-music-info-pop-v">' +
          String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;") +
          "</span></div>"
      );
    }
    var title = t.title || t.name || "未知曲目";
    add("歌手", t.artist || "未知");
    add("专辑", t.album || "");
    if (t.duration != null && isFinite(Number(t.duration)) && Number(t.duration) > 0) {
      add("时长", fmt(Number(t.duration)));
    } else if (audio && isFinite(audio.duration) && audio.duration > 0) {
      add("时长", fmt(audio.duration));
    }
    add("音源", sourceLabelText());
    add("格式", t.ext || t.format || "");
    if (t.bitrate) add("码率", t.bitrate + (String(t.bitrate).indexOf("k") >= 0 ? "" : " kbps"));
    if (t.size) add("大小", formatBytes(t.size));
    add("路径", t.id || t.path || t.rel || "");
    els.infoPop.innerHTML =
      '<div class="ucwc-music-info-pop-title">' +
      String(title).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;") +
      "</div>" +
      rows.join("");
  }

  function toggleTrackInfoPop(ev) {
    try {
      if (ev) {
        ev.preventDefault();
        ev.stopPropagation();
      }
    } catch (e0) {}
    if (!root) return;
    var open = state.sideMode !== "info";
    if (open) {
      state.sideBeforeInfo = state.sideMode === "lyrics" ? "lyrics" : "list";
      state.sideMode = "info";
      renderTrackInfoPop();
      updateSidePanel();
    } else {
      closeTrackInfoPop();
    }
  }

  function setStatus(msg) {
    state.error = msg || "";
    if (els.status) els.status.textContent = msg || "";
    syncSourceLabel();
  }

  function updateSidePanel() {
    if (!root) return;
    var isInfo = state.sideMode === "info";
    var isLyrics = state.sideMode === "lyrics";
    var isList = !isInfo && !isLyrics;
    root.classList.toggle("ucwc-music-side-list", isList);
    root.classList.toggle("ucwc-music-side-lyrics", isLyrics);
    root.classList.toggle("ucwc-music-side-info", isInfo);
    if (els.infoBtn) {
      els.infoBtn.classList.toggle("on", isInfo);
      els.infoBtn.setAttribute("aria-expanded", isInfo ? "true" : "false");
    }
    if (els.listBtn) {
      els.listBtn.classList.toggle("on", true);
      var baseMode = isInfo ? state.sideBeforeInfo : state.sideMode;
      var toLyrics = baseMode !== "lyrics";
      els.listBtn.innerHTML = toLyrics ? svgIcon("lyrics") : svgIcon("list");
      els.listBtn.setAttribute("title", toLyrics ? "切换到歌词" : "切换到曲目");
      els.listBtn.setAttribute("aria-label", toLyrics ? "切换到歌词" : "切换到曲目");
    }
    if (els.sideLabel) {
      els.sideLabel.textContent = isInfo ? "歌曲信息" : isList ? "曲目" : "歌词";
    }
    /* Keep search-wrap in flow always (CSS reserves 36px) so list⇄lyrics does not jump card height */
    if (els.sideSearchWrap) {
      els.sideSearchWrap.hidden = false;
      els.sideSearchWrap.style.display = "";
      els.sideSearchWrap.setAttribute("aria-hidden", isList ? "false" : "true");
    }
    if (els.sideSearch) {
      try {
        els.sideSearch.tabIndex = isList ? 0 : -1;
        els.sideSearch.disabled = !isList;
      } catch (eSr) {}
    }
    if (els.sideRescan) {
      els.sideRescan.hidden = !isList;
      els.sideRescan.style.display = isList ? "" : "none";
    }
    if (els.sideSort) {
      els.sideSort.hidden = !isList;
      els.sideSort.style.display = isList ? "" : "none";
      syncSortBtn();
    }
    if (els.sideLyricRefetch) {
      els.sideLyricRefetch.hidden = !isLyrics;
      els.sideLyricRefetch.style.display = isLyrics ? "" : "none";
    }
    [els.sideLyricEarlier, els.sideLyricOffset, els.sideLyricLater].forEach(function (button) {
      if (!button) return;
      button.hidden = !isLyrics;
      button.style.display = isLyrics ? "" : "none";
    });
    updateLyricAdjustUi();
    if (els.sideFilterCount) {
      if (!isList || !(state.listFilter || "").trim()) {
        els.sideFilterCount.hidden = true;
        els.sideFilterCount.textContent = "";
      } else {
        els.sideFilterCount.hidden = false;
      }
    }
    scheduleMarqueeRefresh();
  }

  function updateMeta() {
    var t = current();
    syncSourceLabel();
    if (!els.title) {
      return;
    }
    if (!t) {
      els.title.textContent = state.loaded ? "曲库为空" : "加载中…";
      // Keep config/scan errors only in .ucwc-music-status (below volume).
      // Putting state.error into .sub duplicated the same long tip under the title.
      if (els.sub) els.sub.textContent = state.loaded ? "" : (sourceLabelText() === "Navidrome" ? "Navidrome" : "本地音乐");
      clearLyricsView("—");
      clearCoverView();
      state.cover.id = "";
      if (state.sideMode === "info") renderTrackInfoPop();
      return;
    }
    els.title.textContent = t.title || "未知曲目";
    if (state.sideMode === "info") renderTrackInfoPop();
    var bits = [];
    if (t.artist) bits.push(t.artist);
    if (t.album) bits.push(t.album);
    if (els.sub) els.sub.textContent = bits.length ? bits.join(" · ") : t.ext || "本地";
    if (els.list) {
      var items = els.list.querySelectorAll(".ucwc-music-item");
      for (var i = 0; i < items.length; i++) {
        if (parseInt(items[i].getAttribute("data-i"), 10) === state.index) {
          items[i].classList.add("active");
        } else {
          items[i].classList.remove("active");
        }
      }
    }
    if (
      els.art &&
      t.id &&
      state.cover.missId !== t.id &&
      (state.cover.id !== t.id || (!state.cover.url && !state.cover.loading && state.cover.paintedId !== t.id))
    ) {
      loadCoverForCurrent();
    }
  }

  function updatePlayBtn() {
    var playing = isUiPlaying();
    // Prefer live card node (may differ from cached els after Unraid content swap)
    var playBtn = null;
    try {
      var live = document.getElementById("ucwc-music-card");
      if (live) playBtn = live.querySelector(".ucwc-music-btn.play");
    } catch (e0) {}
    if (!playBtn && els.play && els.play.isConnected) playBtn = els.play;
    if (playBtn) {
      playBtn.innerHTML = playing ? svgIcon("pause") : svgIcon("play");
      playBtn.setAttribute("title", playing ? "暂停" : "播放");
      playBtn.setAttribute("aria-label", playing ? "暂停" : "播放");
      playBtn.classList.toggle("is-playing", playing);
      playBtn.classList.toggle("is-paused", !playing);
      els.play = playBtn;
    }
    // Keep progress painted whenever we refresh transport state
    if (audio && shouldShowCard()) {
      try {
        var cur = audio.currentTime || 0;
        var dur = audio.duration || 0;
        paintProgressTo(document.getElementById("ucwc-music-card") || root, cur, dur);
      } catch (e1) {}
    }
    updateChipUi();
  }

  /**
   * Paint the shared transport state to both the dashboard card and sitewide
   * chip in the same task. Audio play/pause events remain authoritative, while
   * track metadata is reflected immediately instead of waiting for remote
   * FLAC metadata or a sleeping disk to become ready.
   */
  function syncTransportSurfaces(includeMeta) {
    if (includeMeta) {
      ensureLiveCardRefs();
      updateMeta();
    }
    if (isSitewidePlay()) syncSitewideChip();
    updatePlayBtn();
  }

  function liveCardRoot() {
    try {
      var live = document.getElementById("ucwc-music-card");
      if (live && live.isConnected) return live;
    } catch (e0) {}
    return root && root.isConnected ? root : null;
  }

  function updateModeBtns() {
    var card = liveCardRoot();
    var sh = null;
    var rp = null;
    try {
      if (card) {
        sh = card.querySelector(".ucwc-music-btn.shuffle");
        rp = card.querySelector(".ucwc-music-btn.repeat");
      }
    } catch (e0) {}
    if (!sh && els.shuffle && els.shuffle.isConnected) sh = els.shuffle;
    if (!rp && els.repeat && els.repeat.isConnected) rp = els.repeat;
    if (sh) {
      sh.classList.toggle("on", !!state.shuffle);
      sh.setAttribute("title", state.shuffle ? "随机：开" : "随机：关");
      sh.setAttribute("aria-pressed", state.shuffle ? "true" : "false");
      if (!sh.querySelector("svg")) sh.innerHTML = svgIcon("shuffle");
      els.shuffle = sh;
    }
    if (rp) {
      rp.classList.toggle("on", state.repeat !== "off");
      rp.classList.toggle("repeat-off", state.repeat === "off");
      rp.classList.toggle("repeat-all", state.repeat === "all");
      rp.classList.toggle("repeat-one", state.repeat === "one");
      var rTitle =
        state.repeat === "one" ? "单曲循环" : state.repeat === "all" ? "列表循环" : "循环：关";
      rp.setAttribute("title", rTitle);
      rp.setAttribute("aria-label", rTitle);
      rp.setAttribute("aria-pressed", state.repeat !== "off" ? "true" : "false");
      var repeatIcon = state.repeat === "one" ? "repeat-one" : state.repeat === "all" ? "repeat" : "repeat-off";
      if (rp.getAttribute("data-repeat-icon") !== repeatIcon || !rp.querySelector("svg")) {
        rp.innerHTML = svgIcon(repeatIcon);
        rp.setAttribute("data-repeat-icon", repeatIcon);
      }
      els.repeat = rp;
    }
  }

  function clearLyricsView(hint) {
    state.lyrics.lines = [];
    state.lyrics.active = -1;
    state.lyrics.empty = true;
    state.lyrics.unsynced = false;
    state.lyrics.loading = false;
    if (root) root.classList.remove("ucwc-music-has-lyrics");
    if (els.lyricsScroll) els.lyricsScroll.innerHTML = "";
    if (els.lyricsHint) {
      els.lyricsHint.style.display = "";
      els.lyricsHint.textContent = hint || "加载或自动匹配歌词…";
    }
    updateChipUi();
  }


  function preferReduceMotion() {
    try {
      if (document.documentElement.classList.contains("ucwc-reduce-motion")) return true;
      if (document.body && document.body.classList.contains("ucwc-reduce-motion")) return true;
      if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return true;
    } catch (e0) {}
    return false;
  }

  /** Build marquee DOM into host for long single-line text. */
  function fillMarquee(host, text) {
    if (!host) return;
    var t = text == null ? "" : String(text);
    host.classList.add("ucwc-music-marquee");
    host.classList.remove("is-overflow");
    host.removeAttribute("title");
    host.innerHTML = "";
    var track = document.createElement("span");
    track.className = "ucwc-music-marquee-track";
    var seg1 = document.createElement("span");
    seg1.className = "ucwc-music-marquee-seg";
    seg1.textContent = t;
    track.appendChild(seg1);
    var seg2 = document.createElement("span");
    seg2.className = "ucwc-music-marquee-seg";
    seg2.setAttribute("aria-hidden", "true");
    seg2.textContent = t;
    track.appendChild(seg2);
    host.appendChild(track);
    if (t) host.setAttribute("title", t);
  }

  /** Plain static lyric text (ellipsis). Used for non-active lines — no marquee. */
  function fillLrcStatic(host, text) {
    if (!host) return;
    var t = text == null ? "" : String(text);
    host.className = "ucwc-music-lrc-static";
    host.classList.remove("ucwc-music-marquee", "is-overflow");
    host.removeAttribute("style");
    host.textContent = t;
    if (t) host.setAttribute("title", t);
    else host.removeAttribute("title");
  }

  function measureMarquee(host) {
    if (!host) return;
    var track = host.querySelector(".ucwc-music-marquee-track");
    var seg = host.querySelector(".ucwc-music-marquee-seg");
    if (!track || !seg) return;
    host.classList.remove("is-overflow");
    track.style.animationDuration = "";
    var need = false;
    try {
      var sw = seg.scrollWidth || seg.offsetWidth || 0;
      var cw = host.clientWidth || 0;
      need = sw > cw + 2;
    } catch (e0) {
      need = false;
    }
    if (preferReduceMotion()) {
      host.classList.toggle("is-overflow", false);
      return;
    }
    var parent = host.closest(".ucwc-music-lrc-line, .ucwc-music-item");
    // Lyrics: only the *active* line may marquee; list items always may.
    if (parent && parent.classList.contains("ucwc-music-lrc-line") && !parent.classList.contains("active")) {
      need = false;
    }
    if (need) {
      host.classList.add("is-overflow");
      if (parent) parent.classList.add("is-long");
      var dur = 12;
      try {
        var sw2 = seg.scrollWidth || 0;
        if (sw2 > 0) dur = Math.max(8, Math.min(28, sw2 / 28));
        else {
          var chars = (seg.textContent || "").length;
          dur = Math.max(8, Math.min(28, chars * 0.32));
        }
      } catch (e1) {}
      host.style.setProperty("--ucwc-marquee-dur", dur.toFixed(2) + "s");
      track.style.animationDuration = dur.toFixed(2) + "s";
    } else {
      host.classList.remove("is-overflow");
      if (parent) parent.classList.remove("is-long");
      host.style.removeProperty("--ucwc-marquee-dur");
    }
  }

  function refreshMarquees(scope) {
    var rootEl = scope || root || document.getElementById("ucwc-music-card");
    if (!rootEl) return;
    var nodes = rootEl.querySelectorAll(".ucwc-music-marquee");
    for (var i = 0; i < nodes.length; i++) measureMarquee(nodes[i]);
  }

  var marqueeRefreshTimer = 0;
  function scheduleMarqueeRefresh() {
    if (marqueeRefreshTimer) {
      try { clearTimeout(marqueeRefreshTimer); } catch (e0) {}
    }
    marqueeRefreshTimer = setTimeout(function () {
      marqueeRefreshTimer = 0;
      refreshMarquees();
    }, 40);
  }

  /**
   * Promote active lyric to marquee (if long); demote previous to static ellipsis.
   * Only the current line scrolls horizontally.
   */
  function setLyricLineActiveContent(row, text, active) {
    if (!row) return;
    var t = text == null ? "" : String(text);
    var existing = row.firstElementChild;
    if (active) {
      var mq = existing && existing.classList && existing.classList.contains("ucwc-music-marquee")
        ? existing
        : document.createElement("span");
      if (mq !== existing) {
        row.innerHTML = "";
        row.appendChild(mq);
      }
      fillMarquee(mq, t);
      measureMarquee(mq);
    } else {
      var st = existing && existing.classList && existing.classList.contains("ucwc-music-lrc-static")
        ? existing
        : document.createElement("span");
      if (st !== existing) {
        row.innerHTML = "";
        row.appendChild(st);
      }
      fillLrcStatic(st, t);
      row.classList.remove("is-long");
    }
  }

  function renderLyricsLines() {
    if (!els.lyricsScroll) return;
    els.lyricsScroll.innerHTML = "";
    var lines = state.lyrics.lines || [];
    if (!lines.length) {
      if (root) root.classList.remove("ucwc-music-has-lyrics");
      if (els.lyricsHint) {
        els.lyricsHint.style.display = "";
        els.lyricsHint.textContent = state.lyrics.loading
          ? "加载/匹配歌词…"
          : "暂无歌词（将自动尝试下载）";
      }
      return;
    }
    if (root) root.classList.add("ucwc-music-has-lyrics");
    if (els.lyricsHint) els.lyricsHint.style.display = "none";
    for (var i = 0; i < lines.length; i++) {
      var row = document.createElement("div");
      row.className = "ucwc-music-lrc-line";
      row.setAttribute("data-i", String(i));
      // Static by default — marquee only after becoming active
      var st = document.createElement("span");
      fillLrcStatic(st, lines[i].text || "");
      row.appendChild(st);
      els.lyricsScroll.appendChild(row);
    }
    state.lyrics.active = -1;
    syncLyrics(true);
    if (audio && !audio.paused) startLyricsRaf();
  }

  function findLyricIndex(tMs) {
    var lines = state.lyrics.lines;
    if (!lines || !lines.length) return -1;
    var lo = 0;
    var hi = lines.length - 1;
    var ans = -1;
    while (lo <= hi) {
      var mid = (lo + hi) >> 1;
      if (lines[mid].t <= tMs) {
        ans = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return ans;
  }

  /** Scroll active lyric into vertical center of the lyrics pane (not whole page). */
  function scrollLyricIntoPane(node, smooth) {
    if (!node || !els.lyricsScroll) return;
    try {
      var sc = els.lyricsScroll;
      var top = node.offsetTop - (sc.clientHeight / 2) + (node.offsetHeight / 2);
      if (top < 0) top = 0;
      var max = Math.max(0, sc.scrollHeight - sc.clientHeight);
      if (top > max) top = max;
      if (typeof sc.scrollTo === "function") {
        sc.scrollTo({ top: top, behavior: smooth ? "smooth" : "auto" });
      } else {
        sc.scrollTop = top;
      }
    } catch (e0) {
      try {
        node.scrollIntoView({ block: "center", inline: "nearest", behavior: smooth ? "smooth" : "auto" });
      } catch (e1) {}
    }
  }

  /**
   * Map audio clock → lyric clock (ms).
   * Match ThemeEffects beta built-in music (pre-v2.6.0 strip):
   *   Math.floor(currentTime * 1000) - offsetMs
   * LRC [offset:+N] (A2): positive delays lyric display → subtract from audio clock.
   * No fixed lead — artificial +lead caused permanent desync vs true LRC stamps.
   * driftMs kept as optional fine-tune (default 0; positive = highlight earlier).
   */
  function lyricClockMs() {
    if (!audio) return 0;
    var cur = audio.currentTime;
    if (!isFinite(cur) || cur < 0) cur = 0;
    var off = typeof state.lyrics.offsetMs === "number" ? state.lyrics.offsetMs : 0;
    var drift = typeof state.lyrics.driftMs === "number" ? state.lyrics.driftMs : 0;
    var tMs = Math.floor(cur * 1000) - off + drift;
    return tMs < 0 ? 0 : tMs;
  }

  function lyricDriftMap() {
    try {
      var data = JSON.parse(localStorage.getItem(LYRIC_DRIFT_KEY) || "{}");
      return data && typeof data === "object" ? data : {};
    } catch (e0) { return {}; }
  }

  function lyricDriftTrackKey(id) {
    return libraryClientScope() + "|" + String(id || "");
  }

  function loadLyricDrift(id) {
    var value = Number(lyricDriftMap()[lyricDriftTrackKey(id)] || 0);
    return isFinite(value) ? Math.max(-10000, Math.min(10000, Math.round(value / 100) * 100)) : 0;
  }

  function saveLyricDrift(id, value) {
    if (!id) return;
    try {
      var map = lyricDriftMap();
      var key = lyricDriftTrackKey(id);
      if (value) map[key] = value;
      else delete map[key];
      var keys = Object.keys(map);
      if (keys.length > 500) {
        for (var i = 0; i < keys.length - 500; i++) delete map[keys[i]];
      }
      localStorage.setItem(LYRIC_DRIFT_KEY, JSON.stringify(map));
    } catch (e0) {}
  }

  function updateLyricAdjustUi() {
    if (!els.sideLyricOffset) return;
    var drift = Number(state.lyrics.driftMs) || 0;
    var seconds = drift / 1000;
    var label = (seconds > 0 ? "+" : "") + seconds.toFixed(1) + "s";
    els.sideLyricOffset.textContent = label;
    els.sideLyricOffset.setAttribute("title", drift ? "点击重置歌词时间（当前 " + label + "）" : "歌词时间偏移：0 秒");
    els.sideLyricOffset.setAttribute("aria-label", drift ? "重置歌词时间，当前偏移 " + label : "歌词时间偏移 0 秒");
  }

  function adjustLyricDrift(deltaMs) {
    var t = current();
    if (!t || !t.id || !state.lyrics.lines.length || state.lyrics.unsynced) return;
    var next = Math.max(-10000, Math.min(10000, (Number(state.lyrics.driftMs) || 0) + deltaMs));
    state.lyrics.driftMs = next;
    saveLyricDrift(t.id, next);
    updateLyricAdjustUi();
    syncLyrics(true);
    var sec = Math.abs(next / 1000).toFixed(1);
    setStatus(next === 0 ? "歌词时间已重置" : (next > 0 ? "歌词已提前 " : "歌词已延后 ") + sec + " 秒");
  }

  function syncLyrics(force) {
    if (!audio) return;
    if (state.lyrics.unsynced) return;
    var now = Date.now();
    // rAF path may call very often; still allow ~30fps class updates
    if (!force && now - lyricsSyncLast < 32) return;
    lyricsSyncLast = now;
    var hasLines = state.lyrics.lines && state.lyrics.lines.length;
    var tMs = lyricClockMs();
    var idx = hasLines ? findLyricIndex(tMs) : -1;
    var changed = idx !== state.lyrics.active;
    if (!changed && !force) {
      return;
    }
    var prevIdx = state.lyrics.active;
    state.lyrics.active = idx;
    if (els.lyricsScroll && hasLines) {
      var nodes = els.lyricsScroll.querySelectorAll(".ucwc-music-lrc-line");
      var lines = state.lyrics.lines || [];
      // Demote previous active (stop marquee) — only touch prev/next to avoid full reflow
      if (prevIdx >= 0 && prevIdx !== idx && nodes[prevIdx]) {
        nodes[prevIdx].classList.remove("active");
        setLyricLineActiveContent(nodes[prevIdx], lines[prevIdx] ? lines[prevIdx].text : "", false);
      }
      if (idx >= 0 && nodes[idx]) {
        // clear any stale .active (e.g. after force re-render)
        if (force || prevIdx < 0) {
          for (var i = 0; i < nodes.length; i++) {
            if (i !== idx) nodes[i].classList.remove("active");
          }
        }
        nodes[idx].classList.add("active");
        setLyricLineActiveContent(nodes[idx], lines[idx] ? lines[idx].text : "", true);
        var reduce =
          document.documentElement.classList.contains("ucwc-reduce-motion") ||
          (document.body && document.body.classList.contains("ucwc-reduce-motion")) ||
          preferReduceMotion();
        scrollLyricIntoPane(nodes[idx], !reduce && !force);
      } else if (force) {
        for (var j = 0; j < nodes.length; j++) nodes[j].classList.remove("active");
      }
    }
    updateChipUi();
  }

  var lyricsRaf = 0;
  function stopLyricsRaf() {
    if (lyricsRaf) {
      try {
        clearTimeout(lyricsRaf);
      } catch (e0) {}
      lyricsRaf = 0;
    }
  }
  function tickLyricsRaf() {
    lyricsRaf = 0;
    if (!audio || audio.paused) return;
    syncLyrics(false);
    try {
      /* LRC timestamps do not need a 60 Hz animation loop. 250 ms keeps
       * highlighting responsive while avoiding continuous DOM work on
       * low-power dashboard clients. */
      lyricsRaf = setTimeout(tickLyricsRaf, 250);
    } catch (e1) {
      lyricsRaf = 0;
    }
  }
  function startLyricsRaf() {
    if (!audio || audio.paused) return;
    if (state.lyrics.unsynced) return;
    if (lyricsRaf) return;
    try {
      lyricsRaf = setTimeout(tickLyricsRaf, 0);
    } catch (e0) {
      lyricsRaf = 0;
    }
  }

  function revokeCoverBlob() {
    try {
      if (state.cover && state.cover.blobUrl) {
        var dying = state.cover.blobUrl;
        state.cover.blobUrl = "";
        // Defer revoke so in-flight <img> decode / paint is not aborted mid-frame
        setTimeout(function () {
          try {
            URL.revokeObjectURL(dying);
          } catch (e1) {}
        }, 0);
      }
    } catch (e0) {}
  }

  /** Revoke a specific object URL only after it is no longer the visible img src. */
  function releaseCoverBlobLater(blobUrl) {
    if (!blobUrl || blobUrl.indexOf("blob:") !== 0) return;
    setTimeout(function () {
      try {
        if (state.cover && state.cover.blobUrl === blobUrl) return;
        if (els.art) {
          var img = els.art.querySelector("img.ucwc-music-art-img");
          if (img && img.getAttribute("src") === blobUrl) return;
        }
        URL.revokeObjectURL(blobUrl);
      } catch (e0) {}
    }, 1200);
  }

  function clearCoverDom() {
    if (!els.art) return;
    els.art.classList.remove("has-cover");
    state.cover.paintedId = "";
    var img = els.art.querySelector("img.ucwc-music-art-img");
    if (img) {
      try {
        img.onload = null;
        img.onerror = null;
        img.removeAttribute("src");
      } catch (e0) {}
      if (img.parentNode) img.parentNode.removeChild(img);
    }
    ensureDefaultArtFallback();
  }

  function clearCoverView() {
    revokeCoverBlob();
    state.cover.url = "";
    state.cover.paintedId = "";
    clearCoverDom();
  }

  function absPluginUrl(url) {
    if (!url) return "";
    if (/^https?:\/\//i.test(url) || url.indexOf("blob:") === 0 || url.indexOf("data:") === 0) return url;
    if (url.charAt(0) === "/") {
      try {
        return (location.origin || "") + url;
      } catch (e0) {
        return url;
      }
    }
    return url;
  }

  /**
   * Paint cover into .ucwc-music-art.
   * - <img> stays hidden until decode succeeds (no browser broken-image / document icon).
   * - Failure → remove img, restore default ♪ fallback art.
   * - optional onReady(ok) after load/error for this assignment.
   */
  function setCoverUrl(url, trackId, onReady) {
    if (!els.art) {
      if (typeof onReady === "function") onReady(false);
      return;
    }
    if (!url) {
      if (typeof onReady === "function") onReady(false);
      return;
    }
    var finalUrl = absPluginUrl(url);
    var prevGood =
      state.cover.paintedId &&
      state.cover.paintedId !== "" &&
      els.art.classList.contains("has-cover") &&
      !!els.art.querySelector("img.ucwc-music-art-img");
    var img = els.art.querySelector("img.ucwc-music-art-img");
    if (!img) {
      img = document.createElement("img");
      img.className = "ucwc-music-art-img";
      img.alt = "";
      img.draggable = false;
      img.decoding = "async";
      img.referrerPolicy = "no-referrer";
      // Hidden until markOk — CSS also gates on .has-cover
      try {
        img.style.opacity = "0";
        img.style.visibility = "hidden";
      } catch (eSt) {}
      els.art.insertBefore(img, els.art.firstChild);
    }
    var done = false;
    if (typeof state.cover.paintGen !== "number") state.cover.paintGen = 0;
    var assignGen = ++state.cover.paintGen;
    function markOk() {
      if (done) return;
      done = true;
      if (state.cover.paintGen !== assignGen) return;
      if (state.cover.id !== trackId && state.cover.paintedId && state.cover.paintedId !== trackId) {
        if (typeof onReady === "function") onReady(false);
        return;
      }
      // Reject zero-size / broken decodes (some browsers fire load on placeholder)
      if (!img.naturalWidth || img.naturalWidth < 2) {
        dropBrokenToDefault();
        if (typeof onReady === "function") onReady(false);
        return;
      }
      state.cover.paintedId = trackId;
      els.art.classList.add("has-cover");
      try {
        img.style.opacity = "1";
        img.style.visibility = "visible";
      } catch (e1) {}
      updateMediaSessionMeta();
      if (typeof onReady === "function") onReady(true);
    }
    function dropBrokenToDefault() {
      // No match / bad image → original default art (♪ + gradient), never broken icon
      try {
        img.onload = null;
        img.onerror = null;
        img.removeAttribute("src");
        if (img.parentNode) img.parentNode.removeChild(img);
      } catch (e2) {}
      els.art.classList.remove("has-cover");
      if (state.cover.paintedId === trackId) state.cover.paintedId = "";
      if (state.cover.id === trackId) {
        state.cover.url = "";
        var orphan = state.cover.blobUrl;
        state.cover.blobUrl = "";
        releaseCoverBlobLater(orphan);
        state.cover.missId = trackId;
      }
      ensureDefaultArtFallback();
      updateMediaSessionMeta();
    }
    img.onload = markOk;
    img.onerror = function () {
      if (done) return;
      done = true;
      if (state.cover.paintGen !== assignGen) return;
      var curSrc = "";
      try {
        curSrc = img.getAttribute("src") || "";
      } catch (e3) {}
      if (curSrc && curSrc !== finalUrl) {
        if (typeof onReady === "function") onReady(false);
        return;
      }
      // Keep a still-valid previous track cover if user already moved on
      if (prevGood && state.cover.paintedId && state.cover.paintedId !== trackId) {
        if (typeof onReady === "function") onReady(false);
        return;
      }
      if (state.cover.id === trackId || !prevGood) {
        dropBrokenToDefault();
      }
      if (typeof onReady === "function") onReady(false);
    };
    if (img.getAttribute("src") === finalUrl && img.complete && img.naturalWidth > 1) {
      markOk();
      return;
    }
    // Assign new src while keeping old has-cover pixels if any; new img stays hidden until ok
    if (!prevGood) {
      els.art.classList.remove("has-cover");
      try {
        img.style.opacity = "0";
        img.style.visibility = "hidden";
      } catch (e4) {}
    }
    img.src = finalUrl;
    if (img.complete && img.naturalWidth > 1) markOk();
  }

  /** Ensure default ♪ node exists after stripping a broken cover img. */
  function ensureDefaultArtFallback() {
    if (!els.art) return;
    var fb = els.art.querySelector(".ucwc-music-art-fallback");
    if (!fb) {
      fb = document.createElement("span");
      fb.className = "ucwc-music-art-fallback";
      fb.setAttribute("aria-hidden", "true");
      fb.textContent = "♪";
      els.art.appendChild(fb);
    } else {
      try {
        fb.style.display = "";
        fb.style.visibility = "visible";
        fb.style.opacity = "1";
      } catch (e0) {}
    }
  }

  function applyCoverBlob(blob, trackId, metaUrl) {
    if (!blob || state.cover.id !== trackId) return false;
    try {
      var prevBlob = state.cover.blobUrl || "";
      var obj = URL.createObjectURL(blob);
      state.cover.blobUrl = obj;
      state.cover.url = metaUrl || obj;
      setCoverUrl(obj, trackId, function () {
        // Release previous blob only after new paint attempt settled
        if (prevBlob && prevBlob !== obj) releaseCoverBlobLater(prevBlob);
      });
      return true;
    } catch (e0) {
      return false;
    }
  }

  function loadCoverForCurrent() {
    var t = current();
    if (!els.art) return;
    if (!t || !t.id) {
      state.cover.id = "";
      state.cover.loading = false;
      state.cover.missId = "";
      clearCoverView();
      return;
    }
    if (state.cover.missId === t.id && state.cover.id === t.id && !state.cover.url && !state.cover.loading) {
      return; // known miss — do not clear/retry loop
    }
    if (state.cover.id === t.id && state.cover.url && !state.cover.loading) {
      setCoverUrl(state.cover.blobUrl || state.cover.url, t.id);
      return;
    }
    if (state.cover.id === t.id && state.cover.loading) return;
    var seq = ++state.cover.seq;
    var trackId = t.id;
    state.cover.id = trackId;
    state.cover.loading = true;
    if (state.cover.missId && state.cover.missId !== trackId) state.cover.missId = "";
    // Keep previous art visible until the new cover is ready (or confirmed empty).
    var reqUrl = apiBase + "?action=cover&path=" + encodeURIComponent(trackId) + "&id=" + encodeURIComponent(trackId) + "&fetch=1&_ts=" + Date.now();
    fetch(reqUrl, {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
      cache: "no-store",
    })
      .then(function (r) {
        return r.json().catch(function () {
          return null;
        });
      })
      .then(function (j) {
        if (seq !== state.cover.seq) return;
        if (!j || !j.ok || j.empty || !j.url) {
          state.cover.loading = false;
          // Flaky/empty response must NOT wipe a cover we already painted for this track.
          if (state.cover.paintedId === trackId && (state.cover.blobUrl || state.cover.url)) {
            if (!state.cover.url && state.cover.blobUrl) state.cover.url = state.cover.blobUrl;
            updateMediaSessionMeta();
            return;
          }
          // Confirmed no cover for this track — mark miss so updateMeta won't re-loop clear.
          state.cover.missId = trackId;
          state.cover.url = "";
          var orphan = state.cover.blobUrl;
          state.cover.blobUrl = "";
          clearCoverDom();
          releaseCoverBlobLater(orphan);
          updateMediaSessionMeta();
          return;
        }
        state.cover.id = trackId;
        state.cover.missId = "";
        if (t && t.id === trackId) t.has_cover = true;
        var imageUrl = absPluginUrl(j.url);
        // Prefer blob fetch so cookies/auth apply and broken HTML isn't shown as image
        return fetch(imageUrl, {
          credentials: "same-origin",
          cache: "no-store",
          headers: { Accept: "image/*,*/*;q=0.8" },
        })
          .then(function (ir) {
            if (!ir || !ir.ok) throw new Error("img http");
            var ct = (ir.headers && ir.headers.get && ir.headers.get("content-type")) || "";
            if (ct && ct.indexOf("image/") !== 0 && ct.indexOf("octet-stream") === -1) {
              throw new Error("not image " + ct);
            }
            return ir.blob();
          })
          .then(function (blob) {
            if (seq !== state.cover.seq) return;
            state.cover.loading = false;
            if (!blob || blob.size < 32) throw new Error("empty blob");
            if (!applyCoverBlob(blob, trackId, imageUrl)) {
              state.cover.url = imageUrl;
              setCoverUrl(imageUrl, trackId);
            }
            if (j.source && (String(j.source).indexOf("downloaded") === 0 || String(j.source).indexOf("remote") === 0 || String(j.source) === "embedded")) {
              var tip =
                String(j.source).indexOf("downloaded") === 0
                  ? "已自动下载封面"
                  : String(j.source) === "embedded"
                    ? "已读取内嵌封面"
                    : "";
              if (tip) {
                setStatus(tip);
                setTimeout(function () {
                  if (state.error === tip) setStatus(libraryStatusText());
                }, 2200);
              }
            }
            updateMediaSessionMeta();
          })
          .catch(function () {
            if (seq !== state.cover.seq) return;
            state.cover.loading = false;
            // Direct URL fallback — still keep prior art until this assignment errors
            state.cover.url = imageUrl;
            setCoverUrl(imageUrl, trackId);
            updateMediaSessionMeta();
          });
      })
      .catch(function () {
        if (seq !== state.cover.seq) return;
        state.cover.loading = false;
        // Network error: keep whatever art is on screen (prior track or cached)
        if (state.cover.paintedId === trackId && state.cover.blobUrl && !state.cover.url) {
          state.cover.url = state.cover.blobUrl;
        }
        updateMediaSessionMeta();
      });
  }

  function loadLyricsForCurrent(opts) {
    opts = opts || {};
    var force = !!opts.force;
    var t = current();
    if (!t || !t.id) {
      state.lyrics.id = "";
      clearLyricsView("—");
      return;
    }
    if (
      !force &&
      state.lyrics.id === t.id &&
      (state.lyrics.lines.length || state.lyrics.empty) &&
      !state.lyrics.loading
    ) {
      // already loaded for this track
      if (state.lyrics.lines.length) syncLyrics(true);
      return;
    }
    var seq = ++state.lyrics.seq;
    state.lyrics.id = t.id;
    state.lyrics.loading = true;
    state.lyrics.empty = true;
    state.lyrics.unsynced = false;
    state.lyrics.lines = [];
    state.lyrics.active = -1;
    state.lyrics.offsetMs = 0;
    state.lyrics.driftMs = loadLyricDrift(t.id);
    updateLyricAdjustUi();
    if (els.lyricsScroll) els.lyricsScroll.innerHTML = "";
    if (root) root.classList.remove("ucwc-music-has-lyrics");
    if (els.lyricsHint) {
      els.lyricsHint.style.display = "";
      els.lyricsHint.textContent = force ? "正在重新匹配歌词…" : "加载/匹配歌词…";
    }
    var url =
      apiBase +
      "?action=lyrics&path=" +
      encodeURIComponent(t.path || t.id) +
      "&id=" + encodeURIComponent(t.id) +
      "&fetch=1" +
      (force ? "&force=1" : "") +
      "&_ts=" +
      Date.now();
    fetch(url, {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    })
      .then(function (r) {
        return r.json();
      })
      .then(function (j) {
        if (seq !== state.lyrics.seq) return;
        state.lyrics.loading = false;
        if (!j || !j.ok) {
          clearLyricsView((j && j.error) || "歌词加载失败");
          return;
        }
        var lines = Array.isArray(j.lines) ? j.lines : [];
        var norm = [];
        for (var i = 0; i < lines.length; i++) {
          var L = lines[i];
          if (!L || typeof L.t !== "number") continue;
          var tx = typeof L.text === "string" ? L.text : "";
          if (!tx) continue;
          norm.push({ t: L.t, text: tx });
        }
        state.lyrics.offsetMs = typeof j.offset_ms === "number" ? j.offset_ms : 0;
        state.lyrics.unsynced = !!j.unsynced;
        state.lyrics.lines = norm;
        state.lyrics.empty = norm.length === 0;
        state.lyrics.id = t.id;
        if (norm.length && t) t.has_lrc = true;
        renderLyricsLines();
        renderList();
        updateChipUi();
        if (j && (j.source === "downloaded" || j.source === "refetched")) {
          var tip = force ? "已重新匹配歌词" : "已自动下载歌词";
          setStatus(tip);
          setTimeout(function () {
            if (state.error === tip) setStatus(libraryStatusText());
          }, 2200);
        } else if (force && norm.length === 0) {
          setStatus((j && j.download_error) || "未找到可匹配歌词");
          setTimeout(function () {
            if (state.error && state.error.indexOf("歌词") >= 0) setStatus(libraryStatusText());
          }, 2600);
        }
      })
      .catch(function () {
        if (seq !== state.lyrics.seq) return;
        state.lyrics.loading = false;
        clearLyricsView("歌词请求失败");
      });
  }

  /**
   * Resolve the Unraid dashboard column element that owns our tile
   * (#db_box1/2/3 table, or parent of host). Used for width + placement.
   */
  function getDashColumnEl() {
    try {
      var host = document.getElementById("ucwc-music-dash-host");
      if (host) {
        var p = host.parentElement;
        if (p && p.id && /^db_?box[1-4]$/i.test(p.id)) return p;
        if (p && p.classList && p.classList.contains("dashboard")) return p;
        if (p && p.tagName === "TABLE") return p;
      }
      var boxes = document.querySelectorAll(
        "table#db_box1, table#db_box2, table#db_box3, table#db-box1, table#db-box2, table#db-box3, table.dashboard"
      );
      if (boxes && boxes.length) {
        // Prefer the box that currently contains the host
        var i;
        for (i = 0; i < boxes.length; i++) {
          if (host && boxes[i].contains(host)) return boxes[i];
        }
        return boxes[0];
      }
    } catch (e0) {}
    return null;
  }

  function measureDashColumnWidth() {
    var col = getDashColumnEl();
    var w = 0;
    try {
      if (col && col.getBoundingClientRect) w = col.getBoundingClientRect().width || 0;
    } catch (e0) {}
    if (w < 80) {
      try {
        var host = document.getElementById("ucwc-music-dash-host");
        if (host && host.getBoundingClientRect) w = host.getBoundingClientRect().width || 0;
      } catch (e1) {}
    }
    if (w < 80) {
      try {
        if (root && root.getBoundingClientRect) w = root.getBoundingClientRect().width || 0;
      } catch (e2) {}
    }
    return w;
  }

  function measureLongestTrackNeed() {
    var sample = "";
    var i;
    for (i = 0; i < state.tracks.length; i++) {
      var t = state.tracks[i];
      if (!t) continue;
      var label = (t.artist ? t.artist + " — " : "") + (t.title || t.id || "");
      if (label.length > sample.length) sample = label;
    }
    if (!sample) sample = "曲目列表";
    var fontSize = "12px";
    var lineHeight = "1.35";
    var fontFamily = "inherit";
    var fontWeight = "400";
    try {
      var ref =
        (els.list && els.list.querySelector(".ucwc-music-item-txt")) ||
        (els.list && els.list.querySelector(".ucwc-music-item")) ||
        (root && root.querySelector(".ucwc-music-item-txt")) ||
        root ||
        document.body;
      var cs = window.getComputedStyle(ref);
      if (cs) {
        if (cs.fontSize) fontSize = cs.fontSize;
        if (cs.lineHeight && cs.lineHeight !== "normal") lineHeight = cs.lineHeight;
        if (cs.fontFamily) fontFamily = cs.fontFamily;
        if (cs.fontWeight) fontWeight = cs.fontWeight;
      }
    } catch (eFs) {}
    var probe = document.createElement("span");
    probe.style.cssText =
      "position:absolute;left:-99999px;top:0;visibility:hidden;white-space:nowrap;" +
      "font-size:" +
      fontSize +
      ";line-height:" +
      lineHeight +
      ";font-family:" +
      fontFamily +
      ";font-weight:" +
      fontWeight +
      ";padding:0;letter-spacing:normal;";
    probe.textContent = sample;
    document.body.appendChild(probe);
    var textW = probe.getBoundingClientRect().width || probe.offsetWidth || 0;
    try {
      document.body.removeChild(probe);
    } catch (eRm) {}
    // item pad + gap + 词 badge + scrollbar + CJK fudge
    return Math.ceil(textW + 16 + 6 + 26 + 12 + 8);
  }

  /**
   * Fit dual-pane widths to the live dashboard column (2-col vs 3-col differ).
   * Card is width:100% like other Unraid tiles.
   * Left stays fixed at LEFT_W_IDEAL when possible; right absorbs ALL residual width
   * (no 280 hard cap — fills the blank strip beside list/lyrics).
   */
  function fitDashColumnLayout() {
    try {
      if (!root || !root.isConnected) return;
      var main = root.querySelector(".ucwc-music-main");
      if (!main) return;
      var colW = measureDashColumnWidth();
      var inner = colW > 40 ? Math.max(0, colW - BODY_PAD_X) : 0;
      // contentNeed only floors the right pane (min readable list width), never caps it
      var contentNeed = measureLongestTrackNeed();
      var rightFloor = Math.max(RIGHT_W_MIN, Math.min(contentNeed, 420));
      var leftW = LEFT_W_IDEAL;
      var rightW = Math.max(RIGHT_W_MIN, rightFloor);
      var stack = false;

      if (inner > 0) {
        var dualMin = LEFT_W_MIN + PANE_GAP + RIGHT_W_MIN;
        if (inner < dualMin + 8) {
          // Column too narrow for side-by-side — stack; each pane full inner width
          stack = true;
          leftW = Math.max(LEFT_W_MIN, Math.floor(inner));
          rightW = Math.max(RIGHT_W_MIN, Math.floor(inner));
        } else {
          // Fixed left at ideal; right = residual. Shrink left only if residual < floor.
          leftW = LEFT_W_IDEAL;
          rightW = Math.floor(inner - leftW - PANE_GAP);
          if (rightW < rightFloor) {
            // Try keep content-readable right by shrinking left toward LEFT_W_MIN
            leftW = Math.max(LEFT_W_MIN, Math.floor(inner - PANE_GAP - rightFloor));
            rightW = Math.floor(inner - leftW - PANE_GAP);
          }
          if (rightW < RIGHT_W_MIN) {
            rightW = RIGHT_W_MIN;
            leftW = Math.max(LEFT_W_MIN, Math.floor(inner - PANE_GAP - rightW));
          }
          // Final clamp: never overflow inner
          if (leftW + PANE_GAP + rightW > inner) {
            rightW = Math.max(RIGHT_W_MIN, Math.floor(inner - leftW - PANE_GAP));
            if (leftW + PANE_GAP + rightW > inner) {
              leftW = Math.max(LEFT_W_MIN, Math.floor(inner - PANE_GAP - rightW));
            }
          }
        }
      }

      if (stack) root.classList.add("ucwc-music-stack-panes");
      else root.classList.remove("ucwc-music-stack-panes");

      main.style.setProperty("--ucwc-music-left-w", Math.round(leftW) + "px");
      main.style.setProperty("--ucwc-music-right-w", Math.round(rightW) + "px");
      root.style.setProperty("--ucwc-music-left-w", Math.round(leftW) + "px");
      root.style.setProperty("--ucwc-music-right-w", Math.round(rightW) + "px");
    } catch (e0) {}
  }

  /** @deprecated name kept as alias for call sites */
  function fitRightPane() {
    fitDashColumnLayout();
  }

  function scheduleFitRightPane() {
    if (rightPaneFitTimer) clearTimeout(rightPaneFitTimer);
    rightPaneFitTimer = setTimeout(function () {
      rightPaneFitTimer = 0;
      fitDashColumnLayout();
      scheduleMarqueeRefresh();
    }, 40);
  }

  function renderList() {
    if (!els.list) return;
    els.list.innerHTML = "";
    var q = (state.listFilter || "").trim();
    var order = sortedTrackIndices(q);
    var shown = order.length;
    var oi;
    var renderCount = Math.min(order.length, Math.max(300, Number(state.listRenderLimit) || 300));
    for (oi = 0; oi < renderCount; oi++) {
      var i = order[oi];
      var t = state.tracks[i];
      if (!t) continue;
      var b = document.createElement("button");
      b.type = "button";
      b.className = "ucwc-music-item" + (i === state.index ? " active" : "");
      b.setAttribute("data-i", String(i));
      var label;
      if (normalizeListSort(state.listSort) === "path") {
        label = t.id || t.title || "";
      } else if (normalizeListSort(state.listSort) === "title") {
        label = (t.title || t.id || "") + (t.artist ? " — " + t.artist : "");
      } else if (normalizeListSort(state.listSort) === "size") {
        label =
          (t.artist ? t.artist + " — " : "") +
          (t.title || t.id || "") +
          (t.size ? " · " + formatBytes(t.size) : "");
      } else {
        label = (t.artist ? t.artist + " — " : "") + (t.title || t.id);
      }
      var txt = document.createElement("span");
      txt.className = "ucwc-music-item-txt";
      fillMarquee(txt, label);
      b.appendChild(txt);
      var hasLrc = !!(t.has_lrc || t.hasLrc);
      var hasCover = !!(t.has_cover || t.hasCover);
      if (hasLrc || hasCover) {
        var badges = document.createElement("span");
        badges.className = "ucwc-music-item-badges";
        if (hasLrc) {
          var badgeL = document.createElement("span");
          badgeL.className = "ucwc-music-item-lrc";
          badgeL.title = "有歌词";
          badgeL.textContent = "词";
          badges.appendChild(badgeL);
        }
        if (hasCover) {
          var badgeC = document.createElement("span");
          badgeC.className = "ucwc-music-item-cover";
          badgeC.title = "有封面";
          badgeC.textContent = "封";
          badges.appendChild(badgeC);
        }
        b.appendChild(badges);
      }
      els.list.appendChild(b);
    }
    if (renderCount < order.length) {
      var more = document.createElement("button");
      more.type = "button";
      more.className = "ucwc-music-list-more";
      more.textContent = "继续显示（" + renderCount + "/" + order.length + "）";
      els.list.appendChild(more);
    }
    if (q && shown === 0 && state.tracks.length) {
      var empty = document.createElement("div");
      empty.className = "ucwc-music-list-empty";
      empty.textContent = "无匹配曲目";
      els.list.appendChild(empty);
    }
    if (els.sideFilterCount) {
      if (q) els.sideFilterCount.textContent = shown + "/" + state.tracks.length;
      else els.sideFilterCount.textContent = "";
    }
    syncSortBtn();
    scheduleFitRightPane();
    scheduleMarqueeRefresh();
  }

  /**
   * Recreate the <audio> element after MEDIA_ERR / demuxer seek failures.
   * Sticky error state blocks all subsequent play() until src is rebuilt.
   * Common on mobile + FLAC over CIFS when mid-track currentTime seek fails.
   */
  function hardResetAudio(reason) {
    // Ignore late callbacks from the audio element being retired.
    playAttemptToken++;
    stopLyricsRaf();
    var old = audio;
    var oldVol = state.volume;
    var oldId = lastSrcId;
    try {
      if (old) {
        try {
          old.pause();
        } catch (e0) {}
        try {
          old.removeAttribute("src");
          old.load();
        } catch (e1) {}
        try {
          if (old.parentNode) old.parentNode.removeChild(old);
        } catch (e2) {}
      }
    } catch (e3) {}
    audio = null;
    lastSrcId = "";
    resumeLockId = "";
    audioGen++;
    var a = ensureAudio();
    try {
      a.volume = oldVol;
    } catch (e4) {}
    // Re-prime same track if we still know it — caller may override
    if (oldId && state.tracks.length) {
      var idx = state.index;
      for (var i = 0; i < state.tracks.length; i++) {
        if (state.tracks[i] && state.tracks[i].id === oldId) {
          idx = i;
          break;
        }
      }
      state.index = idx;
    }
    try {
      if (reason) setStatus("");
    } catch (e5) {}
    return a;
  }

  function audioHasError(a) {
    try {
      return !!(a && a.error);
    } catch (e0) {
      return false;
    }
  }

  function isAutoplayPolicyError(err) {
    try {
      var name = String((err && err.name) || "");
      var msg = String((err && err.message) || "").toLowerCase();
      return name === "NotAllowedError" || /user gesture|user interaction|not allowed/.test(msg);
    } catch (e0) {
      return false;
    }
  }

  function ensureAudio() {
    if (audio && !audio.isConnected) {
      /* Prefer the live node created by an Unraid dashboard repaint. */
      try {
        var liveAudio = document.querySelector("audio[data-ucwc-music-audio='1']") || document.querySelector("audio");
        audio = liveAudio || null;
      } catch (eFindAudio) {
        audio = null;
      }
    }
    if (audio) return audio;
    try {
      audio = document.querySelector("audio[data-ucwc-music-audio='1']") || document.querySelector("audio");
    } catch (eExistingAudio) {
      audio = null;
    }
    if (!audio) audio = new Audio();
    audio.setAttribute("data-ucwc-music-audio", "1");
    audio.preload = "auto";
    try {
      audio.setAttribute("playsinline", "true");
      audio.setAttribute("webkit-playsinline", "true");
      audio.setAttribute("x-webkit-airplay", "allow");
      audio.playsInline = true;
      // Help mobile: keep element in DOM (some WebViews treat detached Audio stricter)
      audio.setAttribute("controls", "false");
      audio.controls = false;
      audio.style.cssText = "position:fixed;width:0;height:0;opacity:0;pointer-events:none;left:-99px;top:-99px;";
      if (!audio.parentNode && document.body) document.body.appendChild(audio);
    } catch (ePI) {}
    audio.volume = state.volume;
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("loadedmetadata", onTime);
    audio.addEventListener("seeked", function () {
      syncLyrics(true);
    });
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("play", function (ev) {
      if (ev && ev.currentTarget !== audio) return;
      autoplayPolicyBlocked = false;
      state.playing = true;
      mediaUnlocked = true;
      clearPlayRetries();
      markPendingResume(false);
      clearPlaybackProgressStatus();
      updateMediaSessionMeta();
      resumeIntent = true;
      updatePlayBtn();
      savePlaySession(true);
      gestureResumeWanted = false;
      // Off-dash: keep mini chip visible while playing
      syncSitewideChip();
      updateChipUi();
      startLyricsRaf();
      syncLyrics(true);
    });
    audio.addEventListener("pause", function (ev) {
      if (ev && ev.currentTarget !== audio) return;
      state.playing = false;
      stopLyricsRaf();
      // Always refresh button from real audio (paused → show play).
      // Keep session intent only while autoplay-retry is still in progress.
      if (pendingResume && resumeIntent) {
        if (isSitewidePlay()) savePlaySession(true);
        updatePlayBtn();
        syncSitewideChip();
        updateChipUi();
        return;
      }
      updatePlayBtn();
      if (resumeIntent && isSitewidePlay() && !audio.paused) {
        savePlaySession(true);
      } else if (resumeIntent && isSitewidePlay()) {
        // Paused but may still want gesture resume — store intent without claiming live play
        savePlaySession(false);
        try {
          var sess = loadPlaySession() || {};
          writePlaySession({
            playing: false,
            intent: true,
            index: typeof sess.index === "number" ? sess.index : state.index,
            t: audio && isFinite(audio.currentTime) ? audio.currentTime : sess.t || 0,
            id: (current() && current().id) || sess.id || "",
            vol: state.volume,
            sitewide: isSitewidePlay(),
            ts: Date.now(),
          });
        } catch (eS) {}
      } else {
        savePlaySession(false);
      }
      syncSitewideChip();
      updateChipUi();
    });
    audio.addEventListener("error", function (ev) {
      if (ev && ev.currentTarget !== audio) return;
      // MEDIA_ERR_NETWORK/DECODE often = FLAC demuxer seek fail over SMB — recoverable
      var code = 0;
      try {
        code = (audio && audio.error && audio.error.code) || 0;
      } catch (eC) {}
      state.playing = false;
      updatePlayBtn();
      if (resumeIntent || gestureResumeWanted || sessionWantsResume(loadPlaySession())) {
        setStatus(isCoarsePointer() ? "点一下续播（已自动恢复音轨）" : "正在恢复播放…");
        savePlaySession(true);
        // Drop sticky error element, then retry from a safe position
        try {
          var keepT = pendingSeekTo > 0.5 ? pendingSeekTo : 0;
          // Mid-track FLAC seek is the usual failure; fall back toward start after error
          if (keepT > 15) keepT = Math.min(keepT, 3);
          else if (keepT > 3) keepT = 0;
          hardResetAudio("media-error-" + code);
          pendingSeekTo = keepT;
          gestureResumeWanted = true;
          markPendingResume(true);
          bindGestureUnlock();
          schedulePlayRetries("media-error");
        } catch (eRec) {
          setStatus("播放失败（格式或路径）");
          savePlaySession(!!resumeIntent);
        }
      } else {
        setStatus("播放失败（格式或路径）");
        savePlaySession(false);
      }
    });
    return audio;
  }

  function paintProgressTo(card, cur, dur) {
    try {
      var nodes = [];
      if (card && card.querySelectorAll) {
        var list = card.querySelectorAll(".ucwc-music-time.cur, .ucwc-music-time.end, .ucwc-music-seek");
        for (var i = 0; i < list.length; i++) nodes.push(list[i]);
      }
      // Also paint every live card on the page (guards against duplicate/stale id trees).
      try {
        var allCards = document.querySelectorAll("#ucwc-music-card, .ucwc-dash-music-tile");
        for (var c = 0; c < allCards.length; c++) {
          var sub = allCards[c].querySelectorAll(".ucwc-music-time.cur, .ucwc-music-time.end, .ucwc-music-seek");
          for (var j = 0; j < sub.length; j++) nodes.push(sub[j]);
        }
      } catch (eAll) {}
      var seen = typeof Set !== "undefined" ? new Set() : null;
      var curTxt = fmt(cur);
      var durTxt = isFinite(dur) ? fmt(dur) : "0:00";
      var seekVal = isFinite(dur) && dur > 0 ? String(Math.round((cur / dur) * 1000)) : null;
      for (var k = 0; k < nodes.length; k++) {
        var el = nodes[k];
        if (!el) continue;
        if (seen) {
          if (seen.has(el)) continue;
          seen.add(el);
        }
        try {
          if (el.classList && el.classList.contains("cur")) {
            el.textContent = curTxt;
            els.cur = el;
          } else if (el.classList && el.classList.contains("end")) {
            el.textContent = durTxt;
            els.dur = el;
          } else if (el.classList && el.classList.contains("ucwc-music-seek") && seekVal != null) {
            el.value = seekVal;
            try {
              el.setAttribute("value", seekVal);
              el.setAttribute("aria-valuenow", seekVal);
            } catch (eA) {}
            els.seek = el;
          }
        } catch (eN) {}
      }
    } catch (e0) {}
  }

  function onTime() {
    if (!audio) return;
    // seeking blocks user-drag repaint races; never stick forever (mobile touchend loss).
    if (seeking) {
      if (!seekingSince) seekingSince = Date.now();
      if (Date.now() - seekingSince < 1500) {
        schedulePlayPersist();
        return;
      }
      seeking = false;
      seekingSince = 0;
    } else {
      seekingSince = 0;
    }
    // Stale card after full navigation: drop refs so next mount rebuilds UI against live audio.
    if (root && !cardDomLive()) {
      ensureLiveCardRefs();
    }
    var cur = audio.currentTime || 0;
    var dur = audio.duration || 0;
    var liveCard = null;
    try {
      liveCard = document.getElementById("ucwc-music-card");
    } catch (eL) {}
    if (liveCard && root && liveCard !== root) {
      // Dashboard re-rendered a clone (duplicate id). Prefer our instrumented root.
      try {
        if (root.isConnected) {
          if (liveCard.parentNode) liveCard.parentNode.removeChild(liveCard);
          liveCard = root;
        } else if (liveCard.isConnected) {
          // Adopt visible node and rebind; listeners may be missing → mount rebuilds soon.
          root = liveCard;
          rebindCardEls();
        }
      } catch (eDup) {}
    } else if (liveCard && !root) {
      root = liveCard;
      rebindCardEls();
    }
    paintProgressTo(liveCard || root, cur, dur);
    syncLyrics(false);
    schedulePlayPersist();
  }

  function onEnded() {
    stopLyricsRaf();
    if (state.repeat === "one") {
      playAt(state.index, true);
      return;
    }
    next(true);
  }

  /** Best-effort play against autoplay policy: try normal, then muted-then-unmute. */
  function tryPlayUnlocked(a, onBlocked) {
    if (!a) return;
    // Sticky MEDIA_ERR blocks play() forever — rebuild element first
    if (audioHasError(a)) {
      try {
        var keep = pendingSeekTo > 0.5 ? pendingSeekTo : a.currentTime || 0;
        // Demuxer seek failures: prefer start-near-zero over broken mid-seek
        if (keep > 12) keep = 0;
        a = hardResetAudio("tryPlay-error");
        var t0 = current();
        if (t0) {
          lastSrcId = t0.id;
          a.src = trackUrl(t0.id);
          try {
            a.load();
          } catch (eL0) {}
        }
        pendingSeekTo = keep > 0.5 ? keep : 0;
      } catch (eHR) {}
    }
    var attemptToken = ++playAttemptToken;
    function isCurrentAttempt() {
      return attemptToken === playAttemptToken && a === audio;
    }
    function ok() {
      if (!isCurrentAttempt()) return;
      autoplayPolicyBlocked = false;
      try {
        if (document.visibilityState === "hidden" && !isSitewidePlay()) {
          a.pause();
          return;
        }
      } catch (eVis) {}
      try {
        if (a.muted) a.muted = false;
      } catch (e0) {}
      try {
        a.volume = state.volume;
      } catch (e1) {}
      // Soft re-seek only if already playing cleanly; never force mid-track seek on FLAC error path
      try {
        if (
          pendingSeekTo > 1 &&
          a &&
          isFinite(a.duration) &&
          a.duration > 0 &&
          (a.currentTime || 0) < 0.75 &&
          !audioHasError(a)
        ) {
          try {
            a.currentTime = Math.min(pendingSeekTo, Math.max(0, a.duration - 0.25));
          } catch (eSk) {
            pendingSeekTo = a.currentTime || 0;
          }
        } else if (pendingSeekTo > 0 && a && Math.abs((a.currentTime || 0) - pendingSeekTo) < 2.5) {
          pendingSeekTo = a.currentTime;
        }
      } catch (eSeek2) {}
      clearPlayRetries();
      markPendingResume(false);
      gestureResumeWanted = false;
      state.playing = true;
      clearPlaybackProgressStatus();
      updatePlayBtn();
      savePlaySession(true);
      syncSitewideChip();
      updateChipUi();
      updateMediaSessionMeta();
    }
    function fail(playError) {
      if (!isCurrentAttempt()) return;
      if (isAutoplayPolicyError(playError)) autoplayPolicyBlocked = true;
      markPendingResume(true);
      if (typeof onBlocked === "function") onBlocked(playError);
      else {
        gestureResumeWanted = true;
        bindGestureUnlock();
        schedulePlayRetries("blocked");
      }
      updatePlayBtn();
    }
    var p;
    try {
      a.muted = false;
      a.volume = state.volume;
      p = a.play();
    } catch (eP) {
      p = null;
    }
    if (p && typeof p.then === "function") {
      p.then(ok).catch(function (firstError) {
        // muted unlock path (Chrome sometimes allows muted autoplay after prior media engagement)
        try {
          a.muted = true;
          a.volume = 0;
        } catch (eM) {}
        var p2;
        try {
          p2 = a.play();
        } catch (e2) {
          p2 = null;
        }
        if (p2 && typeof p2.then === "function") {
          p2
            .then(function () {
              // ramp unmute shortly — may still require gesture on strict browsers
              setTimeout(function () {
                try {
                  a.muted = false;
                  a.volume = state.volume;
                } catch (eU) {}
                if (a.paused) fail(firstError);
                else ok();
              }, 30);
            })
            .catch(fail);
        } else {
          fail(firstError);
        }
      });
    } else if (a && !a.paused) {
      ok();
    } else {
      fail();
    }
  }

  function playAt(idx, autoPlay, startAt) {
    if (!state.tracks.length) return;
    state.index = ((idx % state.tracks.length) + state.tracks.length) % state.tracks.length;
    var t = current();
    if (!t) return;
    // Reflect the selected track before network, disk wake or media metadata.
    syncTransportSurfaces(true);
    var a = ensureAudio();
    var seekTo = typeof startAt === "number" && isFinite(startAt) && startAt > 0 ? startAt : 0;
    if (seekTo > 0.5) pendingSeekTo = seekTo;
    else if (lastSrcId === t.id && pendingSeekTo > 0.5) seekTo = pendingSeekTo;

    // Collapse duplicate resume calls (stops title/list cycling flash)
    // Never short-circuit when audio is in sticky error state
    if (
      resumeLockId &&
      resumeLockId === t.id &&
      lastSrcId === t.id &&
      a.src &&
      !audioHasError(a) &&
      Math.abs((pendingSeekTo || 0) - (seekTo || 0)) < 1.5
    ) {
      if (autoPlay && a.paused) {
        resumeIntent = true;
        tryPlayUnlocked(a);
      }
      return;
    }
    if (autoPlay || seekTo > 0.5) resumeLockId = t.id;

    var gen = ++audioGen;
    var applied = false;
    var needLoad = lastSrcId !== t.id || !a.src;
    // Rebuild if sticky error or same-src resume after demuxer failure
    if (audioHasError(a)) {
      a = hardResetAudio("playAt-error");
      needLoad = true;
    }
    if (needLoad) {
      lastSrcId = t.id;
      try { a.pause(); } catch (eP) {}
      a.src = trackUrl(t.id);
      try { a.load(); } catch (eL) {}
    }

    function applySeekOnly() {
      var target = pendingSeekTo > 0.5 ? pendingSeekTo : seekTo;
      if (!(target > 0.25)) return true;
      // If element already errored, skip seek — caller will hard-reset
      if (audioHasError(a)) return true;
      // Fresh document + large mid-track FLAC seek over CIFS often never produces duration.
      // Prefer start-near-zero; cross-page continuity is best-effort.
      try {
        var ext = "";
        try {
          ext = String((t && (t.ext || t.id)) || "").toLowerCase();
        } catch (eX) {}
        var isFlac = ext.indexOf("flac") >= 0 || /\.flac(?:$|\?)/i.test(ext);
        if (isFlac && target > 8 && (a.readyState || 0) < 2 && !(isFinite(a.duration) && a.duration > 0)) {
          // Don't block play waiting for an unreliable mid-seek
          pendingSeekTo = 0;
          seekTo = 0;
          return true;
        }
      } catch (eFl) {}
      try {
        if (isFinite(a.duration) && a.duration > 0) {
          var capped = Math.min(target, Math.max(0, a.duration - 0.25));
          if (Math.abs((a.currentTime || 0) - capped) > 0.75) {
            try {
              a.currentTime = capped;
            } catch (eSet) {
              // FLAC demuxer seek often throws / sticky-errors over SMB — abandon mid-seek
              pendingSeekTo = 0;
              seekTo = 0;
              return true;
            }
          }
          // If seek put element into error, abandon target so play can restart at 0
          if (audioHasError(a)) {
            pendingSeekTo = 0;
            seekTo = 0;
            return true;
          }
          return Math.abs((a.currentTime || 0) - capped) < 1.5 || a.readyState >= 2;
        }
        // No duration yet: avoid forcing currentTime on FLAC (demuxer sticky fail). Play from 0.
        if (target > 3) {
          pendingSeekTo = 0;
          seekTo = 0;
          return true;
        }
        try {
          a.currentTime = target;
        } catch (eEarly) {
          pendingSeekTo = 0;
          seekTo = 0;
          return true;
        }
        return false;
      } catch (e0) {
        pendingSeekTo = 0;
        seekTo = 0;
        return true; // proceed to play from start rather than block forever
      }
    }

    function onReady() {
      applySeekAndMaybePlay();
    }

    function onSeekedGate() {
      if (gen !== audioGen) return;
      try { a.removeEventListener("seeked", onSeekedGate); } catch (eS) {}
      if (!applied) applySeekAndMaybePlay();
    }

    function finishAfterSeek() {
      if (gen !== audioGen) return;
      applied = true;
      try {
        a.removeEventListener("loadedmetadata", onReady);
        a.removeEventListener("canplay", onReady);
        a.removeEventListener("seeked", onSeekedGate);
      } catch (eR) {}
      updateMeta();
      renderList();
      if (autoPlay) {
        resumeIntent = true;
        var targetPos = pendingSeekTo > 0.5 ? pendingSeekTo : seekTo;
        if (!(a && !a.paused && lastSrcId === t.id && Math.abs((a.currentTime || 0) - (targetPos || 0)) < 1.5 && targetPos > 0)) {
          tryPlayUnlocked(a, function (playError) {
            if (gen !== audioGen) return;
            markPendingResume(true);
            resumeIntent = true;
            state.playing = false;
            updatePlayBtn();
            var tt = targetPos;
            if (a && isFinite(a.currentTime) && a.currentTime > 0.5) tt = a.currentTime;
            if (!(tt > 0.5) && pendingSeekTo > 0.5) tt = pendingSeekTo;
            writePlaySession({
              playing: true,
              intent: true,
              index: state.index,
              t: tt || 0,
              id: t.id || "",
              vol: state.volume,
              sitewide: isSitewidePlay(),
              ts: Date.now(),
            });
            gestureResumeWanted = true;
            bindGestureUnlock();
            if (isAutoplayPolicyError(playError)) autoplayPolicyBlocked = true;
            else schedulePlayRetries("autoplay-block");
            if (isDashboard()) {
              setStatus(isAutoplayPolicyError(playError) ? "点一下播放以续播" : "正在尝试自动续播…");
            }
            else {
              setStatus("");
              syncSitewideChip(isAutoplayPolicyError(playError) ? "点一下播放以续播" : "续播中…点播放可解锁");
            }
            updateChipUi();
          });
        }
        // Stall watchdog: play() may resolve while FLAC never exposes duration after mid-seek
        setTimeout(function () {
          if (gen !== audioGen) return;
          recoverStalledPlayback("playAt-1");
        }, 1800);
        setTimeout(function () {
          if (gen !== audioGen) return;
          recoverStalledPlayback("playAt-2");
        }, 3600);
      }
      // Save AFTER seek — never early-write t=0
      savePlaySession(!!autoPlay || !!(audio && !audio.paused));
      syncSitewideChip();
      updateChipUi();
      updateMediaSessionMeta();
      try {
        onTime();
      } catch (eOt2) {}
    }

    function applySeekAndMaybePlay() {
      if (gen !== audioGen || applied) return;
      var needSeek = pendingSeekTo > 0.5 || seekTo > 0.5;
      if (needSeek && !(isFinite(a.duration) && a.duration > 0) && a.readyState < 1) return;
      var seekOk = applySeekOnly();
      if (needSeek && !seekOk) {
        try {
          a.addEventListener("seeked", onSeekedGate);
          a.addEventListener("canplay", onReady);
        } catch (e2) {}
        setTimeout(function () {
          if (gen !== audioGen || applied) return;
          applySeekOnly();
          finishAfterSeek();
        }, 140);
        return;
      }
      finishAfterSeek();
    }

    updateMeta();
    loadLyricsForCurrent();
    loadCoverForCurrent();
    saveLs();
    if (autoPlay) resumeIntent = true;
    // IMPORTANT: do not savePlaySession here (would write t=0 and break cross-page resume)

    if (needLoad) {
      a.addEventListener("loadedmetadata", onReady);
      a.addEventListener("canplay", onReady);
      setTimeout(function () {
        if (gen !== audioGen || applied) return;
        if (a.readyState >= 1 && isFinite(a.duration) && a.duration > 0) applySeekAndMaybePlay();
      }, 30);
    } else {
      applySeekAndMaybePlay();
    }
  }

  function resolveSessionIndex(sess) {
    var idx = typeof sess.index === "number" ? sess.index : state.index;
    if (sess.id) {
      for (var i = 0; i < state.tracks.length; i++) {
        if (state.tracks[i] && state.tracks[i].id === sess.id) {
          idx = i;
          break;
        }
      }
    }
    if (idx < 0 || idx >= state.tracks.length) idx = 0;
    return idx;
  }

  function sessionWantsResume(sess) {
    if (!sess) return false;
    return !!(sess.playing || sess.intent);
  }

  function tryResumeFromSession(forcePlay) {
    if (!state.tracks.length) return false;
    if (!isDashboard() && !isSitewidePlay()) return false;
    var sess = resumePending || loadPlaySession();
    if (!sessionWantsResume(sess) && !resumeIntent) return false;
    if (!sess && resumeIntent) {
      // keep current position if same engine still has audio
      var curT = audio && isFinite(audio.currentTime) ? audio.currentTime : 0;
      playAt(state.index, true, curT);
      return true;
    }
    var idx = resolveSessionIndex(sess);
    var t = sess && typeof sess.t === "number" ? sess.t : 0;
    if ((!t || t < 0.5) && audio && lastSrcId && sess && sess.id === lastSrcId && isFinite(audio.currentTime)) {
      t = audio.currentTime;
    }
    resumeIntent = true;
    playAt(idx, forcePlay !== false, t);
    return true;
  }

  function togglePlay() {
    if (!state.tracks.length) {
      setStatus(sourceLabelText() === "Navidrome" ? "Navidrome 曲库暂无曲目" : "无曲目，请检查本地目录");
      return;
    }
    /* No-host architecture: sitewide (chip) playback uses the same inline
     * <audio> element as the dashboard card, so it must fall through to the
     * normal toggle path instead of delegating to a host window. */
    var a = ensureAudio();
    if (!a.src) {
      // User clicked play — still in gesture; prime + play sync path
      unlockMediaPipeline();
      primeAudioTrack(state.index, pendingSeekTo > 0.5 ? pendingSeekTo : 0);
      playAt(state.index, true);
      return;
    }
    if (a.paused) {
      autoplayPolicyBlocked = false;
      resumeIntent = true;
      markPendingResume(false);
      unlockMediaPipeline();
      // Prefer direct play in this click gesture (mobile)
      tryPlayUnlocked(a, function () {
        setStatus("无法播放");
        gestureResumeWanted = true;
        resumeIntent = true;
        markPendingResume(true);
        savePlaySession(true);
        bindGestureUnlock();
        updatePlayBtn();
        if (isSitewidePlay()) {
          showResumeChip("继续播放");
        }
      });
    } else {
      // Invalidate any older play() promise before honoring explicit pause.
      playAttemptToken++;
      resumeIntent = false;
      gestureResumeWanted = false;
      markPendingResume(false);
      clearPlayRetries();
      a.pause();
      state.playing = false;
      savePlaySession(false);
      updatePlayBtn();
    }
  }

  /** One transport path for card, chip and future hardware/media controls. */
  function runTransportAction(action, ev, userGesture) {
    try {
      if (ev) {
        ev.preventDefault();
        ev.stopPropagation();
      }
    } catch (e0) {}
    var fromGesture = !!ev || userGesture === true;
    if (action === "prev") {
      prev();
      return true;
    }
    if (action === "next") {
      next(false);
      return true;
    }
    if (action === "play") {
      togglePlay();
      syncTransportSurfaces(false);
      return true;
    }
    return false;
  }

  function next(fromEnded) {
    if (!state.tracks.length) return;
    pendingSeekTo = 0;
    resumeLockId = "";
    var n;
    if (state.shuffle && state.tracks.length > 1) {
      n = state.index;
      var guard = 0;
      while (n === state.index && guard++ < 20) {
        n = Math.floor(Math.random() * state.tracks.length);
      }
    } else {
      n = state.index + 1;
      if (n >= state.tracks.length) {
        if (state.repeat === "all" || (fromEnded && state.repeat === "all")) n = 0;
        else if (fromEnded && state.repeat === "off") {
          state.playing = false;
          resumeIntent = false;
          updatePlayBtn();
          clearPlaySession();
          // Sitewide: keep in-page chip visible (paused), never tear down overlay
          if (isSitewidePlay()) syncSitewideChip();
          else hideResumeChip();
          return;
        } else if (!fromEnded) n = 0;
        else {
          state.playing = false;
          resumeIntent = false;
          updatePlayBtn();
          clearPlaySession();
          if (isSitewidePlay()) syncSitewideChip();
          else hideResumeChip();
          return;
        }
      }
    }
    playAt(n, true);
  }

  function prev() {
    if (!state.tracks.length) return;
    /* The dashboard control is explicitly labelled “上一首”. Restarting the
     * current track after three seconds made the first click appear broken. */
    pendingSeekTo = 0;
    resumeLockId = "";
    var n = state.index - 1;
    if (n < 0) n = state.tracks.length - 1;
    playAt(n, true);
  }

  /**
   * Unraid dashboard columns are table#db_box1/2/3 (class=dashboard).
   * Real tiles are tbody.sortable children — sortable connectWith those tables.
   * Prefer that model so width follows column like Docker/System tiles.
   */
  function listDashBoxTables() {
    var out = [];
    var sels = [
      "table#db_box1",
      "table#db_box2",
      "table#db_box3",
      "table#db-box1",
      "table#db-box2",
      "table#db-box3",
      "table.dashboard",
    ];
    var seen = {};
    var i, el, id;
    for (i = 0; i < sels.length; i++) {
      try {
        var nodes = document.querySelectorAll(sels[i]);
        var j;
        for (j = 0; j < nodes.length; j++) {
          el = nodes[j];
          if (!el || !el.isConnected) continue;
          id = el.id ? String(el.id) : "anon-" + i + "-" + j;
          if (seen[id] && el.id) continue;
          if (el.id) seen[id] = true;
          else {
            // de-dupe anonymous table.dashboard nodes by object identity via index list
            var dup = false;
            var k;
            for (k = 0; k < out.length; k++) {
              if (out[k] === el) {
                dup = true;
                break;
              }
            }
            if (dup) continue;
          }
          out.push(el);
        }
      } catch (e0) {}
    }
    return out;
  }

  function isDashBoxTable(el) {
    if (!el || !el.tagName || el.tagName !== "TABLE") return false;
    if (el.classList && el.classList.contains("dashboard")) return true;
    if (el.id && /^db_?box[1-4]$/i.test(el.id)) return true;
    return false;
  }

  /** Prefer a real dashboard column table so the card floats with other tiles. */
  function findDashHost() {
    var saved = readDashPos();
    var wrapLive = null;
    try {
      wrapLive = document.getElementById("ucwc-music-dash-host");
    } catch (eW) {}
    // 0) If wrap already sits in a live dashboard table, keep that column
    if (wrapLive && wrapLive.parentNode && wrapLive.parentNode.isConnected) {
      if (isDashBoxTable(wrapLive.parentNode)) return wrapLive.parentNode;
      // Legacy: wrap was a div under some parent — climb to table.dashboard if possible
      try {
        var climb = wrapLive.parentNode;
        var g = 0;
        while (climb && g++ < 5) {
          if (isDashBoxTable(climb)) return climb;
          climb = climb.parentNode;
        }
      } catch (eC) {}
      return wrapLive.parentNode;
    }
    // 1) Restore into the same parent column if still present
    if (saved && saved.parentId) {
      try {
        var pref = document.getElementById(saved.parentId);
        if (pref && pref.isConnected) return pref;
      } catch (e0) {}
    }
    if (saved && saved.prevId) {
      try {
        var prevEl = document.getElementById(saved.prevId);
        if (prevEl && prevEl.parentNode && prevEl.parentNode.isConnected) return prevEl.parentNode;
      } catch (e1) {}
    }
    if (saved && saved.nextId) {
      try {
        var nextEl = document.getElementById(saved.nextId);
        if (nextEl && nextEl.parentNode && nextEl.parentNode.isConnected) return nextEl.parentNode;
      } catch (e2) {}
    }
    // 2) Unraid multi-column boxes — prefer box with most tbody tiles (not always box1)
    var boxes = listDashBoxTables();
    var best = null;
    var bestScore = -1;
    var i, el;
    for (i = 0; i < boxes.length; i++) {
      el = boxes[i];
      try {
        var tbodys = el.querySelectorAll ? el.querySelectorAll(":scope > tbody") : el.getElementsByTagName("tbody");
        var score = tbodys ? tbodys.length : el.children ? el.children.length : 0;
        // slight preference for later columns so first install is not always top-left alone
        if (i >= 1) score += 0.25;
        if (score > bestScore) {
          bestScore = score;
          best = el;
        }
      } catch (e3) {}
    }
    if (best) return best;
    // 3) Last resort outer hosts
    var fallbacks = ["#db-box", "#db_box", "#dashboard", "div#content", "#template", "#wrapper"];
    for (i = 0; i < fallbacks.length; i++) {
      try {
        el = document.querySelector(fallbacks[i]);
        if (el) return el;
      } catch (e5) {}
    }
    return null;
  }

  function musicDashSortKey() {
    return "ucwc_theme_music_tile_v1";
  }

  /**
   * Build host as tbody.sortable (Unraid native tile unit) when parent is #db_boxN.
   * Fallback: div host for non-table parents.
   */
  function ensureDashHostElement(host) {
    var wrap = document.getElementById("ucwc-music-dash-host");
    var wantTbody = !!(host && isDashBoxTable(host));
    if (wrap) {
      var isTbody = wrap.tagName === "TBODY";
      var isDiv = wrap.tagName === "DIV";
      // Migrate legacy div → tbody when we now have a real dashboard table
      if (wantTbody && isDiv) {
        try {
          if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
        } catch (eRm) {}
        wrap = null;
      } else if (!wantTbody && isTbody) {
        try {
          if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
        } catch (eRm2) {}
        wrap = null;
      } else {
        return wrap;
      }
    }
    if (wantTbody) {
      wrap = document.createElement("tbody");
      wrap.id = "ucwc-music-dash-host";
      wrap.className = "sortable";
      wrap.setAttribute("sort", musicDashSortKey());
      wrap.setAttribute("title", "音乐");
      var tr = document.createElement("tr");
      var td = document.createElement("td");
      td.colSpan = 99;
      tr.appendChild(td);
      wrap.appendChild(tr);
    } else {
      wrap = document.createElement("div");
      wrap.id = "ucwc-music-dash-host";
    }
    return wrap;
  }

  function dashHostCardParent(wrap) {
    if (!wrap) return null;
    if (wrap.tagName === "TBODY") {
      var td = wrap.querySelector("td");
      return td || wrap;
    }
    return wrap;
  }

  function migrateDashPosKey() {
    try {
      if (localStorage.getItem(DASH_POS_KEY)) return;
      var legacy = localStorage.getItem("ucwc_music_dash_pos_v2") || localStorage.getItem("ucwc_music_dash_pos_v1");
      if (legacy) localStorage.setItem(DASH_POS_KEY, legacy);
    } catch (e0) {}
  }

  function isStrongDashPos(o) {
    if (!o || typeof o !== "object") return false;
    if (o.prevId || o.nextId || o.prevSort || o.nextSort) return true;
    if (typeof o.index === "number" && o.index > 0) return true;
    if (o.parentId && typeof o.index === "number" && o.total > 1) return true;
    return false;
  }

  function preferDashPos(a, b) {
    // Pick the better of two position memories (server vs local / old vs new).
    if (!a) return b || null;
    if (!b) return a;
    var aStrong = isStrongDashPos(a);
    var bStrong = isStrongDashPos(b);
    if (aStrong && !bStrong) return a;
    if (bStrong && !aStrong) return b;
    var ats = typeof a.ts === "number" ? a.ts : 0;
    var bts = typeof b.ts === "number" ? b.ts : 0;
    // Prefer non-top when timestamps are close (race to index 0)
    if (Math.abs(ats - bts) < 20000) {
      var ai = typeof a.index === "number" ? a.index : 0;
      var bi = typeof b.index === "number" ? b.index : 0;
      if (ai === 0 && bi > 0 && !(a.prevId || a.nextId)) return b;
      if (bi === 0 && ai > 0 && !(b.prevId || b.nextId)) return a;
    }
    return bts >= ats ? b : a;
  }

  function readDashPosLocal() {
    try {
      migrateDashPosKey();
      var raw = localStorage.getItem(DASH_POS_KEY);
      if (!raw) return null;
      var o = JSON.parse(raw);
      if (!o || typeof o !== "object") return null;
      return o;
    } catch (e0) {
      return null;
    }
  }

  function readDashPos() {
    return readDashPosLocal();
  }

  function writeDashPosLocal(payload) {
    try {
      localStorage.setItem(DASH_POS_KEY, JSON.stringify(payload));
    } catch (e0) {}
  }

  function pushDashPosServer(payload) {
    try {
      if (!payload || typeof payload !== "object") return;
      // Keep newest server push timestamp locally
      DASH_POS_SERVER_TS = payload.ts || Date.now();
      var body = JSON.stringify(payload);
      if (navigator.sendBeacon) {
        try {
          var blob = new Blob([body], { type: "application/json" });
          if (navigator.sendBeacon(apiBase + "?action=dash_pos", blob)) return;
        } catch (eB) {}
      }
      fetch(apiBase + "?action=dash_pos", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: body,
        keepalive: true,
      }).catch(function () {});
    } catch (e0) {}
  }

  function loadDashPosFromServer(cb) {
    try {
      fetch(apiBase + "?action=dash_pos&_ts=" + Date.now(), {
        credentials: "same-origin",
        headers: { Accept: "application/json" },
      })
        .then(function (r) {
          return r.json();
        })
        .then(function (j) {
          dashPosServerLoaded = true;
          var serverPos = j && j.ok && j.pos && typeof j.pos === "object" ? j.pos : null;
          if (serverPos) {
            var merged = preferDashPos(readDashPosLocal(), serverPos);
            if (merged) {
              writeDashPosLocal(merged);
              DASH_POS_SERVER_TS = merged.ts || Date.now();
            }
          }
          if (typeof cb === "function") cb(serverPos);
        })
        .catch(function () {
          dashPosServerLoaded = true;
          if (typeof cb === "function") cb(null);
        });
    } catch (e0) {
      dashPosServerLoaded = true;
      if (typeof cb === "function") cb(null);
    }
  }

  function dashSiblingTiles(parent, wrap) {
    // Among table children, Unraid uses tbody (+ occasional stopgap tr). Count tile-like siblings.
    var list = [];
    if (!parent || !parent.children) return list;
    var i, el;
    for (i = 0; i < parent.children.length; i++) {
      el = parent.children[i];
      if (!el) continue;
      if (el === wrap) {
        list.push(el);
        continue;
      }
      var tag = (el.tagName || "").toUpperCase();
      if (tag === "TBODY") list.push(el);
      else if (tag === "TR" && el.querySelector && el.querySelector("td.stopgap")) continue;
      else if (tag === "DIV" || tag === "SECTION" || tag === "ARTICLE") list.push(el);
    }
    return list;
  }

  function saveDashPos() {
    try {
      var wrap = document.getElementById("ucwc-music-dash-host");
      if (!wrap || !wrap.parentNode) return;
      var parent = wrap.parentNode;
      // Ignore transient detached / hidden states
      if (!parent.isConnected) return;
      var kids = parent.children;
      var tileKids = dashSiblingTiles(parent, wrap);
      var idx = -1;
      var i;
      for (i = 0; i < tileKids.length; i++) {
        if (tileKids[i] === wrap) {
          idx = i;
          break;
        }
      }
      if (idx < 0) {
        for (i = 0; i < kids.length; i++) {
          if (kids[i] === wrap) {
            idx = i;
            break;
          }
        }
      }
      if (idx < 0) return;
      // Do not overwrite a good mid-list save with accidental index 0 from early mount
      // unless user really is at 0 with anchors.
      var prev = wrap.previousElementSibling;
      while (prev && prev.tagName === "TR" && prev.querySelector && prev.querySelector("td.stopgap")) {
        prev = prev.previousElementSibling;
      }
      var next = wrap.nextElementSibling;
      while (next && next.tagName === "TR" && next.querySelector && next.querySelector("td.stopgap")) {
        next = next.nextElementSibling;
      }
      var total = tileKids.length || kids.length;
      // Skip saving while still at synthetic first slot before server pos loaded
      if (!dashPosServerLoaded && idx === 0 && !prev && total > 1) {
        return;
      }
      var payload = {
        index: idx,
        total: total,
        parentId: parent.id || "",
        parentTag: (parent.tagName || "").toLowerCase(),
        parentClass: parent.className ? String(parent.className).slice(0, 120) : "",
        prevId: prev && prev.id ? prev.id : "",
        prevTag: prev ? (prev.tagName || "").toLowerCase() : "",
        prevSort: prev && prev.getAttribute ? prev.getAttribute("sort") || "" : "",
        nextId: next && next.id ? next.id : "",
        nextTag: next ? (next.tagName || "").toLowerCase() : "",
        nextSort: next && next.getAttribute ? next.getAttribute("sort") || "" : "",
        ts: Date.now(),
        v: 4,
      };
      var old = readDashPosLocal();
      if (old && typeof old.index === "number" && old.index > 0 && idx === 0 && !prev && kids.length > 1) {
        // Likely a remount race that re-inserted at top — keep previous memory
        return;
      }
      // Also refuse to wipe a mid-column save when parent id suddenly becomes box1 and index 0
      if (
        old &&
        old.parentId &&
        payload.parentId &&
        old.parentId !== payload.parentId &&
        idx === 0 &&
        !prev &&
        typeof old.index === "number" &&
        old.index > 0 &&
        Date.now() - (old.ts || 0) < 15000
      ) {
        return;
      }
      // Refuse weak top-of-column without anchors if we already have a strong server-backed pos
      if (
        old &&
        isStrongDashPos(old) &&
        idx === 0 &&
        !prev &&
        !next &&
        kids.length > 1 &&
        Date.now() - (old.ts || 0) < 60000
      ) {
        return;
      }
      writeDashPosLocal(payload);
      if (dashPosSaveTimer) clearTimeout(dashPosSaveTimer);
      dashPosSaveTimer = setTimeout(function () {
        dashPosSaveTimer = 0;
        pushDashPosServer(payload);
      }, 350);
    } catch (e0) {}
  }

  function findTileBySortOrId(host, sortKey, id) {
    if (!host) return null;
    if (id) {
      try {
        var byId = document.getElementById(id);
        if (byId && byId.parentNode === host) return byId;
      } catch (e0) {}
    }
    if (sortKey) {
      try {
        var nodes = host.querySelectorAll ? host.querySelectorAll("tbody[sort], [sort]") : [];
        var i;
        for (i = 0; i < nodes.length; i++) {
          if (nodes[i].getAttribute("sort") === sortKey && nodes[i].parentNode === host) return nodes[i];
        }
      } catch (e1) {}
    }
    return null;
  }

  function insertDashWrap(host, wrap) {
    if (!host || !wrap) return;
    // Already correctly parented — never move (this was forcing first slot on remount)
    if (wrap.parentNode === host) {
      // Still allow reordering within same host only when anchors say we are wrong
      var saved0 = readDashPos();
      if (!saved0) return;
      var atOk = true;
      if (saved0.prevId || saved0.prevSort) {
        try {
          var p0 = findTileBySortOrId(host, saved0.prevSort, saved0.prevId);
          if (p0) {
            var curPrev = wrap.previousElementSibling;
            while (curPrev && curPrev.tagName === "TR" && curPrev.querySelector && curPrev.querySelector("td.stopgap")) {
              curPrev = curPrev.previousElementSibling;
            }
            if (curPrev !== p0) atOk = false;
          }
        } catch (eA) {}
      }
      if (atOk) return;
      // fall through to re-place within host
      try {
        host.removeChild(wrap);
      } catch (eRm) {
        return;
      }
    }
    var saved = readDashPos();
    var kids = host.children;
    var tileKids = dashSiblingTiles(host, wrap);
    var placed = false;
    if (saved && (saved.prevId || saved.prevSort)) {
      try {
        var prevEl = findTileBySortOrId(host, saved.prevSort, saved.prevId);
        if (prevEl && prevEl.parentNode === host) {
          if (prevEl.nextSibling) host.insertBefore(wrap, prevEl.nextSibling);
          else host.appendChild(wrap);
          placed = true;
        }
      } catch (e1) {}
    }
    if (!placed && saved && (saved.nextId || saved.nextSort)) {
      try {
        var nextEl = findTileBySortOrId(host, saved.nextSort, saved.nextId);
        if (nextEl && nextEl.parentNode === host) {
          host.insertBefore(wrap, nextEl);
          placed = true;
        }
      } catch (e2) {}
    }
    if (!placed && saved && typeof saved.index === "number" && saved.index >= 0 && (tileKids.length || kids.length)) {
      var refList = tileKids.length ? tileKids : Array.prototype.slice.call(kids);
      // Filter out wrap if present in list before insert
      refList = refList.filter(function (n) {
        return n !== wrap;
      });
      var at = Math.min(Math.max(0, saved.index), refList.length);
      // If saved index is 0 with no anchors and many kids, prefer append (user likely moved away)
      if (at === 0 && !saved.prevId && !saved.nextId && !saved.prevSort && !saved.nextSort && refList.length > 2 && saved.total && saved.total > 2) {
        host.appendChild(wrap);
      } else if (at >= refList.length) {
        host.appendChild(wrap);
      } else {
        host.insertBefore(wrap, refList[at]);
      }
      placed = true;
    }
    // Default: append at end — never force top-left / first slot after updates
    if (!placed) host.appendChild(wrap);
  }

  var dashMo = null;
  var dashMoTimer = 0;
  function watchDashReorder(wrap) {
    try {
      if (dashMo) {
        try { dashMo.disconnect(); } catch (e0) {}
        dashMo = null;
      }
      if (!wrap || !wrap.parentNode || !window.MutationObserver) return;
      var parent = wrap.parentNode;
      dashMo = new MutationObserver(function () {
        if (dashMoTimer) clearTimeout(dashMoTimer);
        dashMoTimer = setTimeout(function () {
          dashMoTimer = 0;
          // User / Unraid reordered DOM — remember new place, never snap back
          saveDashPos();
        }, 200);
      });
      dashMo.observe(parent, { childList: true });
    } catch (e1) {}
  }

  function placeInDashboard(card) {
    if (!card || !isDashboard()) return false;
    var host = findDashHost();
    if (!host) return false;
    var wrap = ensureDashHostElement(host);
    if (!wrap) return false;

    // Stable path: wrap already in a connected dashboard parent — do not re-home to box1
    if (wrap.parentNode && wrap.parentNode.isConnected && wrap.parentNode === host) {
      var cardParent0 = dashHostCardParent(wrap);
      if (cardParent0 && card.parentNode !== cardParent0) cardParent0.appendChild(card);
      try {
        wrap.classList.remove("ucwc-music-sitewide");
      } catch (eCl) {}
      // If we look stuck at column top but have a stronger saved pos, re-seat once
      try {
        var savedLive = readDashPos();
        var topish = !wrap.previousElementSibling;
        if (
          savedLive &&
          isStrongDashPos(savedLive) &&
          topish &&
          wrap.parentNode.children &&
          wrap.parentNode.children.length > 2 &&
          (savedLive.index > 0 || savedLive.prevId || savedLive.nextId || savedLive.prevSort || savedLive.nextSort)
        ) {
          insertDashWrap(wrap.parentNode, wrap);
        }
      } catch (eFix) {}
      watchDashReorder(wrap);
      scheduleFitRightPane();
      setTimeout(saveDashPos, 800);
      setTimeout(saveDashPos, 2200);
      return true;
    }

    if (wrap.parentNode && wrap.parentNode !== host) {
      // Only reparent when the old parent is gone / not connected
      var oldParent = wrap.parentNode;
      var shouldMove = !oldParent.isConnected;
      if (!shouldMove && isDashBoxTable(oldParent)) {
        // Stay in previous live box (user may have dragged across columns)
        var cardParent1 = dashHostCardParent(wrap);
        if (cardParent1 && card.parentNode !== cardParent1) cardParent1.appendChild(card);
        try {
          wrap.classList.remove("ucwc-music-sitewide");
        } catch (eCl2) {}
        watchDashReorder(wrap);
        scheduleFitRightPane();
        saveDashPos();
        return true;
      }
      try {
        oldParent.removeChild(wrap);
      } catch (eR) {}
    }
    insertDashWrap(host, wrap);
    try {
      wrap.classList.remove("ucwc-music-sitewide");
    } catch (eCl3) {}
    var cardParent = dashHostCardParent(wrap);
    if (cardParent && card.parentNode !== cardParent) {
      cardParent.appendChild(card);
    }
    // Native-ish: keep sort attr for Unraid cookie reorder
    try {
      if (wrap.tagName === "TBODY") {
        wrap.classList.add("sortable");
        if (!wrap.getAttribute("sort")) wrap.setAttribute("sort", musicDashSortKey());
      }
    } catch (eSort) {}
    watchDashReorder(wrap);
    scheduleFitRightPane();
    // Delay first save so early mount doesn't lock index 0 before layout settles / server pos loads
    setTimeout(saveDashPos, 1200);
    setTimeout(saveDashPos, 2800);
    setTimeout(saveDashPos, 6000);
    return true;
  }

  /**
   * Execute a card toolbar/transport action.
   *
   * This intentionally lives outside buildUi(): Unraid can clone or replace a
   * dashboard tbody while preserving data-* attributes but dropping JavaScript
   * listeners. A document-level capture listener therefore remains authoritative
   * for both the original card and any live replacement.
   */
  function runCardAction(btn, ev) {
    if (!btn) return false;
    // Adopt a just-cloned Unraid card before any action paints through els.*.
    // Transport actions already do this, but toolbar/list actions must be just
    // as immediate and cannot wait for the 400ms safety timer.
    ensureLiveCardRefs();
    try {
      if (ev) {
        ev.preventDefault();
        ev.stopPropagation();
      }
    } catch (eStop) {}

    if (btn.classList.contains("play") && btn.classList.contains("ucwc-music-btn")) {
      return runTransportAction("play", null, true);
    }
    if (btn.classList.contains("prev") && btn.classList.contains("ucwc-music-btn")) {
      return runTransportAction("prev", null, true);
    }
    if (btn.classList.contains("next") && btn.classList.contains("ucwc-music-btn")) {
      return runTransportAction("next", null, true);
    }
    if (btn.classList.contains("ucwc-music-item")) {
      var itemIndex = parseInt(btn.getAttribute("data-i"), 10);
      if (isFinite(itemIndex) && itemIndex >= 0 && itemIndex < state.tracks.length) {
        
        playAt(itemIndex, true);
        return true;
      }
      return false;
    }
    if (btn.classList.contains("ucwc-music-list-more")) {
      state.listRenderLimit = Math.min(state.tracks.length, (Number(state.listRenderLimit) || 300) + 300);
      renderList();
      return true;
    }
    if (btn.classList.contains("shuffle")) {
      state.shuffle = !state.shuffle;
      updateModeBtns();
      saveLs();
      
      return true;
    }
    if (btn.classList.contains("repeat")) {
      state.repeat =
        state.repeat === "off" ? "all" : state.repeat === "all" ? "one" : "off";
      updateModeBtns();
      saveLs();
      
      return true;
    }
    if (btn.classList.contains("list") && btn.classList.contains("ucwc-music-btn")) {
      if (state.sideMode === "info") {
        state.sideMode = state.sideBeforeInfo === "lyrics" ? "list" : "lyrics";
      } else {
        state.sideMode = state.sideMode === "lyrics" ? "list" : "lyrics";
      }
      state.sideBeforeInfo = state.sideMode;
      updateSidePanel();
      saveLs();
      if (state.sideMode === "lyrics") {
        loadLyricsForCurrent();
        syncLyrics(true);
      }
      return true;
    }
    if (btn.classList.contains("sort") && btn.classList.contains("ucwc-music-side-btn")) {
      cycleListSort();
      return true;
    }
    if (btn.classList.contains("rescan")) {
      if (!state.libraryScanning) {
        setStatus("正在启动后台重新索引…");
        fetchList(true);
      }
      return true;
    }
    if (btn.classList.contains("lyric-refetch")) {
      loadLyricsForCurrent({ force: true });
      return true;
    }
    if (btn.classList.contains("lyric-earlier")) {
      adjustLyricDrift(500);
      return true;
    }
    if (btn.classList.contains("lyric-later")) {
      adjustLyricDrift(-500);
      return true;
    }
    if (btn.classList.contains("lyric-offset")) {
      adjustLyricDrift(-(Number(state.lyrics.driftMs) || 0));
      return true;
    }
    if (btn.classList.contains("ucwc-music-info-btn")) {
      toggleTrackInfoPop(ev);
      return true;
    }
    return false;
  }

  function bindStableCardActions() {
    if (global.__UCWC_MUSIC_CARD_ACTIONS_BOUND__) return;
    global.__UCWC_MUSIC_CARD_ACTIONS_BOUND__ = true;
    // Execute the first five transport/mode controls on pointerdown. This is
    // the earliest reliable user-activation event on mobile WebViews and also
    // survives Unraid cloneNode() repaints through delegation.
    document.addEventListener(
      "pointerdown",
      function (ev) {
        try {
          if (typeof ev.button === "number" && ev.button !== 0) return;
          var t = ev && ev.target;
          if (!t || !t.closest) return;
          var btn = t.closest(
            "#ucwc-music-card .ucwc-music-btn.shuffle, " +
              "#ucwc-music-card .ucwc-music-btn.prev, " +
              "#ucwc-music-card .ucwc-music-btn.play, " +
              "#ucwc-music-card .ucwc-music-btn.next, " +
              "#ucwc-music-card .ucwc-music-btn.repeat"
          );
          if (!btn) return;
          btn.__ucwcMusicPointerHandledAt = Date.now();
          runCardAction(btn, ev);
        } catch (ePointer) {}
      },
      true
    );
    document.addEventListener(
      "click",
      function (ev) {
        try {
          var t = ev && ev.target;
          if (!t || !t.closest) return;
          var arrow = t.closest("#ucwc-music-card i.openclose");
          if (arrow) {
            setTimeout(function () {
              syncNativeDashboardCollapse(liveCardRoot(), arrow);
            }, 0);
            return;
          }
          var btn = t.closest(
            "#ucwc-music-card .ucwc-music-btn, " +
              "#ucwc-music-card .ucwc-music-side-btn, " +
              "#ucwc-music-card .ucwc-music-header-btn, " +
              "#ucwc-music-card .ucwc-music-info-btn, " +
              "#ucwc-music-card .ucwc-music-item, " +
              "#ucwc-music-card .ucwc-music-list-more"
          );
          if (!btn) return;
          if (
            btn.__ucwcMusicPointerHandledAt &&
            Date.now() - btn.__ucwcMusicPointerHandledAt < 900 &&
            (!ev || ev.detail !== 0)
          ) {
            ev.preventDefault();
            ev.stopPropagation();
            return;
          }
          runCardAction(btn, ev);
        } catch (eClick) {}
      },
      true
    );
  }

  function applyCardListFilter(input, immediate) {
    if (!input) return;
    ensureLiveCardRefs();
    var value = input.value || "";
    if (listFilterTimer) clearTimeout(listFilterTimer);
    var apply = function () {
      listFilterTimer = 0;
      state.listFilter = value;
      state.listRenderLimit = 300;
      renderList();
      if (!state.error || /共 \d+ 首|已截断|筛选|目录内无/.test(state.error)) {
        setStatus(libraryStatusText());
      }
    };
    if (immediate) apply();
    else listFilterTimer = setTimeout(apply, 60);
  }

  function updateCardVolume(input) {
    if (!input) return;
    ensureLiveCardRefs();
    var value = parseInt(input.value, 10);
    if (!isFinite(value)) return;
    state.volume = Math.max(0, Math.min(1, value / 100));
    if (audio) audio.volume = state.volume;
    saveLs();
    
  }

  function beginCardSeek() {
    ensureLiveCardRefs();
    seeking = true;
    seekingSince = Date.now();
  }

  function commitCardSeek(input) {
    ensureLiveCardRefs();
    seeking = false;
    seekingSince = 0;
    var duration = audio && isFinite(audio.duration) ? audio.duration : 0;
    if (!input || duration <= 0) return;
    var ratio = parseInt(input.value, 10) / 1000;
    if (!isFinite(ratio)) return;
    var target = Math.max(0, Math.min(duration, ratio * duration));
    if (audio) audio.currentTime = target;
    syncLyrics(true);
    savePlaySession();
  }

  /**
   * Inputs and list rows must survive Unraid cloneNode()/dashboard repaints too.
   * Read the live event target instead of cached els.* references so updates are
   * immediate even before the periodic card-adoption fallback runs.
   */
  function bindStableCardInputs() {
    if (global.__UCWC_MUSIC_CARD_INPUTS_BOUND__) return;
    global.__UCWC_MUSIC_CARD_INPUTS_BOUND__ = true;
    document.addEventListener(
      "input",
      function (ev) {
        var t = ev && ev.target;
        if (!t || !t.matches) return;
        if (t.matches("#ucwc-music-card .ucwc-music-side-search")) {
          applyCardListFilter(t, false);
        } else if (t.matches("#ucwc-music-card .ucwc-music-vol input")) {
          updateCardVolume(t);
        }
      },
      true
    );
    document.addEventListener(
      "keydown",
      function (ev) {
        var t = ev && ev.target;
        if (!t || !t.matches || !t.matches("#ucwc-music-card .ucwc-music-side-search")) return;
        if (ev.key === "Escape") {
          t.value = "";
          applyCardListFilter(t, true);
          try {
            ev.preventDefault();
            ev.stopPropagation();
          } catch (e0) {}
        }
      },
      true
    );
    ["mousedown", "touchstart"].forEach(function (type) {
      document.addEventListener(
        type,
        function (ev) {
          var t = ev && ev.target;
          if (t && t.matches && t.matches("#ucwc-music-card .ucwc-music-seek")) beginCardSeek();
        },
        true
      );
    });
    ["mouseup", "touchend", "change"].forEach(function (type) {
      document.addEventListener(
        type,
        function (ev) {
          var t = ev && ev.target;
          if (t && t.matches && t.matches("#ucwc-music-card .ucwc-music-seek")) commitCardSeek(t);
        },
        true
      );
    });
  }

  /**
   * Keep transport controls out of Unraid's sortable drag lifecycle.
   * Use a JavaScript expando instead of data-* so cloned nodes are rebound.
   */
  function bindCardDragGuards(card) {
    if (!card || card.__ucwcMusicDragGuardsBound) return;
    card.__ucwcMusicDragGuardsBound = true;
    var guard = function (ev) {
      try {
        var t = ev && ev.target;
        if (!t || !t.closest) return;
        var interactive = t.closest(
          "button, a, input, select, textarea, .ucwc-music-item"
        );
        if (interactive && card.contains(interactive)) ev.stopPropagation();
      } catch (e0) {}
    };
    card.addEventListener("pointerdown", guard, false);
    card.addEventListener("mousedown", guard, false);
    card.addEventListener("touchstart", guard, { passive: true });
  }

  /**
   * Unraid appends its native tile-dismiss and open/close controls after the
   * plugin card mounts. Card visibility belongs exclusively to Theme Music's
   * enable/run-mode settings, so discard tile-dismiss controls while keeping
   * the native chevron synchronized with the plugin body.
   */
  function bindNativeDashboardControls(card) {
    if (!card || !card.isConnected) return;
    try {
      var host = card.closest ? card.closest("tbody#ucwc-music-dash-host") : null;
      var controls = card.querySelector(".tile-header-right-controls");
      if (!host || !controls) return;

      var dismisses = host.querySelectorAll(
        "i.control.tile.fa-close, i.control.tile.fa-times, .ucwc-music-native-dismiss"
      );
      for (var di = 0; di < dismisses.length; di++) {
        var dismiss = dismisses[di];
        try {
          if (dismiss && dismiss.parentNode) dismiss.parentNode.removeChild(dismiss);
        } catch (eDismiss) {}
      }

      var arrow = controls.querySelector("i.openclose");
      if (!arrow) return;
      syncNativeDashboardCollapse(card, arrow);
    } catch (e0) {}
  }

  function syncNativeDashboardCollapse(card, arrow) {
    if (!card || !arrow) return;
    try {
      var collapsed = arrow.classList.contains("fa-chevron-down");
      card.classList.toggle("ucwc-music-native-collapsed", collapsed);
      var body = card.querySelector(".ucwc-music-body");
      if (body) body.style.display = collapsed ? "none" : "";
      arrow.setAttribute("aria-expanded", collapsed ? "false" : "true");
    } catch (e0) {}
  }

  function buildUi() {
    if (root) return root;
    root = document.createElement("div");
    root.id = "ucwc-music-card";
    root.className = "ucwc-dash-music-tile ucwc-music-side-list";
    root.setAttribute("role", "region");
    root.setAttribute("aria-label", "仪表盘音乐");
    root.innerHTML =
      '<div class="ucwc-music-tile-bar tile-header">' +
      '  <span class="tile-header-left">' +
      '    <i class="fa fa-music f32 ucwc-music-header-icon" aria-hidden="true"></i>' +
      '    <span class="ucwc-music-title-block section">' +
      '      <span class="ucwc-music-tile-title tile-header-main">音乐</span>' +
      '      <span class="ucwc-music-tile-subtitle">音乐播放器</span>' +
      "    </span>" +
      "  </span>" +
      '  <span class="ucwc-music-tile-bar-actions tile-header-right">' +
      '    <span class="tile-header-right-controls">' +
      '      <a class="ucwc-music-header-link" href="/Settings/ThemeMusic" title="打开主题音乐设置" aria-label="打开主题音乐设置"><i class="fa fa-fw fa-cog control" aria-hidden="true"></i></a>' +
      "    </span>" +
      "  </span>" +
      "</div>" +
      '<div class="ucwc-music-body">' +
      '  <div class="ucwc-music-main">' +
      '    <div class="ucwc-music-left">' +
      '      <div class="ucwc-music-head">' +
      '        <div class="ucwc-music-art" aria-hidden="true"><span class="ucwc-music-art-fallback">♪</span></div>' +
      '        <div class="ucwc-music-meta">' +
      '          <div class="ucwc-music-title">…</div>' +
      '          <div class="ucwc-music-sub"></div>' +
      "        </div>" +
      "      </div>" +
      '      <div class="ucwc-music-transport">' +
      '        <div class="ucwc-music-btns">' +
      '          <button type="button" class="ucwc-music-btn shuffle" title="随机" aria-label="随机"></button>' +
      '          <button type="button" class="ucwc-music-btn prev" title="上一首" aria-label="上一首"></button>' +
      '          <button type="button" class="ucwc-music-btn primary play" title="播放" aria-label="播放"></button>' +
      '          <button type="button" class="ucwc-music-btn next" title="下一首" aria-label="下一首"></button>' +
      '          <button type="button" class="ucwc-music-btn repeat" title="循环：关" aria-label="循环"></button>' +
      '          <button type="button" class="ucwc-music-btn list" title="切换到歌词" aria-label="切换到歌词"></button>' +
      "        </div>" +
      '        <div class="ucwc-music-under">' +
      '          <div class="ucwc-music-progress-wrap">' +
      '            <span class="ucwc-music-time cur">0:00</span>' +
      '            <input type="range" class="ucwc-music-seek" min="0" max="1000" value="0" aria-label="进度">' +
      '            <span class="ucwc-music-time end">0:00</span>' +
      "          </div>" +
      '          <div class="ucwc-music-controls">' +
      '            <div class="ucwc-music-vol" title="音量">' +
      '              <span class="ucwc-music-vol-slot" aria-hidden="true"></span>' +
      '              <input type="range" min="0" max="100" value="70" aria-label="音量">' +
      "            </div>" +
      "          </div>" +
      '          <div class="ucwc-music-status-row">' +
      '            <button type="button" class="ucwc-music-info-btn" title="当前曲目信息" aria-label="当前曲目信息" aria-expanded="false"></button>' +
      '            <span class="ucwc-music-source-label" title="当前音源">本地音源</span>' +
      '            <div class="ucwc-music-status" aria-live="polite"></div>' +
      "          </div>" +
      "        </div>" +
      "      </div>" +
      "    </div>" +
      '    <div class="ucwc-music-right">' +
      '      <div class="ucwc-music-side-head">' +
      '        <span class="ucwc-music-side-label">曲目</span>' +
      '        <span class="ucwc-music-side-tools">' +
      '          <span class="ucwc-music-side-filter-count" hidden></span>' +
      '          <button type="button" class="ucwc-music-side-btn sort" title="排序：歌手（点击切换）" aria-label="排序：歌手"></button>' +
      '          <button type="button" class="ucwc-music-side-btn rescan" title="重新加载曲库" aria-label="重新加载曲库"></button>' +
      '          <button type="button" class="ucwc-music-side-btn lyric-earlier" title="歌词提前 0.5 秒" aria-label="歌词提前 0.5 秒" hidden>−</button>' +
      '          <button type="button" class="ucwc-music-side-btn lyric-offset" title="歌词时间偏移：0 秒" aria-label="歌词时间偏移 0 秒" hidden>0.0s</button>' +
      '          <button type="button" class="ucwc-music-side-btn lyric-later" title="歌词延后 0.5 秒" aria-label="歌词延后 0.5 秒" hidden>+</button>' +
      '          <button type="button" class="ucwc-music-side-btn lyric-refetch" title="重新匹配当前歌词" aria-label="重新匹配歌词" hidden></button>' +
      "        </span>" +
      "      </div>" +
      '      <div class="ucwc-music-side-search-wrap">' +
      '        <input type="search" class="ucwc-music-side-search" placeholder="搜索曲名 / 歌手 / 专辑" autocomplete="off" spellcheck="false" aria-label="搜索曲目">' +
      "      </div>" +
      '      <div class="ucwc-music-side-body">' +
      '        <div class="ucwc-music-list" role="listbox" aria-label="曲目列表"></div>' +
      '        <div class="ucwc-music-lyrics" aria-live="polite">' +
      '          <div class="ucwc-music-lyrics-scroll"></div>' +
      '          <div class="ucwc-music-lyrics-hint">加载或自动匹配歌词…</div>' +
      "        </div>" +
      '        <div class="ucwc-music-info-panel" aria-live="polite"></div>' +
      "      </div>" +
      "    </div>" +
      "  </div>" +
      "</div>";

    els.art = root.querySelector(".ucwc-music-art");
    els.title = root.querySelector(".ucwc-music-title");
    els.sub = root.querySelector(".ucwc-music-sub");
    els.cur = root.querySelector(".ucwc-music-time.cur");
    els.dur = root.querySelector(".ucwc-music-time.end");
    els.seek = root.querySelector(".ucwc-music-seek");
    els.play = root.querySelector(".ucwc-music-btn.play");
    els.prev = root.querySelector(".ucwc-music-btn.prev");
    els.next = root.querySelector(".ucwc-music-btn.next");
    els.shuffle = root.querySelector(".ucwc-music-btn.shuffle");
    els.repeat = root.querySelector(".ucwc-music-btn.repeat");
    els.listBtn = root.querySelector(".ucwc-music-btn.list");
    els.vol = root.querySelector(".ucwc-music-vol input");
    els.statusRow = root.querySelector(".ucwc-music-status-row");
    els.status = root.querySelector(".ucwc-music-status");
    els.infoBtn = root.querySelector(".ucwc-music-info-btn");
    els.sourceLabel = root.querySelector(".ucwc-music-source-label");
    els.infoPop = root.querySelector(".ucwc-music-info-panel");
    els.list = root.querySelector(".ucwc-music-list");
    els.lyricsScroll = root.querySelector(".ucwc-music-lyrics-scroll");
    els.lyricsHint = root.querySelector(".ucwc-music-lyrics-hint");
    els.sideLabel = root.querySelector(".ucwc-music-side-label");
    els.sideSearch = root.querySelector(".ucwc-music-side-search");
    els.sideSearchWrap = root.querySelector(".ucwc-music-side-search-wrap");
    els.sideRescan = root.querySelector(".ucwc-music-side-btn.rescan");
    els.sideSort = root.querySelector(".ucwc-music-side-btn.sort");
    els.sideLyricRefetch = root.querySelector(".ucwc-music-side-btn.lyric-refetch");
    els.sideLyricEarlier = root.querySelector(".ucwc-music-side-btn.lyric-earlier");
    els.sideLyricOffset = root.querySelector(".ucwc-music-side-btn.lyric-offset");
    els.sideLyricLater = root.querySelector(".ucwc-music-side-btn.lyric-later");
    els.sideFilterCount = root.querySelector(".ucwc-music-side-filter-count");

    if (els.shuffle) els.shuffle.innerHTML = svgIcon("shuffle");
    if (els.prev) els.prev.innerHTML = svgIcon("prev");
    if (els.play) els.play.innerHTML = svgIcon("play");
    if (els.next) els.next.innerHTML = svgIcon("next");
    if (els.repeat) els.repeat.innerHTML = svgIcon("repeat");
    if (els.sideSort) els.sideSort.innerHTML = svgIcon("sort");
    if (els.sideRescan) els.sideRescan.innerHTML = svgIcon("rescan");
    if (els.sideLyricRefetch) els.sideLyricRefetch.innerHTML = svgIcon("lyric-refetch");
    updateLyricAdjustUi();
    if (els.infoBtn) els.infoBtn.innerHTML = svgIcon("info");
    syncSortBtn();
    var volSlot = root.querySelector(".ucwc-music-vol-slot");
    if (volSlot) volSlot.innerHTML = svgIcon("vol");
    syncSourceLabel();
    updateSidePanel();

    bindStableCardActions();
    bindStableCardInputs();
    bindCardDragGuards(root);
    bindNativeDashboardControls(root);
    /* Shell: stop Unraid tile drag/nav bubbling; transport handled above via delegation */
    if (!root.getAttribute("data-ucwc-shell-bound")) {
      root.setAttribute("data-ucwc-shell-bound", "1");
      root.addEventListener("click", function (ev) {
        try {
          ev.stopPropagation();
        } catch (e1) {}
      });
      root.addEventListener("auxclick", function (ev) {
        try {
          ev.stopPropagation();
        } catch (e2) {}
      });
    }
    updateModeBtns();

    if (!placeInDashboard(root)) {
      root.classList.add("ucwc-music-hidden");
    }
    return root;
  }

  function libraryClientScope() {
    var c = cfg() || {};
    return [
      String(c.source || "local").toLowerCase(),
      String(c.library_scope || ""),
      String(c.local_dir || ""),
      String(c.navidrome_url || ""),
      String(c.navidrome_user || ""),
    ].join("|");
  }

  function saveClientLibraryCache(j) {
    try {
      if (!j || !j.ok || !Array.isArray(j.tracks)) return;
      // Large indexes remain canonical on the server; duplicating tens of
      // thousands of tracks in sessionStorage can exceed browser quota.
      if (j.tracks.length > 5000) {
        sessionStorage.removeItem(LIBRARY_CACHE_KEY);
        return;
      }
      sessionStorage.setItem(
        LIBRARY_CACHE_KEY,
        JSON.stringify({
          v: 3,
          scope: libraryClientScope(),
          ts: Date.now(),
          tracks: j.tracks.slice(),
          truncated: !!j.truncated,
          limit: Number(j.limit) || 0,
          tip: typeof j.tip === "string" ? j.tip : "",
        })
      );
    } catch (e0) {}
  }

  function restoreClientLibraryCache() {
    try {
      var raw = sessionStorage.getItem(LIBRARY_CACHE_KEY);
      if (!raw) return false;
      var cached = JSON.parse(raw);
      if (
        !cached ||
        cached.v !== 3 ||
        cached.scope !== libraryClientScope() ||
        !Array.isArray(cached.tracks) ||
        Date.now() - Number(cached.ts || 0) > LIBRARY_CACHE_TTL_MS
      ) {
        sessionStorage.removeItem(LIBRARY_CACHE_KEY);
        return false;
      }
      state.tracks = cached.tracks.slice();
      state.listTruncated = !!cached.truncated;
      state.listLimit = Number(cached.limit) || 0;
      state.listTip = typeof cached.tip === "string" ? cached.tip : "";
      state.loaded = true;
      var sess = resumePending || loadPlaySession();
      if (sess && state.tracks.length) state.index = resolveSessionIndex(sess);
      else if (state.index >= state.tracks.length) state.index = 0;
      setStatus(libraryStatusText());
      updateMeta();
      renderList();
      if (state.tracks.length) {
        loadLyricsForCurrent();
        loadCoverForCurrent();
      } else {
        clearCoverView();
      }
      
      maybeResumeOrAutoplay();
      return true;
    } catch (e0) {
      try { sessionStorage.removeItem(LIBRARY_CACHE_KEY); } catch (e1) {}
      return false;
    }
  }

  function fetchList(forceScan) {
    var seq = ++listFetchSeq;
    if (!state.tracks.length) setStatus(sourceLabelText() === "Navidrome" ? "正在读取 Navidrome 曲库…" : "正在读取本地曲库索引…");
    var refresh = forceScan ? "&refresh=1" : "";
    return fetch(apiBase + "?action=list&_ts=" + Date.now() + refresh, {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    })
      .then(function (r) {
        return r.json().then(function (j) {
          return { okHttp: r.ok, j: j };
        });
      })
      .then(function (pack) {
        if (seq !== listFetchSeq) return;
        var j = pack.j || {};
        state.loaded = true;
        if (!j.ok) {
          if (!state.tracks.length) state.tracks = [];
          state.libraryScanning = false;
          state.listTruncated = false;
          state.listTip = "";
          setStatus(j.error || "无法加载曲库");
          updateMeta();
          renderList();
          return;
        }
        state.libraryScanning = !!j.scanning;
        if (Array.isArray(j.tracks) && (j.tracks.length || !state.tracks.length || !j.scanning)) {
          state.tracks = j.tracks;
          state.listRenderLimit = 300;
        }
        state.listTruncated = !!j.truncated;
        state.listLimit = typeof j.limit === "number" ? j.limit : 0;
        state.listTip = typeof j.tip === "string" ? j.tip : "";
        if (Array.isArray(j.tracks) && j.tracks.length) saveClientLibraryCache(j);
        // Pin session track before first paint — stops title cycling through library
        var sess = resumePending || loadPlaySession();
        if (sess && state.tracks.length) {
          state.index = resolveSessionIndex(sess);
          if (typeof sess.t === "number" && sess.t > 0.5) pendingSeekTo = sess.t;
        } else if (state.index >= state.tracks.length) {
          state.index = 0;
        }
        setStatus(libraryStatusText());
        if (state.listTruncated && state.listTip) {
          // Brief longer tip after count line
          setTimeout(function () {
            if (state.listTruncated && (!state.error || /共 \d+ 首|已截断|筛选/.test(state.error))) {
              setStatus(state.listTip);
              setTimeout(function () {
                if (state.error === state.listTip) setStatus(libraryStatusText());
              }, 4500);
            }
          }, 600);
        }
        updateMeta();
        renderList();
        if (state.tracks.length) {
          loadLyricsForCurrent();
          loadCoverForCurrent();
        } else {
          clearCoverView();
        }
        
        maybeResumeOrAutoplay();
        /* If a stale session marked playback active before the hidden audio
         * node was recreated, ensure the current Navidrome/local track still
         * has a concrete media source after the library arrives. */
        if (audio && !audio.src && state.tracks.length) {
          try { primeAudioTrack(state.index, 0); } catch (ePrimeAfterList) {}
        }
        if (libraryPollTimer) clearTimeout(libraryPollTimer);
        if (state.libraryScanning) {
          libraryPollTimer = setTimeout(function () {
            libraryPollTimer = 0;
            fetchList(false);
          }, 2000);
        }
      })
      .catch(function () {
        if (seq !== listFetchSeq) return;
        state.loaded = true;
        setStatus("曲库请求失败");
        updateMeta();
      });
  }

  function applyCfgDefaults() {
    var c = cfg();
    if (typeof c.volume === "number") {
      state.volume = Math.max(0, Math.min(1, c.volume / (c.volume > 1 ? 100 : 1)));
      if (c.volume > 1) state.volume = Math.max(0, Math.min(1, c.volume / 100));
    }
    if (typeof c.shuffle === "boolean") state.shuffle = c.shuffle;
    if (c.repeat === "off" || c.repeat === "one" || c.repeat === "all") state.repeat = c.repeat;
    loadLs();
  }

  function maybeResumeOrAutoplay() {
    if (!state.tracks.length) return;
    /* A stale cross-page session can leave the hidden audio node marked as
     * playing while its source was discarded. Never treat an empty source as
     * active playback; rebuild it from the current track below. */
    if (audio && !audio.src) {
      try { audio.pause(); } catch (eEmpty) {}
      state.playing = false;
      resumeAttempted = false;
    }
    // Always arm gesture unlock on mobile / when we may need a tap to unlock autoplay policy
    bindGestureUnlock();
    if (audio && audio.src && !audio.paused) {
      mediaUnlocked = true;
      syncSitewideChip();
      updateChipUi();
      if (isSitewidePlay()) showResumeChip();
      return;
    }
    if (resumeAttempted) {
      // Keep trying on mobile even after first attempt — policy often needs a later gesture
      if (resumeIntent || gestureResumeWanted || sessionWantsResume(loadPlaySession())) {
        gestureResumeWanted = true;
        bindGestureUnlock();
        // Preload so the next tap can play() synchronously
        try {
          var sKeep = loadPlaySession();
          var iKeep = sKeep ? resolveSessionIndex(sKeep) : state.index;
          var tKeep = sKeep && typeof sKeep.t === "number" ? sKeep.t : pendingSeekTo;
          primeAudioTrack(iKeep, tKeep);
        } catch (ePrime) {}
        if (isSitewidePlay()) {
          syncSitewideChip(pendingResume || resumeIntent ? "点一下任意处续播" : "");
          updateChipUi();
          showResumeChip();
        } else if (isDashboard() && isCoarsePointer()) {
          setStatus("点一下任意处可续播");
        }
      }
      return;
    }
    var sess = resumePending || loadPlaySession();
    resumePending = null;
    if (sessionWantsResume(sess) || resumeIntent) {
      if (isDashboard() || isSitewidePlay()) {
        resumeAttempted = true;
        resumeIntent = true;
        var idx = sess ? resolveSessionIndex(sess) : state.index;
        var t = sess && typeof sess.t === "number" ? sess.t : 0;
        if ((!t || t < 0.5) && pendingSeekTo > 0.5) t = pendingSeekTo;
        if ((!t || t < 0.5) && audio && lastSrcId && sess && sess.id === lastSrcId && isFinite(audio.currentTime)) {
          t = audio.currentTime;
        }
        if (t > 0.5) pendingSeekTo = t;
        state.index = idx;
        state.playing = false;
        updatePlayBtn();
        updateMeta();
        renderList();
        // Prime src first so gesture path can play() sync; then try programmatic play.
        gestureResumeWanted = true;
        bindGestureUnlock();
        primeAudioTrack(idx, t);
        playAt(idx, true, t);
        if (isSitewidePlay()) {
          showResumeChip(audio && !audio.paused ? "" : "点一下任意处续播");
          syncSitewideChip(audio && !audio.paused ? "" : "点一下任意处续播");
        }
        return;
      }
    }
    if (sess && sess.id && typeof sess.t === "number" && sess.t > 0.5) {
      resumeAttempted = true;
      var idx2 = resolveSessionIndex(sess);
      state.index = idx2;
      pendingSeekTo = sess.t;
      // Still try auto-play on mobile if session had been playing; gesture unlock backs it up
      var forcePlay = !!(sess.playing || sess.intent || resumeIntent);
      if (forcePlay) {
        gestureResumeWanted = true;
        bindGestureUnlock();
        primeAudioTrack(idx2, sess.t);
      }
      playAt(idx2, forcePlay, sess.t);
      updatePlayBtn();
      if (isSitewidePlay()) showResumeChip();
      return;
    }
    var c = cfg();
    if (c.autoplay && isDashboard() && state.tracks.length) {
      resumeAttempted = true;
      resumeIntent = true;
      gestureResumeWanted = true;
      bindGestureUnlock();
      primeAudioTrack(state.index, 0);
      playAt(state.index, true);
      setTimeout(function () {
        if (audio && audio.paused) {
          gestureResumeWanted = true;
          schedulePlayRetries("autoplay");
          if (isCoarsePointer()) setStatus("点一下任意处开始播放");
        }
      }, 300);
    } else if (isSitewidePlay()) {
      syncSitewideChip();
      showResumeChip();
    }
  }

  function mount() {
    if (!enabled()) {
      hideCardUi();
      hideResumeChip();
      stopEngine(true);
      return;
    }

    applyCfgDefaults();
    
    // Full Unraid page loads replace body; clear detached card so buildUi recreates it.
    ensureLiveCardRefs();
    seeking = false;
    seekingSince = 0;
    // Chip also dies with the old document — force rebuild on next showResumeChip.
    if (chip && !chip.isConnected) {
      chip = null;
      chipEls = {};
    }

    // 仅仪表盘播放：离开仪表盘时停播并清会话
    if (!isDashboard() && !isSitewidePlay()) {
      hideCardUi();
      hideResumeChip();
      stopEngine(true);
      return;
    }

    // 全站播放 / 仪表盘：引擎可跑；卡片仅仪表盘；sitewide 时 chip 常显
    if (!shouldShowCard()) {
      hideCardUi();
    } else {
      buildUi();
      rebindCardEls();
      // Soft place: never detach card from a connected host (prevents layout jump/flash)
      if (!placeInDashboard(root)) {
        root.classList.add("ucwc-music-hidden");
      } else {
        root.classList.remove("ucwc-music-hidden");
      }
      updateSidePanel();
      if (els.vol) els.vol.value = String(Math.round(state.volume * 100));
      updateModeBtns();
      // Sync button + progress to live audio after cross-page mount / card rebuild
      if (audio && (!audio.src || audio.paused)) state.playing = false;
      else if (audio && audio.src && !audio.paused) state.playing = true;
      updatePlayBtn();
      updateMeta();
      try {
        onTime();
      } catch (eT) {}
      startUiSyncTimer();
      if (state.tracks.length) {
        // Avoid wiping in-progress lyrics paint on every remount when same track
        if (!(state.lyrics && state.lyrics.id && current() && state.lyrics.id === current().id && state.lyrics.lines.length)) {
          loadLyricsForCurrent();
        }
        loadCoverForCurrent();
      }
      // Second paint after layout/host insertion
      setTimeout(function () {
        try {
          if (!cardDomLive()) return;
          rebindCardEls();
          updatePlayBtn();
          updateMeta();
          onTime();
        } catch (e2) {}
      }, 120);
      setTimeout(function () {
        try {
          if (!cardDomLive()) return;
          onTime();
          updatePlayBtn();
        } catch (e3) {}
      }, 600);
    }

    if (!shouldRunEngine()) return;

    if (!isSitewidePlay()) {
      ensureAudio().volume = state.volume;
      // Card-only mode still owns its in-document audio element.
      bindGestureUnlock();
    } else {
      // Sitewide chip mode: ensure inline audio element exists
      ensureAudio().volume = state.volume;
    }
    if (isSitewidePlay()) showResumeChip();

    var earlySess = loadPlaySession();
    if (sessionWantsResume(earlySess) || !!(cfg().autoplay && isDashboard())) {
      resumeIntent = true;
      gestureResumeWanted = true;
      if (!isSitewidePlay()) bindGestureUnlock();
    }

    // Sitewide: chip always present (dashboard included)
    if (isSitewidePlay()) {
      syncSitewideChip();
      showResumeChip();
    }

    if (!state.loaded) {
      resumePending = earlySess || loadPlaySession();
      // Prefill index from session so first paint isn't track 0
      if (resumePending && typeof resumePending.index === "number") {
        state.index = resumePending.index;
        if (typeof resumePending.t === "number" && resumePending.t > 0.5) pendingSeekTo = resumePending.t;
      } else if (resumePending && resumePending.id) {
        // id resolve after list
      }
      restoreClientLibraryCache();
      fetchList();
    } else if (isSitewidePlay() || isDashboard()) {
      var sess = earlySess || loadPlaySession();
      if (audio && audio.src && !audio.paused) {
        syncSitewideChip();
        updateChipUi();
        updateMeta();
        try {
          onTime();
        } catch (eOt) {}
        if (isSitewidePlay()) showResumeChip();
      } else if (!resumeAttempted && (sessionWantsResume(sess) || resumeIntent)) {
        maybeResumeOrAutoplay();
      } else if (isSitewidePlay()) {
        syncSitewideChip();
        showResumeChip();
      }
    }
  }

  function destroy() {
    stopEngine(true);
    if (libraryPollTimer) {
      clearTimeout(libraryPollTimer);
      libraryPollTimer = 0;
    }
    if (audio) {
      try {
        audio.removeAttribute("src");
        audio.load();
      } catch (e) {}
    }
    hideCardUi();
    hideResumeChip();
    root = null;
    els = {};
    chipEls = {};
    state.loaded = false;
    lastSrcId = "";
    resumeAttempted = false;
  }

  function boot() {
    if (bootDone) {
      // Soft remount only — do not re-trigger resume stack.
      // Still rebuild card/chip if the previous document's DOM was discarded.
      ensureLiveCardRefs();
      if (chip && !chip.isConnected) {
        chip = null;
        chipEls = {};
      }
      mount();
      // Full page navigations re-run the script in a NEW realm; bootDone is always fresh then.
      // This branch is same-document re-entry only.
      if (audio) {
        try {
          onTime();
          updatePlayBtn();
        } catch (eBoot) {}
      }
      return;
    }
    bootDone = true;
    try {
      bindMediaSession();
      bindNavFlush();
      window.addEventListener(
        "resize",
        function () {
          scheduleMarqueeRefresh();
        },
        { passive: true }
      ); // ucwc-music-marquee-resize
      window.addEventListener("pagehide", function () {
        onDocumentHidden("pagehide");
      });
      window.addEventListener("beforeunload", function () {
        // Last-chance flush; audio may already be paused by pagehide/hidden.
        try {
          if (isSitewidePlay() || (audio && !audio.paused)) onDocumentHidden("beforeunload");
          else savePlaySessionForNav();
        } catch (eBu) {
          savePlaySessionForNav();
        }
      });
      window.addEventListener("freeze", function () {
        onDocumentHidden("freeze");
      });
      document.addEventListener("visibilitychange", function () {
        if (document.visibilityState === "hidden") onDocumentHidden("visibility");
      });
      window.addEventListener(
        "resize",
        function () {
          if (chip && chip.parentNode) applyChipPos();
          scheduleFitRightPane();
        },
        { passive: true }
      );
      // Unraid may wipe dashboard tiles — only remount when our card is actually gone.
      try {
        if (window.MutationObserver && !global.__UCWC_MUSIC_DOM_MO__) {
          global.__UCWC_MUSIC_DOM_MO__ = true;
          var domMoTimer = 0;
          var domMoQuietUntil = 0;
          var domMo = new MutationObserver(function () {
            if (Date.now() < domMoQuietUntil) return;
            if (domMoTimer) clearTimeout(domMoTimer);
            domMoTimer = setTimeout(function () {
              domMoTimer = 0;
              try {
                if (!enabled() || !shouldShowCard()) return;
                var live = document.getElementById("ucwc-music-card");
                if (live && live.isConnected) {
                  if (root !== live) {
                    root = live;
                    rebindCardEls();
                  }
                  bindNativeDashboardControls(live);
                  if (audio) {
                    paintProgressTo(live, audio.currentTime || 0, audio.duration || 0);
                    updatePlayBtn();
                  }
                  return;
                }
                // Card missing from document — rebuild once, then ignore our own inserts briefly.
                domMoQuietUntil = Date.now() + 1200;
                ensureLiveCardRefs();
                mount();
                if (audio) {
                  updatePlayBtn();
                  onTime();
                }
              } catch (eMo) {}
            }, 200);
          });
          domMo.observe(document.documentElement, { childList: true, subtree: true });
        }
      } catch (eDomMo) {}
    } catch (e0) {}
    mount();
    // Delayed remounts only place UI (dashboard host may appear late); resume gated by resumeAttempted
    var n = 0;
    if (mountTimer) clearInterval(mountTimer);
    mountTimer = setInterval(function () {
      // Only re-place if host missing; avoid thrashing DOM (flash + snap-to-first)
      var need =
        shouldShowCard() &&
        (!document.getElementById("ucwc-music-dash-host") ||
          !document.getElementById("ucwc-music-card") ||
          (document.getElementById("ucwc-music-dash-host") &&
            !document.getElementById("ucwc-music-dash-host").parentNode) ||
          (root && !root.isConnected));
      if (need || n < 2) mount();
      else if (shouldShowCard() && root) placeInDashboard(root);
      if (audio && shouldShowCard()) {
        try {
          paintProgressTo(document.getElementById("ucwc-music-card") || root, audio.currentTime || 0, audio.duration || 0);
          updatePlayBtn();
        } catch (eP) {}
      }
      // Keep watchdog longer on dashboard: Unraid may replace tiles after first paint
      if (++n >= 25) {
        clearInterval(mountTimer);
        mountTimer = null;
      }
    }, 700);
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "visible") {
        mount();
        if (resumeIntent || sessionWantsResume(loadPlaySession())) {
          if (audio && audio.paused) schedulePlayRetries("visible");
        }
      }
    });
    try {
      window.addEventListener("pageshow", function (ev) {
        if (ev && ev.persisted) {
          resumeAttempted = false;
          mount();
        }
        if (resumeIntent || sessionWantsResume(loadPlaySession())) {
          if (!audio || audio.paused) schedulePlayRetries("pageshow");
        }
      });
    } catch (ePS) {}
  }

  global.UcwcMusic = {
    boot: boot,
    mount: mount,
    destroy: destroy,
    reload: function () {
      state.loaded = false;
      fetchList(true);
    },
  };

  function start() {
    try {
      // Prefer ThemeMusic-owned cfg if Loader already set it.
      if (global.__UCWC_MUSIC__ && typeof global.__UCWC_MUSIC__ === "object") {
        global.__UCWC_THEME__ = global.__UCWC_THEME__ || {};
        global.__UCWC_THEME__.music = global.__UCWC_MUSIC__;
      }
      if (global.__UCWC_MUSIC_BOOTED__ && global.UcwcMusic) {
        try {
          global.UcwcMusic.mount();
        } catch (eM) {}
        return;
      }
      global.__UCWC_MUSIC_BOOTED__ = true;
      // Pull server-side dash position before first place (survives reboot / other browsers)
      loadDashPosFromServer(function () {
        try {
          if (shouldShowCard() && root) placeInDashboard(root);
        } catch (eP) {}
      });
      boot();
    } catch (e) {}
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})(window);
