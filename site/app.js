// Page behaviour: replay player, compaction fold, copy buttons.
// The replay text is recorded output (site/recordings.js). Nothing here generates output.
(function () {
  "use strict";

  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var BASE_CHARS_PER_SEC = 420; // replay speed at 1x
  var SCRUB_STEPS = 1000;

  // ---------- Replay player ----------
  function initReplay() {
    var data = window.QUILL_RECORDINGS;
    var root = document.querySelector("[data-player]");
    var screen = document.getElementById("screen");
    if (!data || !root || !screen) return;

    var playBtn = document.getElementById("play");
    var restartBtn = document.getElementById("restart");
    var scrub = document.getElementById("scrub");
    var clock = document.getElementById("clock");
    var note = document.getElementById("term-note");
    var speedBtns = root.querySelectorAll("[data-speed]");
    var tabs = root.querySelectorAll("[role=tab]");

    var demos = {};
    data.demos.forEach(function (d) { demos[d.id] = d; });

    var state = {
      id: "bugfix",
      text: "",
      idx: 0,
      playing: false,
      speed: 1,
      last: 0,
      frame: null,
      autoplayed: {},
      inView: false
    };

    function fullText(demo) {
      var body = demo.events.map(function (e) { return e[1]; }).join("");
      return "$ " + demo.command + "\n" + body;
    }

    function render() {
      var caret = document.createElement("span");
      caret.className = "caret";
      if (!state.playing) caret.hidden = true;
      screen.replaceChildren(document.createTextNode(state.text.slice(0, state.idx)), caret);
      var total = state.text.length;
      var pct = total ? Math.round((state.idx / total) * SCRUB_STEPS) : 0;
      scrub.value = String(pct);
      scrub.setAttribute("aria-valuetext", Math.round(state.idx / total * 100) + "% of the recorded output");
      clock.textContent = (state.idx / BASE_CHARS_PER_SEC).toFixed(1) + "s / " + (total / BASE_CHARS_PER_SEC).toFixed(1) + "s";
      playBtn.textContent = state.playing ? "Pause" : (state.idx >= total && total > 0 ? "Replay" : "Play");
      playBtn.setAttribute("aria-label", state.playing ? "Pause replay" : "Play replay");
      playBtn.setAttribute("aria-pressed", String(state.playing));
      if (state.playing) screen.scrollTop = screen.scrollHeight;
    }

    function stopLoop() {
      if (state.frame !== null) cancelAnimationFrame(state.frame);
      state.frame = null;
    }

    function tick(now) {
      if (!state.playing) return;
      var dt = state.last ? (now - state.last) / 1000 : 0;
      state.last = now;
      state.idx = Math.min(state.text.length, state.idx + dt * BASE_CHARS_PER_SEC * state.speed);
      if (state.idx >= state.text.length) {
        state.idx = state.text.length;
        state.playing = false;
        stopLoop();
        render();
        return;
      }
      render();
      state.frame = requestAnimationFrame(tick);
    }

    function play() {
      if (state.idx >= state.text.length) state.idx = 0;
      if (reduced) {
        state.idx = state.text.length;
        state.playing = false;
        render();
        return;
      }
      if (state.playing) return;
      state.playing = true;
      state.last = 0;
      stopLoop();
      state.frame = requestAnimationFrame(tick);
      render();
    }

    function pause() {
      state.playing = false;
      stopLoop();
      render();
    }

    function toggle() {
      if (state.playing) pause(); else play();
    }

    function select(id, opts) {
      pause();
      state.id = id;
      var demo = demos[id];
      if (!demo) return;
      state.text = fullText(demo);
      state.idx = 0;
      tabs.forEach(function (t) {
        var on = t.dataset.demo === id;
        t.setAttribute("aria-selected", String(on));
        t.tabIndex = on ? 0 : -1;
        if (on) screen.setAttribute("aria-labelledby", t.id);
      });
      screen.id = "screen";
      note.textContent = "Recorded output from " + demo.command + ", recorded " + data.recordedOn + ". Scripted model, no live run.";
      render();
      if (opts && opts.play) play();
    }

    // Autoplay once per demo, the first time the replay is at least half on screen.
    // Pause when it scrolls away so playback stays in view.
    if ("IntersectionObserver" in window) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          state.inView = entry.intersectionRatio >= 0.5;
          if (state.inView && !state.autoplayed[state.id]) {
            state.autoplayed[state.id] = true;
            play();
          } else if (!entry.isIntersecting || entry.intersectionRatio < 0.2) {
            if (state.playing) pause();
          }
        });
      }, { threshold: [0, 0.2, 0.5] });
      io.observe(root);
    }

    tabs.forEach(function (t) {
      t.addEventListener("click", function () { select(t.dataset.demo, { play: state.inView }); });
    });
    playBtn.addEventListener("click", toggle);
    restartBtn.addEventListener("click", function () { pause(); state.idx = 0; render(); play(); });
    document.querySelectorAll("[data-replay-restart]").forEach(function (a) {
      a.addEventListener("click", function () { pause(); state.idx = 0; render(); play(); });
    });

    scrub.addEventListener("input", function () {
      state.idx = Math.round((Number(scrub.value) / SCRUB_STEPS) * state.text.length);
      render();
    });

    speedBtns.forEach(function (b) {
      b.addEventListener("click", function () {
        state.speed = Number(b.dataset.speed);
        speedBtns.forEach(function (o) { o.setAttribute("aria-pressed", String(o === b)); });
      });
    });

    screen.addEventListener("keydown", function (e) {
      if (e.key === " ") { e.preventDefault(); toggle(); }
    });

    // Keep the recorded output shown from the start until the reader presses play.
    select("bugfix", {});
    if (reduced) {
      state.idx = state.text.length;
      render();
    }
  }

  // ---------- Compaction fold ----------
  function initFold() {
    var fig = document.getElementById("fold");
    var btn = document.getElementById("fold-replay");
    if (!fig || !btn) return;
    var timers = [];

    function setState(s) { fig.dataset.state = s; }
    function clearTimers() { timers.forEach(clearTimeout); timers = []; }

    function foldLater(delay) {
      clearTimers();
      setState("before");
      // Force a reflow so the transition restarts from the unfolded layout.
      void fig.offsetWidth;
      timers.push(setTimeout(function () { setState("folded"); }, delay));
    }

    if (reduced) { setState("folded"); btn.disabled = false; }

    var played = false;
    if ("IntersectionObserver" in window && !reduced) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting && entry.intersectionRatio >= 0.5 && !played) {
            played = true;
            timers.push(setTimeout(function () { setState("folded"); }, 900));
          }
        });
      }, { threshold: [0, 0.5] });
      io.observe(fig);
    } else if (!reduced) {
      setState("folded");
    }

    btn.addEventListener("click", function () {
      if (reduced) return;
      foldLater(700);
    });
  }

  // ---------- Copy buttons ----------
  function initCopy() {
    document.querySelectorAll("[data-copy]").forEach(function (b) {
      var label = b.textContent;
      b.addEventListener("click", function () {
        var text = b.dataset.copy;
        var done = function (ok) {
          b.textContent = ok ? "Copied" : "Select to copy";
          b.dataset.copied = String(ok);
          setTimeout(function () {
            b.textContent = label;
            b.dataset.copied = "false";
          }, 1600);
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(false); });
        } else {
          done(false);
        }
      });
    });
  }

  initReplay();
  initFold();
  initCopy();
})();
