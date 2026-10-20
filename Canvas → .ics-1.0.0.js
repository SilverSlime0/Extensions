// ==UserScript==
// @name         Canvas → .ics
// @namespace    https://github.com/silverslime0/Extensions
// @version      1.0.0
// @description  Export Canvas LMS assignment due dates as an .ics calendar file.
// @match        https://*.instructure.com/*
// @match        https://canvas.uw.edu/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";
  if (window.top !== window.self || document.getElementById("canvas-ics-host")) return;
  // Only run on actual Canvas pages (guards against over-broad custom @match lines).
  if (!document.getElementById("application") && !document.querySelector("body.ic-app, #wrapper.ic-Layout-wrapper, .ic-app")) {
    if (!/instructure\.com$/.test(location.hostname)) return;
  }

  /* ---------- Canvas API ---------- */

  async function apiPage(url) {
    const res = await fetch(url, {
      credentials: "include",
      headers: { Accept: "application/json+canvas-string-ids, application/json" },
    });
    if (!res.ok) throw new Error(`${new URL(url).pathname} returned ${res.status}`);
    const text = (await res.text()).replace(/^while\(1\);/, ""); // Canvas anti-hijack prefix
    const next = /<([^>]+)>;\s*rel="next"/.exec(res.headers.get("Link") || "");
    return { data: JSON.parse(text), next: next ? next[1] : null };
  }

  async function apiAll(path) {
    let url = `${location.origin}/api/v1${path}`;
    const out = [];
    while (url) {
      const { data, next } = await apiPage(url);
      out.push(...data);
      url = next;
    }
    return out;
  }

  async function collect({ currentCourseOnly, skipSubmitted }) {
    let courses = await apiAll("/courses?enrollment_state=active&per_page=100");
    courses = courses.filter((c) => c.name || c.course_code); // drop access-restricted stubs

    if (currentCourseOnly) {
      const m = location.pathname.match(/\/courses\/(\d+)/);
      if (!m) throw new Error("Open a course page first, or untick “Current course only”.");
      courses = courses.filter((c) => String(c.id) === m[1]);
    }

    const items = [];
    const errors = [];
    const results = await Promise.allSettled(
      courses.map(async (course) => {
        const assignments = await apiAll(
          `/courses/${course.id}/assignments?per_page=100&include[]=submission&order_by=due_at`
        );
        for (const a of assignments) {
          if (!a.due_at) continue;
          if (a.published === false) continue;
          const sub = a.submission;
          const submitted =
            sub && ["submitted", "graded", "pending_review"].includes(sub.workflow_state);
          if (skipSubmitted && submitted) continue;
          items.push({
            uid: `canvas-${course.id}-${a.id}@canvas-ics`,
            title: a.name || "Untitled assignment",
            course: course.course_code || course.name,
            points: a.points_possible,
            due: a.due_at,
            url: a.html_url || `${location.origin}/courses/${course.id}/assignments/${a.id}`,
          });
        }
      })
    );
    results.forEach((r, i) => {
      if (r.status === "rejected") errors.push(`${courses[i].course_code || courses[i].id}: ${r.reason.message}`);
    });
    items.sort((a, b) => new Date(a.due) - new Date(b.due));
    return { items, errors };
  }

  /* ---------- ICS generation (RFC 5545) ---------- */

  const icsEscape = (s) =>
    String(s).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

  const icsDate = (d) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

  function fold(line) {
    const enc = new TextEncoder();
    if (enc.encode(line).length <= 75) return line;
    const out = [];
    let cur = "", bytes = 0, limit = 75;
    for (const ch of line) {
      const b = enc.encode(ch).length;
      if (bytes + b > limit) { out.push(cur); cur = ""; bytes = 0; limit = 74; }
      cur += ch;
      bytes += b;
    }
    out.push(cur);
    return out.join("\r\n ");
  }

  function buildICS(items, { alarmMinutes = 1440, durationMin = 30 } = {}) {
    const now = icsDate(new Date());
    const lines = [
      "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Canvas to ICS//EN",
      "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "X-WR-CALNAME:Canvas Assignments",
    ];
    for (const it of items) {
      const due = new Date(it.due);
      if (isNaN(due)) continue;
      const start = new Date(due.getTime() - durationMin * 60000);
      const pts = it.points != null ? ` · ${it.points} pts` : "";
      lines.push(
        "BEGIN:VEVENT",
        `UID:${it.uid}`,
        `DTSTAMP:${now}`,
        `DTSTART:${icsDate(start)}`,
        `DTEND:${icsDate(due)}`,
        `SUMMARY:${icsEscape(`[${it.course}] ${it.title} (due)`)}`,
        `DESCRIPTION:${icsEscape(`${it.course}${pts}\n${it.url}`)}`,
        `URL:${it.url}`
      );
      if (alarmMinutes > 0) {
        lines.push(
          "BEGIN:VALARM", "ACTION:DISPLAY",
          `DESCRIPTION:${icsEscape(it.title)} is due soon`,
          `TRIGGER:-PT${alarmMinutes}M`, "END:VALARM"
        );
      }
      lines.push("END:VEVENT");
    }
    lines.push("END:VCALENDAR");
    return lines.map(fold).join("\r\n") + "\r\n";
  }

  function download(filename, text) {
    const blob = new Blob([text], { type: "text/calendar;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  /* ---------- UI (Shadow DOM) ---------- */

  const host = document.createElement("div");
  host.id = "canvas-ics-host";
  host.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:2147483647;";
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `
    <style>
      * { box-sizing: border-box; font: 13px system-ui, sans-serif; }
      #fab { width: 44px; height: 44px; border-radius: 50%; border: none; cursor: pointer;
             background: #e72429; color: #fff; font-size: 20px; box-shadow: 0 2px 10px #0005; }
      #panel { display: none; position: absolute; right: 0; bottom: 54px; width: 320px;
               background: #fff; color: #222; border-radius: 10px; padding: 14px;
               box-shadow: 0 4px 24px #0004; }
      #panel.open { display: block; }
      h1 { font-size: 15px; margin: 0 0 8px; font-weight: 600; }
      label { display: flex; align-items: center; gap: 6px; margin: 6px 0; }
      select { margin-left: auto; }
      button.b { width: 100%; padding: 8px; margin-top: 8px; border-radius: 6px; cursor: pointer;
                 border: 1px solid #bbb; background: #f5f5f5; color: #222; }
      button.b.primary { background: #e72429; border-color: #e72429; color: #fff; }
      button.b:disabled { opacity: .5; cursor: default; }
      #status { margin-top: 8px; min-height: 1.2em; }
      #status.err { color: #d33; }
      ul { list-style: none; padding: 0; margin: 8px 0 0; max-height: 200px; overflow: auto; }
      li { padding: 5px 0; border-top: 1px solid #ddd; }
      li small { display: block; color: #666; }
    </style>
    <button id="fab" title="Export assignments to .ics">📅</button>
    <div id="panel">
      <h1>Canvas → Calendar (.ics)</h1>
      <label><input type="checkbox" id="currentOnly"> Current course only</label>
      <label><input type="checkbox" id="upcomingOnly" checked> Upcoming only</label>
      <label><input type="checkbox" id="skipSubmitted" checked> Skip already submitted</label>
      <label>Reminder
        <select id="alarm">
          <option value="0">None</option>
          <option value="60">1 hour before</option>
          <option value="1440" selected>1 day before</option>
          <option value="2880">2 days before</option>
        </select>
      </label>
      <button class="b primary" id="scan">Scan assignments</button>
      <button class="b" id="dl" disabled>Download .ics</button>
      <div id="status"></div>
      <ul id="list"></ul>
    </div>`;
  document.body.appendChild(host);

  const $ = (id) => root.getElementById(id);
  let items = [];

  const setStatus = (msg, err = false) => {
    $("status").textContent = msg;
    $("status").className = err ? "err" : "";
  };

  $("fab").addEventListener("click", () => $("panel").classList.toggle("open"));

  $("scan").addEventListener("click", async () => {
    $("dl").disabled = true;
    $("list").innerHTML = "";
    setStatus("Scanning…");
    try {
      const res = await collect({
        currentCourseOnly: $("currentOnly").checked,
        skipSubmitted: $("skipSubmitted").checked,
      });
      items = res.items;
      if ($("upcomingOnly").checked) items = items.filter((i) => new Date(i.due) >= new Date());

      for (const it of items) {
        const li = document.createElement("li");
        li.textContent = it.title;
        const small = document.createElement("small");
        small.textContent = `${it.course} · ${new Date(it.due).toLocaleString()}`;
        li.appendChild(small);
        $("list").appendChild(li);
      }
      let msg = `Found ${items.length} assignment${items.length === 1 ? "" : "s"} with due dates.`;
      if (res.errors.length) msg += ` (${res.errors.length} course(s) failed: ${res.errors[0]})`;
      setStatus(msg, items.length === 0 && res.errors.length > 0);
      $("dl").disabled = items.length === 0;
    } catch (e) {
      setStatus(e.message, true);
    }
  });

  $("dl").addEventListener("click", () => {
    download("canvas-assignments.ics", buildICS(items, { alarmMinutes: Number($("alarm").value) }));
    setStatus("Downloaded. Import it into Google/Apple/Outlook Calendar.");
  });
})();