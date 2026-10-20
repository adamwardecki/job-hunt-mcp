"use strict";

const tabs = [...document.querySelectorAll("[role=tab]")];
function selectTab(tab) {
  tabs.forEach((t) => {
    const active = t === tab;
    t.setAttribute("aria-selected", String(active));
    t.tabIndex = active ? 0 : -1;
    document.getElementById(t.getAttribute("aria-controls")).hidden = !active;
  });
}
tabs.forEach((tab, index) => {
  tab.addEventListener("click", () => selectTab(tab));
  tab.addEventListener("keydown", (e) => {
    let next;
    if (e.key === "ArrowRight") next = (index + 1) % tabs.length;
    if (e.key === "ArrowLeft") next = (index + tabs.length - 1) % tabs.length;
    if (e.key === "Home") next = 0;
    if (e.key === "End") next = tabs.length - 1;
    if (next !== undefined) {
      e.preventDefault();
      selectTab(tabs[next]);
      tabs[next].focus();
    }
  });
});
document.querySelectorAll("[data-copy]").forEach((button) => {
  button.addEventListener("click", async () => {
    const label = button.textContent;
    try {
      await navigator.clipboard.writeText(button.dataset.copy);
      button.textContent = "Copied!";
    } catch {
      button.textContent = "Select to copy";
      const range = document.createRange();
      range.selectNodeContents(button.previousElementSibling);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    }
    setTimeout(() => (button.textContent = label), 2000);
  });
});
const examples = {
  find: {
    prompt: "Find marketing roles that fit my experience. Remote is a must.",
    reply:
      '<p>I found three roles worth a closer look. Halyard’s Marketing Manager role matches your experience and salary range.</p><div class="result-note"><strong>One less thing to check.</strong><p>I checked the employer’s posting: it’s fully remote in Europe. Two other listings said “remote” but required office days, so I left those out.</p></div><p>Would you like to see the shortlist?</p>',
    command: "/j-hunt:sweep --limit 5",
  },
  apply: {
    prompt: "Help me apply for the Marketing Manager role at Halyard.",
    reply:
      '<p>I’ve drafted a cover note using the campaign experience from your CV and filled in the application form.</p><div class="result-note"><strong>Ready for your review.</strong><p>I’ll show you the completed form and the exact approval shortcut before anything is submitted. Consent boxes still need your attention.</p></div><p>Let’s read it through together.</p>',
    command: "/j-hunt:apply 42",
  },
  prep: {
    prompt: "Help me prepare for my interview with Halyard.",
    reply:
      '<p>Let’s start with your experience leading the spring campaign. It’s a useful example for the role’s focus on planning and working across teams.</p><div class="result-note"><strong>A little structure for the conversation.</strong><p>I’ve prepared likely questions, examples from your own experience, and questions you can ask the team.</p></div><p>Which part would you like to practise first?</p>',
    command: "/j-hunt:prep halyard",
  },
};
document.querySelectorAll("[data-example]").forEach((button) =>
  button.addEventListener("click", () => {
    document
      .querySelectorAll("[data-example]")
      .forEach((b) => b.setAttribute("aria-pressed", String(b === button)));
    const data = examples[button.dataset.example];
    document.getElementById("example-prompt").textContent = data.prompt;
    document.getElementById("example-reply").innerHTML = data.reply;
    document.getElementById("example-command").textContent = data.command;
  }),
);
