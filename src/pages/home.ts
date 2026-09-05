import type { CodexSessionSummary } from "../repositories/sessions/codex/types.js";

import { type SessionsPanelElement, type SessionSelectionChangeDetail } from "../components/SessionsPanel/types.js";
import { type ProjectsPanelElement, type ProjectSelectionChangeDetail } from "../components/ProjectsPanel/types.js";
import { type ContextPanelElement } from "../components/ContextPanel/types.js";

import { PageProps } from "./types.js";

import { ensureSessionsPanelDefined } from "../components/SessionsPanel/sessions-panel.js";
import { ensureProjectsPanelDefined } from "../components/ProjectsPanel/projects-panel.js";
import { ensureContextPanelDefined } from "../components/ContextPanel/context-panel.js";
import { Keybindings } from "../app/keybindings.types.js";
import { escapeHtml } from "../shared/lib/html/index.js";

function shortSessionId(sessionId: string): string {
  return sessionId.slice(0, 8);
}

export function renderHome({ document, projectPath, window }: PageProps) {
  ensureSessionsPanelDefined(window);
  ensureProjectsPanelDefined(window);
  ensureContextPanelDefined(window);

  document.body.innerHTML = `
    <div class="card">
      <legend>v1.0.0</legend>
      <div class="container-for-1-and-2">
        <div class="container-1">
          <sessions-panel class="container-1-1" id="panel-1" tabindex="0"></sessions-panel>

          <projects-panel class="container-1-2" id="panel-2" tabindex="0"></projects-panel>

          <context-panel class="container-1-3" id="panel-3" tabindex="0"></context-panel>
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

      <footer class="keybindings">
        <legend>Keybindings:</legend>
        <div class="keybindings-content">
          <span class="keybinding-color">Previous panel: h ↓</span> <span>|</span>
          <span class="keybinding-color">Next panel: l ↑</span> <span>|</span> 
          <span class="keybinding-color">Next item: j ↓</span> <span>|</span>
          <span class="keybinding-color">Previous item: k ↑</span> <span>|</span>
          <span class="keybinding-color">New session: n</span> <span>|</span>
          <span class="keybinding-color">Delete session: d</span> <span>|</span>
          <span class="keybinding-color">Quit: q</span> <span>|</span>
          <span class="keybinding-color">Help: ?</span>
          <!-- <span>1-4  Focus panel</span> -->
          <!-- <span>Esc  Back / close</span> -->
          <!-- <span>p  Prompt</span> -->
          <!-- <span>r  Resume session</span> -->
          <!-- <span>R  Rename session</span> -->
          <!-- <span>x  Stop session</span> -->
          <!-- <span>d  Delete session</span> -->
          <!-- <span>b  Change backend</span> -->
          <!-- <span>m  Change model</span> -->
          <!-- <span>g  Change project</span> -->
          <!-- <span>f  Filter sessions</span> -->
          <!-- <span>gg  First item</span> -->
          <!-- <span>G  Last item</span> -->
          <!-- <span>Ctrl+p  Command palette</span> -->
        </div>
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
        /* border: 1px solid red; */
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

      .footer {
        width: 97.5%;
        height: 5%;
        border: 1px solid #5fafff;
        border-radius: 5px;
        /* border: 1px solid red; */
      }

      .keybindings {
        display: flex;
        /* flex-direction: column; */
        justify-content: flex-start;
        align-items: center;
        width: 97.5%;
        height: 5%;
        border: 1px solid #5fafff;
        border-radius: 5px;
        /* border: 1px solid red; */
      }
      .keybinding-color {
        color: #5fafff;
      }
    </style>
  `;

  const panel1 = document.getElementById("panel-1");
  const panel2 = document.getElementById("panel-2");
  const panel3 = document.getElementById("panel-3");

  const detailsContent = document.getElementById("details-content");
  const statusContent = document.getElementById("status-content");

  const panels = [panel1, panel2, panel3].filter((panel): panel is NonNullable<typeof panel1> => panel !== null);

  const initialProjectName = projectPath.split("/").filter(Boolean).at(-1) ?? projectPath;
  let selectedProjectPath = projectPath;
  let selectedProjectName = initialProjectName;

  let selectedSession: CodexSessionSummary | null = null;

  let loadError: string | null = null;
  let projectLoadError: string | null = null;

  panel1?.focus();

  const sessionsPanel = panel1 as SessionsPanelElement | null;
  const projectsPanel = panel2 as ProjectsPanelElement | null;
  const contextPanel = panel3 as ContextPanelElement | null;

  function getSelectedSession(): CodexSessionSummary | null {
    return selectedSession;
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
    `;
  }

  function renderStatusBar() {
    if (!statusContent) return;

    const selectedSession = getSelectedSession();

    if (projectLoadError) {
      statusContent.innerHTML = escapeHtml(projectLoadError);
      return;
    }

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
    renderDetailsPanel();
    renderStatusBar();
  }

  function syncContextPanel() {
    if (!contextPanel) return;

    contextPanel.projectName = selectedProjectName;
    contextPanel.projectPath = selectedProjectPath;
    contextPanel.selectedSession = selectedSession;
  }

  function onProjectChange(event: Event) {
    const customEvent = event as CustomEvent<ProjectSelectionChangeDetail>;
    const selectedProject = customEvent.detail.project;

    projectLoadError = customEvent.detail.error;

    if (selectedProject) {
      selectedProjectPath = selectedProject.path;
      selectedProjectName = selectedProject.name;
      selectedSession = null;
      loadError = null;

      if (sessionsPanel && sessionsPanel.projectPath !== selectedProject.path) {
        sessionsPanel.projectPath = selectedProject.path;
      }
    } else {
      selectedProjectPath = projectPath;
      selectedProjectName = initialProjectName;
      selectedSession = null;
    }

    syncContextPanel();
    renderPanels();
  }

  function onSessionChange(event: Event) {
    const customEvent = event as CustomEvent<SessionSelectionChangeDetail>;

    selectedSession = customEvent.detail.session;
    selectedProjectPath = customEvent.detail.projectPath || selectedProjectPath;
    loadError = customEvent.detail.error;
    syncContextPanel();
    renderPanels();
  }

  function onKeyDown(event: KeyboardEvent) {
    const key = event.key.toLowerCase();
    const active = document.activeElement;

    if (!event.altKey && !event.ctrlKey && !event.metaKey && key === Keybindings.Q) {
      event.preventDefault();
      window.close();
      return;
    }

    if (key !== Keybindings.H && key !== Keybindings.L) return;

    const currentIndex = panels.findIndex((panel) => panel === active);

    if (currentIndex === -1) return;

    const direction = key === Keybindings.L ? 1 : -1;
    const nextIndex = (currentIndex + direction + panels.length) % panels.length;

    event.preventDefault();
    panels[nextIndex].focus();
  }

  document.addEventListener("keydown", onKeyDown);

  projectsPanel?.addEventListener("project-change", onProjectChange);
  sessionsPanel?.addEventListener("session-change", onSessionChange);

  if (projectsPanel) {
    projectsPanel.projectPath = projectPath;
  }

  syncContextPanel();

  if (sessionsPanel) {
    sessionsPanel.projectPath = projectPath;
  }

  renderPanels();

  return () => {
    projectsPanel?.removeEventListener("project-change", onProjectChange);
    sessionsPanel?.removeEventListener("session-change", onSessionChange);
    document.removeEventListener("keydown", onKeyDown);
  };
}
