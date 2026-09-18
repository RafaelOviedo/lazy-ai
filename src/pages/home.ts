import type { ModelOption } from "../entities/ai-model/index.js";
import type { UsageLimitSnapshot } from "../entities/provider/index.js";
import type { SessionSummary } from "../entities/session/index.js";
import { createProviderProfile, createUnavailableRuntimeClient, listProviderModels, resolveDefaultModel } from "../app/registry/index.js";
import { getActiveProvider, setActiveProvider } from "../entities/provider/index.js";

import { type SessionDeleteRequestDetail, type SessionResumeRequestDetail, type SessionSelectionChangeDetail, type SessionViewRequestDetail, type SessionsPanelElement } from "../components/SessionsPanel/types.js";
import { type ProjectSelectionChangeDetail, type ProjectsPanelElement } from "../components/ProjectsPanel/types.js";
import { type ContextPanelElement } from "../components/ContextPanel/types.js";
import { type DetailsPanelElement } from "../components/DetailsPanel/types.js";
import { type StatusPanelElement } from "../components/StatusPanel/types.js";
import { type KeybindingsPanelElement } from "../components/KeybindingsPanel/types.js";

import { PageProps } from "./types.js";
import { Keybindings } from "../app/types.js";
import { isSameProjectPath } from "../shared/lib/paths/index.js";

import { ensureSessionsPanelDefined } from "../components/SessionsPanel/sessions-panel.js";
import { ensureProjectsPanelDefined } from "../components/ProjectsPanel/projects-panel.js";
import { ensureContextPanelDefined } from "../components/ContextPanel/context-panel.js";
import { ensureDetailsPanelDefined } from "../components/DetailsPanel/details-panel.js";
import { ensureStatusPanelDefined } from "../components/StatusPanel/status-panel.js";
import { ensureKeybindingsPanelDefined } from "../components/KeybindingsPanel/keybindings-panel.js";
import { ensureModalDefined } from "../components/Modal/modal.js";

import { useModal } from "../composables/useModal.js";
import { ModalName } from "../shared/lib/modal/index.js";
import { createSessionDeleteController } from "../features/delete-session/index.js";
import { createSessionPromptController } from "../features/prompt-session/index.js";
import { createSessionResumeController } from "../features/resume-session/index.js";
import { createSessionStartController } from "../features/start-session/index.js";
import { createToolApprovalController } from "../features/approve-tool-use/index.js";

import type { ToolPermissionDecision, ToolPermissionRequest } from "../entities/provider/index.js";

