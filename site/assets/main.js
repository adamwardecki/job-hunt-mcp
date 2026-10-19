"use strict";

const CMDS = {
  sweep: {
    line: "/job-hunt:sweep",
    out: [
      "Inbox: 6 threads · 2 reply drafts, read back ✓",
      "Sources: 6 · 46 leads · 12 known companies skipped",
      "Dropped 31 with reasons · queued 3 with cover notes",
      "+Audit passed · 0 sent · nothing submitted",
    ],
  },
  setup: {
    line: "/job-hunt:setup",
    out: [
      "Step 2 of 11 · Hard filters",
      "Work mode: remote, hybrid (Lisbon)",
      "Pay floor: €80k, dropped only if the top of the band is lower",
      "Saved. Resume any time with /job-hunt:setup",
    ],
  },
  status: {
    line: "/job-hunt:status",
    out: [
      "Needs you: 1 question about Pinecrest",
      "Thu 14:00 · Halyard · technical screen",
      "Live 7 · interviewing 2 · queued 3",
    ],
  },
  apply: {
    line: "/job-hunt:apply 42",
    out: [
      "Opened Halyard application in browser",
      "Filled 14 fields · read back ✓",
      "Left 2 consent boxes unticked",
      "!Waiting for /job-hunt:approve 42",
    ],
  },
  approve: {
    line: "/job-hunt:approve 42",
    out: [
      "Approval noted · gate check passed",
      "Final read-back matches ✓",
      "+Submitted · Senior Platform Engineer, Halyard",
      "Confirmation text saved · status: applied",
    ],
  },
  consent: {
    line: "/job-hunt:allow-consent 42",
    out: [
      "Consent allowed for role 42 in this session",
      'Ticked "I agree to the processing of my data for this application"',
      "Marketing and talent-pool boxes left unticked",
    ],
  },
  cover: {
    line: "/job-hunt:cover-letter 43 --pdf",
    out: [
      "Drafted 184 words in your voice · writing check passed",
      "Exported one A4 page · checked visually",
    ],
  },
  prep: {
    line: "/job-hunt:prep pinecrest",
    out: [
      "Prep sheet · Pinecrest Health · technical screen",
      "10 likely questions mapped to your stories",
      "6 questions to ask",
      '!1 thin spot: no story for "scaling a data team"',
    ],
  },
  correct: {
    line: "/job-hunt:correct",
    out: [
      'Noted: "Fintech is fine, crypto isn\'t"',
      "+Saved as rule 12, with your reason and the example",
      "Role 51 moved back to scored",
    ],
  },
  triage: {
    line: "/job-hunt:triage jobcopilot",
    out: [
      "Applied column reconciled · 2 cards recorded in the tracker",
      "6 new leads from Saved",
      "+Deleted 28 in 3 guarded rounds · Applied count unchanged",
    ],
  },
  import: {
    line: "/job-hunt:import ~/notes/job-search",
    out: [
      "Read applied-log.md · 23 rows",
      "Imported 19 roles, 14 rules, 3 queue notes",
      "!4 rows unparsed, shown verbatim for you",
    ],
  },
};

const CLIENTS = {
  claude: {
    step1: "Add the marketplace and install the plugin",
    step2:
      "The local tracker starts automatically and keeps its data in ~/.job-hunt/tracker.db",
    config:
      "/plugin marketplace add adamwardecki/job-hunt-mcp\n/plugin install job-hunt@job-hunt",
  },
  hermes: {
    step1: "Install the native plugin from a checkout",
    step2:
      "When asked, type Y to enable all 32 tracker tools. Then restart Hermes",
    config:
      "git clone https://github.com/adamwardecki/job-hunt-mcp.git\ncd job-hunt-mcp\nscripts/hermes-install.sh",
  },
};

const $ = (id) => document.getElementById(id);

function initCopy() {
  const btn = $("copy-setup"),
    label = $("copy-label");
  let timer;
  btn.addEventListener("click", async () => {
    clearTimeout(timer);
    try {
      await navigator.clipboard.writeText("/job-hunt:setup");
      label.textContent = "Copied!";
    } catch {
      label.textContent = "Select & copy";
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(btn.querySelector("code"));
      selection.removeAllRanges();
      selection.addRange(range);
    }
    timer = setTimeout(() => {
      label.textContent = "Copy";
    }, 2000);
  });
}

function initCommands() {
  const btns = Array.from(document.querySelectorAll(".cmd"));
  const pick = (id) => {
    btns.forEach((b) => {
      const on = b.dataset.cmd === id;
      b.setAttribute("aria-pressed", on);
    });
    const cmd = CMDS[id];
    $("cmd-line").textContent = cmd.line;
    $("cmd-out").replaceChildren(
      ...cmd.out.map((t) => {
        const d = document.createElement("div");
        const flag = t[0];
        if (flag === "!") d.className = "output-warning";
        if (flag === "+") d.className = "output-success";
        d.textContent = flag === "!" || flag === "+" ? t.slice(1) : t;
        return d;
      }),
    );
  };
  btns.forEach((b) => b.addEventListener("click", () => pick(b.dataset.cmd)));
  pick("apply");
}

function initClients() {
  const tabs = Array.from(document.querySelectorAll(".client-tab"));
  const pick = (id) => {
    tabs.forEach((b) => {
      const on = b.dataset.client === id;
      b.setAttribute("aria-pressed", on);
    });
    const c = CLIENTS[id];
    $("install-step1").textContent = c.step1;
    $("install-step2").textContent = c.step2;
    $("install-config").textContent = c.config;
    $("install-docs").textContent =
      id === "hermes"
        ? "Read the Hermes setup guide ↗"
        : "Read the Claude Code setup guide ↗";
    $("install-docs").href =
      id === "hermes"
        ? "https://github.com/adamwardecki/job-hunt-mcp/blob/main/docs/hermes.md"
        : "https://github.com/adamwardecki/job-hunt-mcp#install";
  };
  tabs.forEach((b) =>
    b.addEventListener("click", () => pick(b.dataset.client)),
  );
  pick("claude");
}

initCopy();
initCommands();
initClients();
