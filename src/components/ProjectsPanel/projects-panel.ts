import { escapeHtml } from "../../shared/lib/html/index.js";
import { Keybindings } from "../../shared/config/keybindings.js";

import type { ProjectReader, ProjectSummary } from "../../entities/project/index.js";
import type { ProjectSelectionChangeDetail, TermWindow } from "./types.js";

/**
 * Registers the Projects panel custom element against a TermDOM window.
 */
export function ensureProjectsPanelDefined(window: TermWindow): void {
  if (window.customElements.get("projects-panel")) {
    return;
  }

  /**
   * Renders the Projects panel and owns its loading and selection state.
   */
  class ProjectsPanel extends window.HTMLElement {
    private projectPathValue = "";
    private currentProjectPathValue = "";
    private alreadySelectedProjectPath: string | null = null;
    private alreadySelectedTimer: ReturnType<typeof setTimeout> | null = null;
    private projectReader: ProjectReader | null = null;
    private projects: ProjectSummary[] = [];
    private selectedProjectIndex = 0;
    private isLoading = true;
    private loadError: string | null = null;

    constructor() {
      super();
      this.onKeyDown = this.onKeyDown.bind(this);
      this.onFocus = this.onFocus.bind(this);
      this.onBlur = this.onBlur.bind(this);
    }

    /**
     * Initializes the panel markup and loads projects when the element is attached.
     */
    connectedCallback(): void {
      if (!this.hasAttribute("tabindex")) {
        this.tabIndex = 0;
      }

      this.render();
      this.addEventListener("focus", this.onFocus);
      this.addEventListener("blur", this.onBlur);
      this.addEventListener("keydown", this.onKeyDown);
    }

    /**
     * Cleans up event bindings when the element leaves the document.
     */
    disconnectedCallback(): void {
      this.removeEventListener("focus", this.onFocus);
      this.removeEventListener("blur", this.onBlur);
      this.removeEventListener("keydown", this.onKeyDown);
      this.clearAlreadySelectedStatus();
    }

    /**
     * Sets the preferred project path selected after loading.
     */
    set projectPath(value: string) {
      if (this.projectPathValue === value) return;

      this.projectPathValue = value;

      if (this.isConnected && !this.isLoading && this.projects.length > 0) {
        this.selectedProjectIndex = this.getPreferredProjectIndex();
        this.syncProjectPathToSelection();
        this.render();
        this.revealSelectedProject();
        this.dispatchSelectionChange();
      }
    }

    /**
     * Returns the preferred project path used to initialize selection.
     */
    get projectPath(): string {
      return this.projectPathValue;
    }

    /**
     * Allows the page to replace the project reader implementation if needed.
     */
    set repository(value: ProjectReader) {
      this.projectReader = value;

      if (this.isConnected) {
        void this.reload();
      }
    }

    /**
     * Exposes the currently selected project to parent views.
     */
    get selectedProject(): ProjectSummary | null {
      return this.projects[this.selectedProjectIndex] ?? null;
    }

    /**
     * Loads the latest projects and refreshes the panel.
     */
    async reload(): Promise<void> {
      const projectReader = this.projectReader;

      if (!projectReader) return;

      this.isLoading = true;
      this.render();

      try {
        this.loadError = null;
        this.projects = await projectReader.listProjects();
        this.selectedProjectIndex = this.getPreferredProjectIndex();
        this.syncProjectPathToSelection();
      } catch {
        this.loadError = "Failed to load projects.";
        this.projects = [];
        this.selectedProjectIndex = 0;
      }

      this.isLoading = false;
      this.render();
      this.revealSelectedProject();
      this.dispatchSelectionChange();
    }

    /**
     * Re-renders the light DOM for the panel.
     */
    private render(): void {
      this.innerHTML = `
        <style>
          projects-panel {
            display: block;
            width: fit-content;
            min-height: 10%;
            border: 1px solid #5fafff;
            border-radius: 5px;
            box-sizing: border-box;
            overflow: hidden;
          }

          projects-panel:focus {
            border-color: #fff;
            outline: none;
          }

          projects-panel.is-focused .projects-panel__title,
          projects-panel.is-focused .projects-panel__counter {
            color: #fff;
          }

          projects-panel.is-focused .projects-panel__item.is-selected {
            color: #ffffff;
            background: #2E668C;
          }

          .projects-panel__title {
            display: flex;
            justify-content: flex-start;
            align-items: center;
            color: #5fafff;
            border: 1px solid transparent;
          }

          .projects-panel__content {
            overflow: scroll;
            max-height: 15px;
          }

          .projects-panel__item {
            display: flex;
            justify-content: flex-start;
            align-items: center;
            height: 3px;
          }

          .projects-panel__item.is-selected {
            height: 3px;
          }

          .projects-panel__item-name {
            color: #d7ecff;
            font-size: 6px;
          }

          .projects-panel__meta,
          .projects-panel__muted {
            color: #8aa4bf;
          }

          .projects-panel__status-current {
            color: #43B53E;
          }

          .projects-panel__status-already-selected {
            color: #B81D1D;
          }

          .projects-panel__counter {
            display: flex;
            justify-content: flex-end;
            color: #5fafff;
          }
        </style>

        <div>
          <span class="projects-panel__title">Projects <span class="projects-panel__counter">${this.renderSessionCountMarkup()}</span></span>
        </div>
        <div class="projects-panel__content">
          ${this.renderContentMarkup()}
        </div>
      `;
    }

    /**
     * Moves the current selection up or down within the project list.
     */
    private moveSelection(direction: 1 | -1): void {
      if (this.projects.length === 0) return;

      this.selectedProjectIndex =
        (this.selectedProjectIndex + direction + this.projects.length) % this.projects.length;

      // Browsing only. Loading this project's sessions waits for an explicit
      // commit, so holding j/k does not queue a reload per keypress.
      this.render();
      this.revealSelectedProject();
    }

    /**
     * Makes the highlighted project the one the rest of the layout reads from.
     */
    private commitSelectedProject(): void {
      const selectedProject = this.selectedProject;

      if (!selectedProject) return;

      if (this.currentProjectPathValue === selectedProject.path) {
        this.showAlreadySelectedStatus(selectedProject.path);
        return;
      }

      this.clearAlreadySelectedStatus();
      this.syncProjectPathToSelection();
      this.render();
      this.revealSelectedProject();
      this.dispatchSelectionChange();
    }

    /**
     * Briefly flags that the highlighted project is already the current one.
     */
    private showAlreadySelectedStatus(projectPath: string): void {
      this.clearAlreadySelectedStatus();

      this.alreadySelectedProjectPath = projectPath;
      this.render();
      this.revealSelectedProject();

      this.alreadySelectedTimer = setTimeout(() => {
        this.alreadySelectedTimer = null;
        this.alreadySelectedProjectPath = null;

        if (this.isConnected) {
          this.render();
          this.revealSelectedProject();
        }
      }, 1000);
    }

    /**
     * Drops any pending already-selected flag and its timer.
     */
    private clearAlreadySelectedStatus(): void {
      if (this.alreadySelectedTimer) {
        clearTimeout(this.alreadySelectedTimer);
        this.alreadySelectedTimer = null;
      }

      this.alreadySelectedProjectPath = null;
    }

    /**
     * Keeps the selected project row visible inside the scrollable content area.
     */
    private revealSelectedProject(): void {
      const selectedItem = this.querySelector<HTMLElement>("[data-selected='true']");

      selectedItem?.scrollIntoView({ block: "nearest" });
    }

    /**
     * Handles list navigation keys while the panel itself is focused.
     */
    private onKeyDown(event: KeyboardEvent): void {
      const key = event.key.toLowerCase();

      if (key === Keybindings.J || key === "arrowdown") {
        this.moveSelection(1);
        event.preventDefault();
        return;
      }

      if (key === Keybindings.K || key === "arrowup") {
        this.moveSelection(-1);
        event.preventDefault();
        return;
      }

      if (event.key === Keybindings.SPACE) {
        this.commitSelectedProject();
        event.preventDefault();
      }
    }

    /**
     * Marks the host as focused without rebuilding the panel DOM.
     */
    private onFocus(): void {
      this.classList.add("is-focused");
    }

    /**
     * Clears focused host styling without rebuilding the panel DOM.
     */
    private onBlur(): void {
      this.classList.remove("is-focused");
    }

    /**
     * Finds the preferred project after loading, falling back to the first item.
     */
    private getPreferredProjectIndex(): number {
      if (this.projects.length === 0) return 0;
      if (!this.projectPathValue) return 0;

      const preferredPath = this.normalizeProjectPath(this.projectPathValue);
      const projectIndex = this.projects.findIndex((project) => {
        return this.normalizeProjectPath(project.path) === preferredPath;
      });

      return projectIndex === -1 ? 0 : projectIndex;
    }

    /**
     * Matches tolerantly because the shell, Codex, and Claude Code all record
     * the same workspace with different separators and casing.
     */
    private normalizeProjectPath(projectPath: string): string {
      return projectPath.replace(/[\\/]+/g, "/").replace(/\/$/, "").toLowerCase();
    }

    /**
     * Keeps the public project path aligned with the current selection.
     */
    private syncProjectPathToSelection(): void {
      const selectedProject = this.selectedProject;

      if (selectedProject) {
        this.projectPathValue = selectedProject.path;
        this.currentProjectPathValue = selectedProject.path;
      }
    }

    /**
     * Emits the selected project so the rest of the layout can stay in sync.
     */
    private dispatchSelectionChange(): void {
      const detail: ProjectSelectionChangeDetail = {
        project: this.selectedProject,
        projectCount: this.projects.length,
        error: this.loadError,
      };

      this.dispatchEvent(new window.CustomEvent<ProjectSelectionChangeDetail>("project-change", {
        bubbles: true,
        detail,
      }));
    }

    /**
     * Builds the markup for loading, empty, error, and populated project states.
     */
    private renderContentMarkup(): string {
      if (this.isLoading) {
        return `<div>Loading projects...</div>`;
      }

      if (this.loadError) {
        return `<div>${escapeHtml(this.loadError)}</div>`;
      }

      if (this.projects.length === 0) {
        return `
          <div>No saved Codex projects yet.</div>
          <div class="projects-panel__muted" style="margin-top: 0.5rem;">Start a session to register a project.</div>
        `;
      }

      return this.projects.map((project, index) => {
        const marker = index === this.selectedProjectIndex ? "◉" : "○";
        const selectedClass = index === this.selectedProjectIndex ? "projects-panel__item is-selected" : "projects-panel__item";
        const selectedAttribute = index === this.selectedProjectIndex ? ' data-selected="true"' : "";
        const currentLabel = this.renderProjectStatusMarkup(project.path);

        return `
          <div class="${selectedClass}"${selectedAttribute}>
            <div><span>${marker}</span> <span class="projects-panel__item-name">${escapeHtml(project.name)}</span> <span class="projects-panel__meta">${project.sessionCount} sessions · ${escapeHtml(project.relativeUpdated)}${currentLabel}</span></div>
          </div>
        `;
      })
        .join("");
    }

    /**
     * Builds the trailing status label for one project row.
     */
    private renderProjectStatusMarkup(projectPath: string): string {
      if (projectPath === this.alreadySelectedProjectPath) {
        return ` · <span class="projects-panel__status-already-selected">Already selected</span>`;
      }

      if (projectPath === this.currentProjectPathValue) {
        return ` · <span class="projects-panel__status-current">Current</span>`;
      }

      return "";
    }

    /**
     * Builds the bottom-right session count and selected position label.
     */
    private renderSessionCountMarkup(): string {
      if (this.isLoading) return "Loading";
      if (this.loadError) return "Error";
      if (this.projects.length === 0) return "(0)";

      return `(${this.selectedProjectIndex + 1}/${this.projects.length})`;
    }

  }

  window.customElements.define("projects-panel", ProjectsPanel);
}