export function renderHome({ document, projectPath, window }: PageProps) {
  ensureSessionsPanelDefined(window);
  ensureProjectsPanelDefined(window);
  ensureContextPanelDefined(window);
  ensureDetailsPanelDefined(window);
  ensureStatusPanelDefined(window);
  ensureKeybindingsPanelDefined(window);
  ensureModalDefined(window);

  const { closeModal, getModalConfig, openModal, subscribe: subscribeModal } = useModal();
  const activeProvider = getActiveProvider();
  const providerProfile = createProviderProfile(activeProvider.providerId, activeProvider.modelId);
  const sessionReader = providerProfile.sessions;
  const providerCapabilities = providerProfile.capabilities;
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
      html, body {
        height: 100vh;
        margin: 0;
        overflow: hidden;
      }

      .card {
        display: flex;
        flex-direction: column;
        gap: 1px;
        position: relative;
        border: 1px solid #5fafff;
        padding: 0 1ch;
        height: 100vh;
        box-sizing: border-box;
        overflow: hidden;
        border-radius: 5px;
      }

      .container-for-1-and-2 {
        display: flex;
        flex-direction: row;
        gap: 2px;
        flex-grow: 1;
        flex-shrink: 1;
        /* TermDOM requires a length here: a unitless 0 is parsed as flex-grow. */
        flex-basis: 0px;
        min-height: 0;
        overflow: hidden;
      }

      .container-1 {
        display: flex;
        flex-direction: column;
        gap: 1px;
        flex-grow: 3;
        flex-shrink: 1;
        flex-basis: 0px;
        min-width: 0;
        min-height: 0;
      }

      .container-1-1,
      .container-1-2,
      .container-1-3 {
        min-height: 0;
        flex-grow: 1;
        flex-shrink: 1;
        flex-basis: 0px;
      }

      .container-1-3 {
        flex-grow: 1.2;
      }

      .container-1-1:focus,
      .container-1-2:focus,
      .container-1-3:focus {
        border-color: #fff;
      }

      @media (max-height: 30px) {
        .card, .container-1 {
          gap: 0;
        }

        status-panel {
          flex-basis: 3px;
        }
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
  let pendingActionError: { message: string; title: string } | null = null;

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

  const toolApprovalController = createToolApprovalController({
    closeModal,
    isModalActive: () => getModalConfig().isActive,
    openPermissionModal: (request: ToolPermissionRequest, queuedCount: number, onDecide: (decision: ToolPermissionDecision) => void) => {
      openModal(ModalName.toolPermissionModal, {
        onDecide,
        queuedCount,
        request,
      });
    },
  });

  // Only providers that gate tool use expose this, so the call stays optional.
  appServerClient.setToolPermissionHandler?.(toolApprovalController.requestToolPermission);

  const sessionResumeController = createSessionResumeController({
    client: appServerClient,
    providerLabel: providerProfile.label,
    reportActionError,
    setActiveSessionId: (sessionId) => {
      const wasActive = sessionsPanel?.activeSessionId === sessionId;
      setInterruptedSession(null);
      if (sessionsPanel) {
        sessionsPanel.activeSessionId = sessionId;
      }
      // A completed turn marks the session active again; it must not replace a
      // different conversation the user has since opened.
      if (sessionId && !wasActive) {
        const session = sessionsPanel?.getSession(sessionId);
        if (session) viewSession(session);
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
    clearActiveSession: (sessionId) => {
      sessionResumeController.clearActiveSession(sessionId);
      if (detailsPanel?.viewedSession?.id === sessionId) {
        detailsPanel.viewedSession = null;
      }
    },
    client: appServerClient,
    providerLabel: providerProfile.label,
    reloadSessions: () => sessionsPanel?.reload() ?? Promise.resolve(),
    reportActionError,
    setLoadError: (error) => {
      loadError = error;
    },
    setSessionDeleting: (sessionId) => sessionsPanel?.setSessionDeleting(sessionId),
    syncStatusPanel,
  });

  const sessionStartController = createSessionStartController({
    client: appServerClient,
    getSession: (sessionId) => sessionsPanel?.getSession(sessionId) ?? null,
    providerLabel: providerProfile.label,
    reportActionError,
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
    syncSession,
    syncStatusPanel,
  });

  const sessionPromptController = createSessionPromptController({
    client: appServerClient,
    providerLabel: providerProfile.label,
    reportActionError,
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
    syncSession,
    syncStatusPanel,
  });

  if (detailsPanel) {
    detailsPanel.repository = sessionReader;
  }

  /**
   * Reports one action the active provider cannot be driven to perform, rather
   * than calling the whole provider read-only when only some actions are missing.
   */
  function reportUnsupportedAction(action: string): void {
    reportActionError(`${providerProfile.label} sessions cannot be ${action} from lazy-ai yet.`, "Not supported");
  }

  /**
   * Surfaces a failed or unavailable action in a modal instead of leaving it in
   * the status panel, where nothing clears it and it hides the provider summary.
   *
   * Opening over a live modal would swap that modal's element out without ever
   * settling it, which would strand a pending tool permission request and hang
   * its turn, so a notice arriving at a busy moment waits for the screen.
   */
  function reportActionError(message: string, title = "Session error"): void {
    if (!message) return;

    if (getModalConfig().isActive) {
      pendingActionError = { message, title };
      return;
    }

    pendingActionError = null;
    openModal(ModalName.actionErrorModal, { message, title });
  }

  /**
   * Shows a notice that had to wait for the screen. Tool permission requests go
   * first, because a turn stays blocked until one is answered.
   */
  function flushPendingActionError(): void {
    const pendingNotice = pendingActionError;

    if (!pendingNotice || getModalConfig().isActive) return;
    if (toolApprovalController.hasPendingRequests()) return;

    pendingActionError = null;
    openModal(ModalName.actionErrorModal, pendingNotice);
  }

  if (sessionsPanel) {
    sessionsPanel.activeSessionId = sessionResumeController.getActiveSessionId();
  }

  function viewSession(session: SessionSummary) {
    if (!isSameProjectPath(session.projectPath, selectedProjectPath)) return;
    detailsPanel?.viewSession(session);
  }

  async function syncSession(sessionId: string) {
    const session = await sessionsPanel?.syncSession(sessionId) ?? null;
    if (session && detailsPanel?.viewedSession?.id === session.id) {
      detailsPanel.viewedSession = session;
    }
    return session;
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

    if (detailsPanel && !isSameProjectPath(selectedProjectPath, selectedProject?.path ?? projectPath)) {
      detailsPanel.viewedSession = null;
    }

    if (selectedProject) {
      selectedProjectPath = selectedProject.path;
      selectedProjectName = selectedProject.name;
      selectedSession = null;
      loadError = null;

      if (sessionsPanel && !isSameProjectPath(sessionsPanel.projectPath, selectedProject.path)) {
        sessionsPanel.projectPath = selectedProject.path;
      }
    } else {
      selectedProjectPath = projectPath;
      selectedProjectName = initialProjectName;
      selectedSession = null;
    }

    void refreshUsageLimit();
    syncContextPanel();
    syncStatusPanel();
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
    syncStatusPanel();
  }

  function onSessionViewRequest(event: Event) {
    if (getModalConfig().isActive) return;
    const { session, projectPath } = (event as CustomEvent<SessionViewRequestDetail>).detail;
    if (isSameProjectPath(projectPath, selectedProjectPath)) viewSession(session);
  }

  function onSessionResumeRequest(event: Event) {
    const customEvent = event as CustomEvent<SessionResumeRequestDetail>;
    const requestedSession = customEvent.detail.session;

    if (!providerCapabilities.resumeSessions) {
      reportUnsupportedAction("resumed");
      return;
    }

    if (sessionResumeController.isSessionResuming(requestedSession.id)) return;

    if (sessionResumeController.isSessionActive(requestedSession.id)) {
      viewSession(requestedSession);
      sessionResumeController.showAlreadyRunningStatus(requestedSession.id);
      return;
    }

    void sessionResumeController.resumeSession(requestedSession, customEvent.detail.projectPath);
  }

  function onSessionDeleteRequest(event: Event) {
    const customEvent = event as CustomEvent<SessionDeleteRequestDetail>;
    const requestedSession = customEvent.detail.session;

    if (!providerCapabilities.deleteSessions) {
      reportUnsupportedAction("deleted");
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
    if (!providerCapabilities.startSessions) {
      reportUnsupportedAction("started");
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
    if (!providerCapabilities.promptSessions) {
      reportUnsupportedAction("prompted");
      return;
    }

    if (hasOngoingTurn()) return;
    if (sessionPromptController.isSessionPrompting()) return;

    const activeSessionId = sessionResumeController.getActiveSessionId();
    const activeThreadId = sessionResumeController.getActiveThreadId();

    if (!activeSessionId || !activeThreadId) {
      openModal(ModalName.actionErrorModal, {
        message: "Resume or start a session first",
        title: "Prompt unavailable",
      });
      return;
    }

    const activeSession = sessionsPanel?.getSession(activeSessionId)
      ?? (selectedSession?.id === activeSessionId ? selectedSession : null);

    if (!activeSession) {
      openModal(ModalName.actionErrorModal, {
        message: "Resume or start a session first",
        title: "Prompt unavailable",
      });
      return;
    }

    sessionsPanel?.selectSession(activeSession.id);

    openModal(ModalName.promptSessionModal, {
      onConfirm: (prompt: string) => {
        closeModal();
        sessionsPanel?.selectSession(activeSession.id);
        viewSession(activeSession);
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

    // A turn that is still starting counts as interruptible: the controllers
    // hold the request and apply it the moment the turn exists, so pressing i
    // early is honoured rather than silently dropped.
    if (sessionPromptController.hasActiveTurn() || sessionPromptController.isSessionPrompting()) {
      event.preventDefault();
      void sessionPromptController.interruptActiveTurn();
      return true;
    }

    if (sessionStartController.hasActiveTurn() || sessionStartController.isSessionStarting()) {
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

  // A permission request that arrived while another modal held the screen still
  // has a turn blocked on it, so retry as soon as the screen frees up.
  const unsubscribeModal = subscribeModal(() => {
    if (getModalConfig().isActive) return;

    toolApprovalController.handleModalClosed();
    flushPendingActionError();
  });

  sessionsPanel?.addEventListener("focus", onSessionsPanelFocus);
  projectsPanel?.addEventListener("focus", onProjectsPanelFocus);
  projectsPanel?.addEventListener("project-change", onProjectChange);
  sessionsPanel?.addEventListener("session-delete-request", onSessionDeleteRequest);
  sessionsPanel?.addEventListener("session-change", onSessionChange);
  sessionsPanel?.addEventListener("session-view-request", onSessionViewRequest);
  sessionsPanel?.addEventListener("session-resume-request", onSessionResumeRequest);

  if (projectsPanel) {
    projectsPanel.providerLabel = providerProfile.label;
    projectsPanel.projectPath = projectPath;
    projectsPanel.repository = providerProfile.projects;
  }

  syncContextPanel();

  if (sessionsPanel) {
    sessionsPanel.providerLabel = providerProfile.label;
    sessionsPanel.repository = sessionReader;
    sessionsPanel.projectPath = projectPath;
  }

  void refreshDefaultModelLabel();
  void refreshUsageLimit();

  syncStatusPanel();

  return () => {
    sessionDeleteController.dispose();
    sessionPromptController.dispose();
    sessionResumeController.dispose();
    sessionStartController.dispose();
    // Detached before disposal so no in-flight request reaches a dead modal.
    appServerClient.setToolPermissionHandler?.(null);
    toolApprovalController.dispose();
    unsubscribeModal();
    appServerClient.dispose();
    sessionsPanel?.removeEventListener("focus", onSessionsPanelFocus);
    projectsPanel?.removeEventListener("focus", onProjectsPanelFocus);
    projectsPanel?.removeEventListener("project-change", onProjectChange);
    sessionsPanel?.removeEventListener("session-delete-request", onSessionDeleteRequest);
    sessionsPanel?.removeEventListener("session-change", onSessionChange);
    sessionsPanel?.removeEventListener("session-view-request", onSessionViewRequest);
    sessionsPanel?.removeEventListener("session-resume-request", onSessionResumeRequest);
    document.removeEventListener("keydown", onKeyDown);
  };
}
