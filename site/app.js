// Replays the recorded demo output (site/recordings.js) line by line.
// Scripted model: the text was captured from the real make targets; nothing is generated here.
(function () {
  "use strict";
  var data = window.QUILL_RECORDINGS;
  var screen = document.getElementById("screen");
  var play = document.getElementById("play");
  var note = document.getElementById("term-note");
  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var LINE_MS = 60;
  var timer = null;
  var current = "bugfix";

  if (!data || !screen) return;
  var demos = {};
  data.demos.forEach(function (d) { demos[d.id] = d; });

  data.demos.forEach(function (d) {
    var el = document.getElementById("dur-" + d.id);
    if (el) el.textContent = d.durationMs + " ms";
  });

  function lines(demo) {
    var text = demo.events.map(function (e) { return e[1]; }).join("");
    return text.split("\n");
  }

  function stop() {
    if (timer) { clearTimeout(timer); timer = null; }
  }

  function show(id) {
    stop();
    current = id;
    var demo = demos[id];
    document.querySelectorAll("[role=tab]").forEach(function (t) {
      t.setAttribute("aria-selected", String(t.dataset.demo === id));
    });
    screen.textContent = "";
    note.textContent = "Scripted model. Recorded output from " + demo.command + ", recorded " + data.recordedOn + ".";
    run(demo);
  }

  function run(demo) {
    var all = lines(demo);
    if (reduced) {
      screen.textContent = prompt(demo) + all.join("\n");
      play.disabled = false;
      return;
    }
    play.disabled = true;
    screen.textContent = prompt(demo);
    var i = 0;
    var span = document.createElement("span");
    screen.appendChild(span);
    var caret = document.createElement("span");
    caret.className = "caret";
    screen.appendChild(caret);
    (function step() {
      if (i >= all.length) {
        caret.remove();
        play.disabled = false;
        return;
      }
      span.textContent += (i > 0 ? "\n" : "") + all[i];
      i += 1;
      screen.scrollTop = screen.scrollHeight;
      timer = setTimeout(step, LINE_MS);
    })();
  }

  function prompt(demo) {
    return "$ " + demo.command + "\n";
  }

  document.querySelectorAll("[role=tab]").forEach(function (t) {
    t.addEventListener("click", function () { show(t.dataset.demo); });
  });
  play.addEventListener("click", function () { show(current); });
  show(current);
})();
