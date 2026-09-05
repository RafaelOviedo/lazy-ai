import type { CodexSessionSummary } from "../repositories/sessions/codex/types.js";

import { type SessionsPanelElement, type SessionSelectionChangeDetail } from "../components/SessionsPanel/types.js";
import { type ProjectsPanelElement, type ProjectSelectionChangeDetail } from "../components/ProjectsPanel/types.js";
import { type ContextPanelElement } from "../components/ContextPanel/types.js";
import { type DetailsPanelElement } from "../components/DetailsPanel/types.js";
import { type StatusPanelElement } from "../components/StatusPanel/types.js";

import { PageProps } from "./types.js";
import { Keybindings } from "../app/keybindings.types.js";

import { ensureSessionsPanelDefined } from "../components/SessionsPanel/sessions-panel.js";
import { ensureProjectsPanelDefined } from "../components/ProjectsPanel/projects-panel.js";
import { ensureContextPanelDefined } from "../components/ContextPanel/context-panel.js";
import { ensureDetailsPanelDefined } from "../components/DetailsPanel/details-panel.js";
import { ensureStatusPanelDefined } from "../components/StatusPanel/status-panel.js";
import { ensureKeybindingsPanelDefined } from "../components/KeybindingsPanel/keybindings-panel.js";
import { ensureModalDefined } from "../components/Modal/modal.js";

import { useModal } from "../composables/useModal.js";
import { ModalName } from "../shared/lib/modal/index.js";

export function renderHome({ document, projectPath, window }: PageProps) {
  ensureSessionsPanelDefined(window);
  ensureProjectsPanelDefined(window);
  ensureContextPanelDefined(window);
  ensureDetailsPanelDefined(window);
  ensureStatusPanelDefined(window);
  ensureKeybindingsPanelDefined(window);
  ensureModalDefined(window);

  const { getModalConfig, openModal } = useModal();

  document.body.innerHTML = `
    <div class="card">
      <legend>v0.0.1</legend>
      <div class="container-for-1-and-2">
        <div class="container-1">
          <sessions-panel class="container-1-1" id="panel-1" tabindex="0"></sessions-panel>
          <projects-panel class="container-1-2" id="panel-2" tabindex="0"></projects-panel>
          <context-panel class="container-1-3" id="panel-3" tabindex="0"></context-panel>
        </div>

        <details-panel id="details-panel"></details-panel>
      </div>

      <status-panel id="status-panel"></status-panel>
      <keybindings-panel></keybindings-panel>

      <app-modal id="modal-root"></app-modal>
    </div>

    <style>
      .card {
        display: flex;
        flex-direction: column;
        justify-content: space-evenly;
        align-items: center;
        position: relative;
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

    </style>
  `;

  const panel1 = document.getElementById("panel-1");
  const panel2 = document.getElementById("panel-2");
  const panel3 = document.getElementById("panel-3");
  const detailsPanelElement = document.getElementById("details-panel");
  const statusPanelElement = document.getElementById("status-panel");

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
  const detailsPanel = detailsPanelElement as DetailsPanelElement | null;
  const statusPanel = statusPanelElement as StatusPanelElement | null;

  function renderPanels() {
    syncDetailsPanel();
    syncStatusPanel();
  }

  function syncDetailsPanel() {
    if (!detailsPanel) return;

    detailsPanel.selectedSession = selectedSession;
  }

  function syncStatusPanel() {
    if (!statusPanel) return;

    statusPanel.projectLoadError = projectLoadError;
    statusPanel.loadError = loadError;
    statusPanel.selectedSession = selectedSession;
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

    if (getModalConfig().isActive && getModalConfig().component === ModalName.helpInfoModal) return;
    if (handleModalShortcuts(event, key)) return;
    if (handleQuitShortcut(event, key)) return;
    if (handlePanelNavigation(event, key)) return;
  }

  function handleModalShortcuts(event: KeyboardEvent, key: string): boolean {
    if (!isPlainKeyEvent(event) || key !== Keybindings.QUESTION_MARK) return false;

    event.preventDefault();
    openModal(ModalName.helpInfoModal);
    return true;
  }

  function handleQuitShortcut(event: KeyboardEvent, key: string): boolean {
    if (!isPlainKeyEvent(event) || key !== Keybindings.Q) return false;

    event.preventDefault();
    window.close();
    return true;
  }

  function handlePanelNavigation(event: KeyboardEvent, key: string): boolean {
    if (key !== Keybindings.H && key !== Keybindings.L) return false;

    const active = document.activeElement;
    const currentIndex = panels.findIndex((panel) => panel === active);

    if (currentIndex === -1) return false;

    const direction = key === Keybindings.L ? 1 : -1;
    const nextIndex = (currentIndex + direction + panels.length) % panels.length;

    event.preventDefault();
    panels[nextIndex].focus();
    return true;
  }

  function isPlainKeyEvent(event: KeyboardEvent): boolean {
    return !event.altKey && !event.ctrlKey && !event.metaKey;
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
