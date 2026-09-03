import type { CodexSessionSummary } from "../repositories/sessions/codex/types.js";

import { type SessionsPanelElement, type SessionSelectionChangeDetail } from "../components/SessionsPanel/types.js";

import { PageProps } from "./types.js";

import { ensureSessionsPanelDefined } from "../components/SessionsPanel/sessions-panel.js";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function shortSessionId(sessionId: string): string {
  return sessionId.slice(0, 8);
}

export function renderHome({ document, projectPath, window }: PageProps) {
  ensureSessionsPanelDefined(window);

  document.body.innerHTML = `
    <div class="card">
      <div class="container-for-1-and-2">
        <div class="container-1">
          <sessions-panel class="container-1-1" id="panel-1" tabindex="0"></sessions-panel>

          <div class="container-1-2" id="panel-2" tabindex="0">
            <legend style="color: #5fafff;">Projects</legend>
            <div class="panel-content" id="projects-content"></div>
          </div>

          <div class="container-1-3" id="panel-3" tabindex="0">
            <legend style="color: #5fafff;">Context</legend>
            <div class="panel-content" id="context-content"></div>
          </div>
        </div>

        <div class="container-2" id="details-panel">
          <legend style="color: #5fafff;">Details</legend>
          <div class="panel-content" id="details-content"></div>
        </div>
      </div>

      <footer class="footer">
        <legend style="color: #5fafff;">Current status</legend>
        <div class="footer-content" id="status-content"></div>
      </footer>
    </div>

    <style>
      .card {
        display: flex;
        flex-direction: column;
        justify-content: space-evenly;
        align-items: center;
        border: 1px solid #5fafff;
        padding: 0 1ch;
        width: 100%;
        height: 100%;
        border-radius: 5px;
      }

      .container-for-1-and-2 {
        display: flex;
        flex-direction: row;
        justify-content: space-evenly;
        width: 98%;
        height: 90%;
      }

      .container-1 {
        display: flex;
        flex-direction: column;
        justify-content: space-evenly;
        width: 30%;
        height: 87%;
      }

      .container-2 {
        width: 67%;
        height: 87%;
        border: 1px solid #5fafff;
        border-radius: 5px;
      }

      .container-1-2 {
        width: fit-content;
        height: 39%;
        border: 1px solid #5fafff;
        border-radius: 5px;
      }

      .container-1-3 {
        width: fit-content;
        height: 29%;
        border: 1px solid #5fafff;
        border-radius: 5px;
      }

     .container-1-1:focus,
     .container-1-2:focus,
     .container-1-3:focus {
       border-color: #fff;
     }

      .panel-content,
      .footer-content {
        padding: 0.5rem 1ch;
      }

      .panel-content {
        white-space: pre-wrap;
      }

      .session-title {
        color: #d7ecff;
      }

      .session-meta,
      .muted {
        color: #8aa4bf;
      }

      .project-name {
        color: #d7ecff;
        font-weight: bold;
      }

      .footer {
        width: 97.5%;
        height: 10%;
        border: 1px solid #5fafff;
      }
    </style>
  `;

  const panel1 = document.getElementById("panel-1");
  const panel2 = document.getElementById("panel-2");
  const panel3 = document.getElementById("panel-3");
  const projectsContent = document.getElementById("projects-content");
  const contextContent = document.getElementById("context-content");
  const detailsContent = document.getElementById("details-content");
  const statusContent = document.getElementById("status-content");

  const panels = [panel1, panel2, panel3].filter((panel): panel is NonNullable<typeof panel1> => panel !== null);
  const projectName = projectPath.split("/").filter(Boolean).at(-1) ?? projectPath;
  let selectedSession: CodexSessionSummary | null = null;
  let sessionCount = 0;
  let loadError: string | null = null;

  panel1?.focus();

  const sessionsPanel = panel1 as SessionsPanelElement | null;

  function renderProjectsPanel() {
    if (!projectsContent) return;

    projectsContent.innerHTML = `
      <div class="project-name">${escapeHtml(projectName)}</div>
      <div class="muted">${escapeHtml(projectPath)}</div>
      <div class="muted" style="margin-top: 0.5rem;">Sessions in this project: ${sessionCount}</div>
    `;
  }

  function getSelectedSession(): CodexSessionSummary | null {
    return selectedSession;
  }

  function renderContextPanel() {
    if (!contextContent) return;

    const selectedSession = getSelectedSession();

    if (!selectedSession) {
      contextContent.innerHTML = `
        <div class="muted">Source</div>
        <div>~/.codex session history</div>
        <div class="muted" style="margin-top: 0.5rem;">Project</div>
        <div>${escapeHtml(projectName)}</div>
      `;
      return;
    }

    contextContent.innerHTML = `
      <div class="muted">Session ID</div><div>${escapeHtml(shortSessionId(selectedSession.id))}</div>
      <div class="muted" style="margin-top: 0.5rem;">Model</div><div>${escapeHtml(selectedSession.model)}</div>
      <div class="muted" style="margin-top: 0.5rem;">Updated</div><div>${escapeHtml(selectedSession.relativeUpdated)}</div>
    `;
  }

  function renderDetailsPanel() {
    if (!detailsContent) return;

    const selectedSession = getSelectedSession();

    if (!selectedSession) {
      detailsContent.innerHTML = `
        <div>No session selected yet.</div>
        <div class="muted" style="margin-top: 0.5rem;">This panel will show transcript and tool activity once session interaction is wired in.</div>
      `;
      return;
    }

    detailsContent.innerHTML = `
      <div class="session-title">${escapeHtml(selectedSession.title)}</div>
      <div class="muted" style="margin-top: 0.5rem;">Project</div>
      <div>${escapeHtml(selectedSession.projectPath)}</div>
      <div class="muted" style="margin-top: 0.5rem;">Last updated</div>
      <div>${escapeHtml(selectedSession.updatedAt || selectedSession.relativeUpdated)}</div>
      <div class="muted" style="margin-top: 0.5rem;">Next</div>
      <div>Resume this session and stream its activity into this panel.</div>
      <div class="muted" style="margin-top: 0.5rem;">Navigation: j/k to move inside Sessions, h/l to move across panels.</div>
    `;
  }

  function renderStatusBar() {
    if (!statusContent) return;

    const selectedSession = getSelectedSession();

    if (loadError) {
      statusContent.innerHTML = escapeHtml(loadError);
      return;
    }

    if (!selectedSession) {
      statusContent.innerHTML = "Sessions panel ready. No saved session selected.";
      return;
    }

    statusContent.innerHTML = `Codex · ${escapeHtml(selectedSession.status)} · ${escapeHtml(selectedSession.relativeUpdated)} · ${escapeHtml(shortSessionId(selectedSession.id))}`;
  }

  function renderPanels() {
    renderProjectsPanel();
    renderContextPanel();
    renderDetailsPanel();
    renderStatusBar();
  }

  function onSessionChange(event: Event) {
    const customEvent = event as CustomEvent<SessionSelectionChangeDetail>;

    selectedSession = customEvent.detail.session;
    sessionCount = customEvent.detail.sessionCount;
    loadError = customEvent.detail.error;
    renderPanels();
  }

  sessionsPanel?.addEventListener("session-change", onSessionChange);
  if (sessionsPanel) {
    sessionsPanel.projectPath = projectPath;
  }
  renderPanels();

  function onKeyDown(event: KeyboardEvent) {
    const key = event.key.toLowerCase();
    const active = document.activeElement;

    if (key !== "h" && key !== "l") return;

    const currentIndex = panels.findIndex((panel) => panel === active);

    if (currentIndex === -1) return;

    const direction = key === "l" ? 1 : -1;
    const nextIndex = (currentIndex + direction + panels.length) % panels.length;

    event.preventDefault();
    panels[nextIndex].focus();
  }

  // function goToExample(event: Event) {
  //   event.preventDefault();
  //   navigate(RoutesNames.EXAMPLE);
  // }

  document.addEventListener("keydown", onKeyDown);

  return () => {
    sessionsPanel?.removeEventListener("session-change", onSessionChange);
    document.removeEventListener("keydown", onKeyDown);
  };

  // document.getElementById("go-example")?.addEventListener("click", goToExample);
}
