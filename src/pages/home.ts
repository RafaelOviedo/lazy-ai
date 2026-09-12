import type { ModelOption, SessionSummary, UsageLimitSnapshot } from "../app/types/index.js";
import { createProviderProfile, createUnavailableRuntimeClient } from "../app/registry/index.js";
import { getActiveProvider, setActiveProvider } from "../app/store/active-provider.js";
import { listProviderModels, resolveDefaultModel } from "../app/models/index.js";

import { type SessionsPanelElement, type SessionDeleteRequestDetail, type SessionResumeRequestDetail, type SessionSelectionChangeDetail } from "../components/SessionsPanel/types.js";
import { type ProjectsPanelElement, type ProjectSelectionChangeDetail } from "../components/ProjectsPanel/types.js";
import { type ContextPanelElement } from "../components/ContextPanel/types.js";
import { type DetailsPanelElement } from "../components/DetailsPanel/types.js";
import { type StatusPanelElement } from "../components/StatusPanel/types.js";
import { type KeybindingsPanelElement } from "../components/KeybindingsPanel/types.js";

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
import { createSessionDeleteController, createSessionPromptController, createSessionResumeController, createSessionStartController } from "../shared/lib/sessions/index.js";

export function renderHome({ document, projectPath, window }: PageProps) {
  ensureSessionsPanelDefined(window);
  ensureProjectsPanelDefined(window);
  ensureContextPanelDefined(window);
  ensureDetailsPanelDefined(window);
  ensureStatusPanelDefined(window);
  ensureKeybindingsPanelDefined(window);
  ensureModalDefined(window);

  const { closeModal, getModalConfig, openModal } = useModal();
  const activeProvider = getActiveProvider();
  const providerProfile = createProviderProfile(activeProvider.providerId, activeProvider.modelId);
  const sessionReader = providerProfile.sessions;
  const canDriveSessions = providerProfile.client !== null;
  const appServerClient = providerProfile.client ?? createUnavailableRuntimeClient(providerProfile.label);

  document.body.innerHTML = `
    <div class="card">
      <div class="container-for-1-and-2">
        <div class="container-1">
          <sessions-panel class="container-1-1" id="panel-1" tabindex="0"></sessions-panel>
          <projects-panel class="container-1-2" id="panel-2" tabindex="0"></projects-panel>
          <context-panel class="container-1-3" id="panel-3" tabindex="0"></context-panel>
        </div>

        <details-panel id="details-panel" tabindex="0"></details-panel>
      </div>

      <status-panel id="status-panel"></status-panel>
      <keybindings-panel id="keybindings-panel"></keybindings-panel>

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
        height: 85%;
      }

      .container-1 {
        display: flex;
        flex-direction: column;
        justify-content: space-evenly;
        width: 30%;
        height: 82%;
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
  const keybindingsPanelElement = document.getElementById("keybindings-panel");

  const panels = [panel1, panel2, panel3, detailsPanelElement].filter((panel): panel is HTMLElement => panel !== null);

  const initialProjectName = projectPath.split(/[\\/]/).filter(Boolean).at(-1) ?? projectPath;
  let selectedProjectPath = projectPath;
  let selectedProjectName = initialProjectName;

  let selectedSession: SessionSummary | null = null;
  let usageLimitSnapshot: UsageLimitSnapshot | null = null;

  let loadError: string | null = null;
  let projectLoadError: string | null = null;
  let defaultModelLabel: string | null = null;

  panel1?.focus();

  const sessionsPanel = panel1 as SessionsPanelElement | null;
  const projectsPanel = panel2 as ProjectsPanelElement | null;
  const contextPanel = panel3 as ContextPanelElement | null;
  const detailsPanel = detailsPanelElement as DetailsPanelElement | null;
  const statusPanel = statusPanelElement as StatusPanelElement | null;
  const keybindingsPanel = keybindingsPanelElement as KeybindingsPanelElement | null;

  function onSessionsPanelFocus() {
    if (keybindingsPanel) {
      keybindingsPanel.focusedPanel = "sessions";
    }
  }

  function onProjectsPanelFocus() {
    if (keybindingsPanel) {
      keybindingsPanel.focusedPanel = "projects";
    }
  }

  const sessionResumeController = createSessionResumeController({
    client: appServerClient,
    setActiveSessionId: (sessionId) => {
      setInterruptedSession(null);
      if (sessionsPanel) {
        sessionsPanel.activeSessionId = sessionId;
      }
    },
    setLoadError: (error) => {
      loadError = error;
    },
    setSessionAlreadyRunning: (sessionId) => sessionsPanel?.setSessionAlreadyRunning(sessionId),
    setSessionResumeFailed: (sessionId) => sessionsPanel?.setSessionResumeFailed(sessionId),
    setSessionResuming: (sessionId) => sessionsPanel?.setSessionResuming(sessionId),
    syncStatusPanel,
  });

  const sessionDeleteController = createSessionDeleteController({
    clearActiveSession: (sessionId) => sessionResumeController.clearActiveSession(sessionId),
    client: appServerClient,
    reloadSessions: () => sessionsPanel?.reload() ?? Promise.resolve(),
    setLoadError: (error) => {
      loadError = error;
    },
    setSessionDeleting: (sessionId) => sessionsPanel?.setSessionDeleting(sessionId),
    syncStatusPanel,
  });

  const sessionStartController = createSessionStartController({
    client: appServerClient,
    getSession: (sessionId) => sessionsPanel?.getSession(sessionId) ?? null,
    setActiveSession: (sessionId, threadId) => sessionResumeController.markSessionActive(sessionId, threadId),
    setDetailsInterruptedSessionId: (sessionId) => {
      if (detailsPanel) {
        detailsPanel.interruptedSessionId = sessionId;
      }
    },
    setDetailsThinkingSessionId: (sessionId) => {
      if (detailsPanel) {
        detailsPanel.thinkingSessionId = sessionId;
      }
    },
    setLoadError: (error) => {
      loadError = error;
    },
    setSessionInterrupted: (sessionId) => sessionsPanel?.setSessionInterrupted(sessionId),
    setSessionThinking: (sessionId) => sessionsPanel?.setSessionThinking(sessionId),
    syncConversation: (sessionId) => detailsPanel?.syncConversation(sessionId) ?? Promise.resolve(),
    syncSession: (sessionId) => sessionsPanel?.syncSession(sessionId) ?? Promise.resolve(null),
    syncStatusPanel,
  });

  const sessionPromptController = createSessionPromptController({
    client: appServerClient,
    setDetailsPendingUserPrompt: (prompt) => {
      if (detailsPanel) {
        detailsPanel.pendingUserPrompt = prompt;
      }
    },
    setDetailsInterruptedSessionId: (sessionId) => {
      if (detailsPanel) {
        detailsPanel.interruptedSessionId = sessionId;
      }
    },
    setDetailsThinkingSessionId: (sessionId) => {
      if (detailsPanel) {
        detailsPanel.thinkingSessionId = sessionId;
      }
    },
    setLoadError: (error) => {
      loadError = error;
    },
    setSessionInterrupted: (sessionId) => sessionsPanel?.setSessionInterrupted(sessionId),
    setSessionThinking: (sessionId) => sessionsPanel?.setSessionThinking(sessionId),
    syncConversation: (sessionId) => detailsPanel?.syncConversation(sessionId) ?? Promise.resolve(),
    syncSession: (sessionId) => sessionsPanel?.syncSession(sessionId) ?? Promise.resolve(null),
    syncStatusPanel,
  });

  if (detailsPanel) {
    detailsPanel.repository = sessionReader;
  }

  function reportReadOnlyProvider(): void {
    loadError = `${providerProfile.label} sessions are read-only in lazy-ai for now.`;
    syncStatusPanel();
  }

  if (sessionsPanel) {
    sessionsPanel.activeSessionId = sessionResumeController.getActiveSessionId();
  }

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

    statusPanel.activeProviderLabel = providerProfile.label;
    statusPanel.activeModelLabel = activeProvider.modelLabel ?? defaultModelLabel;
    statusPanel.activeModelIsDefault = !activeProvider.modelId;
    statusPanel.projectLoadError = projectLoadError;
    statusPanel.loadError = loadError;
    statusPanel.selectedSession = selectedSession;
    statusPanel.usageLimitSnapshot = usageLimitSnapshot;
  }

  function syncContextPanel() {
    if (!contextPanel) return;

    contextPanel.projectName = selectedProjectName;
    contextPanel.projectPath = selectedProjectPath;
    contextPanel.selectedSession = selectedSession;
  }

  function setInterruptedSession(sessionId: string | null) {
    sessionsPanel?.setSessionInterrupted(sessionId);
    if (detailsPanel) {
      detailsPanel.interruptedSessionId = sessionId;
    }
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

    void refreshUsageLimit();
    syncContextPanel();
    renderPanels();
  }

  async function refreshDefaultModelLabel() {
    if (activeProvider.modelId) return;

    try {
      defaultModelLabel = (await resolveDefaultModel(activeProvider.providerId))?.label ?? null;
    } catch {
      defaultModelLabel = null;
    }

    syncStatusPanel();
  }

  async function refreshUsageLimit() {
    try {
      usageLimitSnapshot = await sessionReader.getLatestUsageLimit();
    } catch {
      usageLimitSnapshot = null;
    }

    syncStatusPanel();
  }

  function onSessionChange(event: Event) {
    const customEvent = event as CustomEvent<SessionSelectionChangeDetail>;

    selectedSession = customEvent.detail.session;
    selectedProjectPath = customEvent.detail.projectPath || selectedProjectPath;
    loadError = customEvent.detail.error;
    syncContextPanel();
    renderPanels();
  }

  function onSessionResumeRequest(event: Event) {
    const customEvent = event as CustomEvent<SessionResumeRequestDetail>;
    const requestedSession = customEvent.detail.session;

    if (!canDriveSessions) {
      reportReadOnlyProvider();
      return;
    }

    if (detailsPanel?.isConversationLoading) return;
    if (sessionResumeController.isSessionResuming(requestedSession.id)) return;

    if (sessionResumeController.isSessionActive(requestedSession.id)) {
      sessionResumeController.showAlreadyRunningStatus(requestedSession.id);
      return;
    }

    void sessionResumeController.resumeSession(requestedSession, customEvent.detail.projectPath);
  }

  function onSessionDeleteRequest(event: Event) {
    const customEvent = event as CustomEvent<SessionDeleteRequestDetail>;
    const requestedSession = customEvent.detail.session;

    if (!canDriveSessions) {
      reportReadOnlyProvider();
      return;
    }

    if (hasOngoingTurn()) return;
    if (sessionDeleteController.isSessionDeleting(requestedSession.id)) return;

    openModal(ModalName.confirmDeleteSessionModal, {
      onConfirm: () => {
        closeModal();
        void sessionDeleteController.deleteSession(requestedSession);
      },
      sessionId: requestedSession.id,
      sessionTitle: requestedSession.title,
    });
  }

  function openStartNewSessionModal() {
    if (!canDriveSessions) {
      reportReadOnlyProvider();
      return;
    }

    if (hasOngoingTurn()) return;
    if (sessionStartController.isSessionStarting()) return;

    openModal(ModalName.startNewSessionModal, {
      onConfirm: (prompt: string) => {
        closeModal();
        void sessionStartController.startSession(prompt, selectedProjectPath);
      },
    });
  }

  function openModelPickerModal() {
    if (hasOngoingTurn()) return;

    void listProviderModels().then((groups) => {
      openModal(ModalName.modelPickerModal, {
        activeProvider: getActiveProvider(),
        groups,
        onSelect: (model: ModelOption) => {
          closeModal();
          setActiveProvider({ modelId: model.id, modelLabel: model.label, providerId: model.providerId });
        },
      });
    });
  }

  function openPromptSessionModal() {
    if (!canDriveSessions) {
      reportReadOnlyProvider();
      return;
    }

    if (hasOngoingTurn()) return;
    if (sessionPromptController.isSessionPrompting()) return;

    const activeSessionId = sessionResumeController.getActiveSessionId();
    const activeThreadId = sessionResumeController.getActiveThreadId();

    if (!activeSessionId || !activeThreadId) {
      openModal(ModalName.sessionPromptErrorModal, {
        message: "Resume or start a session first",
      });
      return;
    }

    const activeSession = sessionsPanel?.getSession(activeSessionId)
      ?? (selectedSession?.id === activeSessionId ? selectedSession : null);

    if (!activeSession) {
      openModal(ModalName.sessionPromptErrorModal, {
        message: "Resume or start a session first",
      });
      return;
    }

    sessionsPanel?.selectSession(activeSession.id);

    openModal(ModalName.promptSessionModal, {
      onConfirm: (prompt: string) => {
        closeModal();
        sessionsPanel?.selectSession(activeSession.id);
        void sessionPromptController.promptSession(prompt, activeSession, activeThreadId, activeSession.projectPath);
      },
      sessionTitle: activeSession.title,
    });
  }

  function onKeyDown(event: KeyboardEvent) {
    const key = event.key.toLowerCase();

    if (getModalConfig().isActive) return;
    if (handleModalShortcuts(event, key)) return;
    if (handleModelPickerShortcut(event, key)) return;
    if (handleInterruptSessionShortcut(event, key)) return;
    if (handleNewSessionShortcut(event, key)) return;
    if (handlePromptSessionShortcut(event, key)) return;
    if (handleQuitShortcut(event, key)) return;
    if (handlePanelNavigation(event, key)) return;
  }

  function handleModalShortcuts(event: KeyboardEvent, key: string): boolean {
    if (!isPlainKeyEvent(event) || key !== Keybindings.QUESTION_MARK) return false;

    event.preventDefault();
    openModal(ModalName.keybindingsModal);
    return true;
  }

  function handleModelPickerShortcut(event: KeyboardEvent, key: string): boolean {
    if (!isPlainKeyEvent(event) || key !== Keybindings.M) return false;

    event.preventDefault();
    openModelPickerModal();
    return true;
  }

  function handleInterruptSessionShortcut(event: KeyboardEvent, key: string): boolean {
    if (!isPlainKeyEvent(event) || key !== Keybindings.I) return false;

    if (sessionPromptController.hasActiveTurn()) {
      event.preventDefault();
      void sessionPromptController.interruptActiveTurn();
      return true;
    }

    if (sessionStartController.hasActiveTurn()) {
      event.preventDefault();
      void sessionStartController.interruptActiveTurn();
      return true;
    }

    return false;
  }

  function handleNewSessionShortcut(event: KeyboardEvent, key: string): boolean {
    if (!isPlainKeyEvent(event) || key !== Keybindings.N) return false;

    event.preventDefault();
    if (hasOngoingTurn()) return true;

    openStartNewSessionModal();
    return true;
  }

  function handlePromptSessionShortcut(event: KeyboardEvent, key: string): boolean {
    if (!isPlainKeyEvent(event) || key !== Keybindings.P) return false;

    event.preventDefault();
    if (hasOngoingTurn()) return true;

    openPromptSessionModal();
    return true;
  }

  function handleQuitShortcut(event: KeyboardEvent, key: string): boolean {
    if (!isPlainKeyEvent(event) || key !== Keybindings.Q) return false;

    event.preventDefault();
    appServerClient.dispose();
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

  function hasOngoingTurn(): boolean {
    return sessionPromptController.hasActiveTurn() || sessionStartController.hasActiveTurn();
  }

  document.addEventListener("keydown", onKeyDown);

  sessionsPanel?.addEventListener("focus", onSessionsPanelFocus);
  projectsPanel?.addEventListener("focus", onProjectsPanelFocus);
  projectsPanel?.addEventListener("project-change", onProjectChange);
  sessionsPanel?.addEventListener("session-delete-request", onSessionDeleteRequest);
  sessionsPanel?.addEventListener("session-change", onSessionChange);
  sessionsPanel?.addEventListener("session-resume-request", onSessionResumeRequest);

  if (projectsPanel) {
    projectsPanel.projectPath = projectPath;
    projectsPanel.repository = providerProfile.projects;
  }

  syncContextPanel();

  if (sessionsPanel) {
    sessionsPanel.repository = sessionReader;
    sessionsPanel.projectPath = projectPath;
  }

  void refreshDefaultModelLabel();
  void refreshUsageLimit();

  renderPanels();

  return () => {
    sessionDeleteController.dispose();
    sessionPromptController.dispose();
    sessionResumeController.dispose();
    sessionStartController.dispose();
    appServerClient.dispose();
    sessionsPanel?.removeEventListener("focus", onSessionsPanelFocus);
    projectsPanel?.removeEventListener("focus", onProjectsPanelFocus);
    projectsPanel?.removeEventListener("project-change", onProjectChange);
    sessionsPanel?.removeEventListener("session-delete-request", onSessionDeleteRequest);
    sessionsPanel?.removeEventListener("session-change", onSessionChange);
    sessionsPanel?.removeEventListener("session-resume-request", onSessionResumeRequest);
    document.removeEventListener("keydown", onKeyDown);
  };
}
