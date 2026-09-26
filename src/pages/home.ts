import type { ModelOption } from "../entities/ai-model/index.js";
import type { UsageLimitSnapshot } from "../entities/provider/index.js";
import type { SessionSummary } from "../entities/session/index.js";
import { createProviderProfile, createUnavailableRuntimeClient, listProviderModels, resolveDefaultModel } from "../app/registry/index.js";
import { getActiveProvider, setActiveProvider, subscribeActiveProvider } from "../entities/provider/index.js";

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
import { createSessionRunController } from "../features/run-session/index.js";
import { createSessionResumeController } from "../features/resume-session/index.js";
import { createToolApprovalController } from "../features/approve-tool-use/index.js";
import { createUsageLimitController } from "../features/refresh-usage-limit/index.js";

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
  let activeProvider = getActiveProvider();
  const providerProfile = createProviderProfile(activeProvider.providerId, activeProvider.modelId, activeProvider.effort ?? null);
  const sessionReader = providerProfile.sessions;
  const providerCapabilities = providerProfile.capabilities;
  const appServerClient = providerProfile.client ?? createUnavailableRuntimeClient(providerProfile.label);
  const unsubscribeActiveProvider = subscribeActiveProvider((next, previous) => {
    if (next.providerId !== previous.providerId || next.modelId !== previous.modelId) return;
    appServerClient.setEffort(next.effort ?? null);
    activeProvider = next;
    syncStatusPanel();
  });

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
        gap: 1px;
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
  let defaultModelId: string | null = null;
  let isModelPickerLoading = false;
  let isDisposed = false;
  const pendingActionErrors: { message: string; title: string }[] = [];
  let navigationVersion = 0;
  let pendingSessionStart: { navigation: number; interruptRequested: boolean } | null = null;

  panel1?.focus();

  const sessionsPanel = panel1 as SessionsPanelElement | null;
  const projectsPanel = panel2 as ProjectsPanelElement | null;
  const contextPanel = panel3 as ContextPanelElement | null;
  const detailsPanel = detailsPanelElement as DetailsPanelElement | null;
  const statusPanel = statusPanelElement as StatusPanelElement | null;
  const keybindingsPanel = keybindingsPanelElement as KeybindingsPanelElement | null;

  const usageLimitController = createUsageLimitController({
    readSnapshot: () => sessionReader.getLatestUsageLimit(),
    onSnapshot: (snapshot) => {
      usageLimitSnapshot = snapshot;
      syncStatusPanel();
    },
  });

  function refreshUsageLimitAfterTurn(): void {
    if (providerProfile.id === "codex") {
      void usageLimitController.refreshAfterTurn();
    }
  }

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
        sessionLabel: getPermissionSessionLabel(request.sessionId),
      });
    },
  });

  const sessionResumeController = createSessionResumeController({
    client: appServerClient,
    providerLabel: providerProfile.label,
    reportActionError,
    setActiveSessionId: (sessionId) => {
      const wasActive = sessionsPanel?.activeSessionId === sessionId;
      if (sessionsPanel) {
        sessionsPanel.activeSessionId = sessionId;
      }

      // Activation follows an explicit start/resume, never turn completion.
      if (sessionId && !wasActive) {
        const session = sessionsPanel?.getSession(sessionId) ?? sessionRunController.getState(sessionId)?.session;
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
      sessionRunController.forgetSession(sessionId);
      sessionsPanel?.forgetSession(sessionId);
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

  const sessionRunController = createSessionRunController({
    client: appServerClient,
    providerLabel: providerProfile.label,
    refreshUsageLimit: refreshUsageLimitAfterTurn,
    reportActionError,
    onChange: (state) => {
      if (isDisposed) return;

      sessionsPanel?.upsertSession(state.session);
      sessionsPanel?.setSessionRunStatus(state.session.id, state.status);

      if (detailsPanel?.viewedSession?.id === state.session.id) {
        detailsPanel.viewedSession = state.session;
        syncViewedRunState();
      }
    },
    onTurnFinished: (sessionId, threadId) => {
      toolApprovalController.cancelSessionRequests(threadId);
      if (sessionId !== threadId) toolApprovalController.cancelSessionRequests(sessionId);
    },
    syncConversation: (sessionId) => detailsPanel?.syncConversation(sessionId) ?? Promise.resolve(),
    syncSession: async (sessionId, sessionProjectPath) => {
      // Background sessions may belong to a different project than the visible list.
      try {
        const sessions = await sessionReader.listByProject(sessionProjectPath);
        return sessions.find((session) => session.id === sessionId) ?? null;
      } catch {
        return null;
      }
    },
  });

  appServerClient.setToolPermissionHandler?.((request) =>
    sessionRunController.requestToolPermission(request, toolApprovalController.requestToolPermission));

  function getPermissionSessionLabel(sessionId: string): string {
    const session = sessionRunController.getState(sessionId)?.session ?? sessionsPanel?.getSession(sessionId);
    return session ? `${session.title} · ${session.projectPath}` : sessionId;
  }

  function syncViewedRunState(): void {
    const sessionId = detailsPanel?.viewedSession?.id;
    if (!detailsPanel) return;

    const state = sessionId ? sessionRunController.getState(sessionId) : null;
    detailsPanel.thinkingSessionId = state?.busy ? sessionId! : null;
    detailsPanel.interruptedSessionId = state?.status === "interrupted" ? sessionId! : null;
    detailsPanel.pendingUserPrompt = state?.pendingPrompt ?? null;
  }

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
    if (isDisposed || !message) return;

    if (getModalConfig().isActive) {
      pendingActionErrors.push({ message, title });
      return;
    }

    openModal(ModalName.actionErrorModal, { message, title });
  }

  /**
   * Shows a notice that had to wait for the screen. Tool permission requests go
   * first, because a turn stays blocked until one is answered.
   */
  function flushPendingActionError(): void {
    const pendingNotice = pendingActionErrors[0];

    if (!pendingNotice || getModalConfig().isActive) return;
    if (toolApprovalController.hasPendingRequests()) return;

    pendingActionErrors.shift();
    openModal(ModalName.actionErrorModal, pendingNotice);
  }

  if (sessionsPanel) {
    sessionsPanel.activeSessionId = sessionResumeController.getActiveSessionId();
  }

  function viewSession(session: SessionSummary) {
    if (!isSameProjectPath(session.projectPath, selectedProjectPath)) return;
    detailsPanel?.viewSession(session);
    syncViewedRunState();
  }

  function syncStatusPanel() {
    if (!statusPanel) return;

    statusPanel.activeProviderLabel = providerProfile.label;
    statusPanel.activeModelLabel = activeProvider.modelLabel ?? defaultModelLabel;
    statusPanel.activeModelIsDefault = !activeProvider.modelId;
    statusPanel.activeEffort = activeProvider.effort ?? null;
    statusPanel.projectLoadError = projectLoadError;
    statusPanel.loadError = loadError;
    statusPanel.selectedSession = selectedSession;
    statusPanel.usageLimitSnapshot = usageLimitSnapshot;
  }

  function syncContextPanel() {
    if (!contextPanel) return;

    contextPanel.projectName = selectedProjectName;
    contextPanel.projectPath = selectedProjectPath;
    const liveState = selectedSession ? sessionRunController.getState(selectedSession.id) : null;
    const liveSession = liveState?.session;
    // Some providers don't persist effort; retain the level applied in this app.
    contextPanel.selectedSession = selectedSession && liveSession?.effort !== undefined
      && (liveState?.busy || liveSession.updatedAt >= selectedSession.updatedAt)
      ? { ...selectedSession, effort: liveSession.effort }
      : selectedSession;
  }

  function onProjectChange(event: Event) {
    navigationVersion += 1;
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

    void usageLimitController.refresh();
    syncContextPanel();
    syncStatusPanel();
  }

  async function refreshDefaultModelLabel() {
    if (activeProvider.modelId) return;

    try {
      const model = await resolveDefaultModel(activeProvider.providerId);
      defaultModelLabel = model?.label ?? null;
      defaultModelId = model?.id ?? null;
    } catch {
      defaultModelLabel = null;
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
    if (isSameProjectPath(projectPath, selectedProjectPath)) {
      navigationVersion += 1;
      viewSession(session);
    }
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
      navigationVersion += 1;
      viewSession(requestedSession);
      if (!sessionRunController.isBusy(requestedSession.id)) {
        sessionResumeController.showAlreadyRunningStatus(requestedSession.id);
      }
      return;
    }

    navigationVersion += 1;
    void sessionResumeController.resumeSession(requestedSession, customEvent.detail.projectPath);
  }

  function onSessionDeleteRequest(event: Event) {
    const customEvent = event as CustomEvent<SessionDeleteRequestDetail>;
    const requestedSession = customEvent.detail.session;

    if (!providerCapabilities.deleteSessions) {
      reportUnsupportedAction("deleted");
      return;
    }

    if (sessionRunController.isBusy(requestedSession.id)) return;
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

    openModal(ModalName.startNewSessionModal, {
      onConfirm: (prompt: string) => {
        closeModal();
        const start = { navigation: ++navigationVersion, interruptRequested: false };
        pendingSessionStart = start;
        loadError = null;
        void sessionRunController.startSession(prompt, selectedProjectPath, (session, threadId) => {
          sessionResumeController.attachSession(session.id, threadId);
          if (pendingSessionStart === start) pendingSessionStart = null;
          if (start.interruptRequested) void sessionRunController.interruptSession(session.id);
          if (start.navigation === navigationVersion) sessionResumeController.markSessionActive(session.id, threadId);
        }).finally(() => {
          if (pendingSessionStart === start) pendingSessionStart = null;
        });
      },
    });
  }

  function isModelSelectionBlocked(): boolean {
    return isDisposed || hasOngoingTurn();
  }

  function openModelPickerModal() {
    if (isModelSelectionBlocked() || isModelPickerLoading) return;
    isModelPickerLoading = true;

    // Resolve the default before highlighting it, even if m is pressed during boot.
    void Promise.all([listProviderModels(), refreshDefaultModelLabel()]).then(([groups]) => {
      if (isModelSelectionBlocked() || getModalConfig().isActive) return;

      openModal(ModalName.modelPickerModal, {
        activeProvider: { ...activeProvider, modelId: activeProvider.modelId ?? defaultModelId },
        groups,
        onSelect: (model: ModelOption, effort: string | null) => {
          if (isModelSelectionBlocked()) return;
          closeModal();
          const keepDefaultModel = activeProvider.modelId === null && model.providerId === activeProvider.providerId
            && model.id === defaultModelId;
          setActiveProvider({
            modelId: keepDefaultModel ? null : model.id,
            modelLabel: keepDefaultModel ? null : model.label,
            providerId: model.providerId,
            effort,
          });
        },
      });
    }).catch(() => {
      if (!isDisposed) reportActionError("Failed to load provider models.");
    }).finally(() => {
      isModelPickerLoading = false;
    });
  }

  function openPromptSessionModal() {
    if (!providerCapabilities.promptSessions) {
      reportUnsupportedAction("prompted");
      return;
    }

    const activeSessionId = sessionResumeController.getActiveSessionId();
    const activeThreadId = sessionResumeController.getActiveThreadId();

    if (activeSessionId && sessionRunController.isBusy(activeSessionId)) return;

    if (!activeSessionId || !activeThreadId) {
      openModal(ModalName.actionErrorModal, {
        message: "Resume or start a session first",
        title: "Prompt unavailable",
      });
      return;
    }

    const activeSession = sessionsPanel?.getSession(activeSessionId)
      ?? sessionRunController.getState(activeSessionId)?.session
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
        navigationVersion += 1;
        loadError = null;
        void sessionRunController.promptSession(activeSession, activeThreadId, prompt);
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

    // Before the new thread has an ID, i still belongs to that new session,
    // never to the older session that remains active on screen temporarily.
    if (pendingSessionStart?.navigation === navigationVersion) {
      pendingSessionStart.interruptRequested = true;
      event.preventDefault();
      return true;
    }

    const sessionId = sessionResumeController.getActiveSessionId();

    if (!sessionId || !sessionRunController.isBusy(sessionId)) return false;

    event.preventDefault();
    void sessionRunController.interruptSession(sessionId);
    return true;
  }

  function handleNewSessionShortcut(event: KeyboardEvent, key: string): boolean {
    if (!isPlainKeyEvent(event) || key !== Keybindings.N) return false;

    event.preventDefault();

    openStartNewSessionModal();
    return true;
  }

  function handlePromptSessionShortcut(event: KeyboardEvent, key: string): boolean {
    if (!isPlainKeyEvent(event) || key !== Keybindings.P) return false;

    event.preventDefault();

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
    return sessionRunController.hasOngoingTurn();
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
  void usageLimitController.refresh();

  syncStatusPanel();

  return () => {
    isDisposed = true;
    usageLimitController.dispose();
    unsubscribeActiveProvider();
    sessionDeleteController.dispose();
    sessionRunController.dispose();
    sessionResumeController.dispose();
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
