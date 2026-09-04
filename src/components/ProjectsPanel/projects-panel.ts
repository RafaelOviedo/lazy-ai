import { CodexProjectRepository } from "../../repositories/projects/codex/index.js";

import type { CodexProjectReader, CodexProjectSummary } from "../../repositories/projects/codex/types.js";
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
    private projectReader: CodexProjectReader = new CodexProjectRepository();
    private projects: CodexProjectSummary[] = [];
    private selectedProjectIndex = 0;
    private isLoading = true;
    private loadError: string | null = null;

    constructor() {
      super();
      this.onKeyDown = this.onKeyDown.bind(this);
    }

    /**
     * Initializes the panel markup and loads projects when the element is attached.
     */
    connectedCallback(): void {
      if (!this.hasAttribute("tabindex")) {
        this.tabIndex = 0;
      }

      this.render();
      this.addEventListener("keydown", this.onKeyDown);
      void this.reload();
    }

    /**
     * Cleans up event bindings when the element leaves the document.
     */
    disconnectedCallback(): void {
      this.removeEventListener("keydown", this.onKeyDown);
    }

    /**
     * Sets the preferred project path selected after loading.
     */
    set projectPath(value: string) {
      if (this.projectPathValue === value) return;

      this.projectPathValue = value;

      if (this.isConnected && !this.isLoading && this.projects.length > 0) {
        this.selectedProjectIndex = this.getPreferredProjectIndex();
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
    set repository(value: CodexProjectReader) {
      this.projectReader = value;

      if (this.isConnected) {
        void this.reload();
      }
    }

    /**
     * Exposes the currently selected project to parent views.
     */
    get selectedProject(): CodexProjectSummary | null {
      return this.projects[this.selectedProjectIndex] ?? null;
    }

    /**
     * Loads the latest projects and refreshes the panel.
     */
    async reload(): Promise<void> {
      this.isLoading = true;
      this.render();

      try {
        this.loadError = null;
        this.projects = await this.projectReader.listProjects();
        this.selectedProjectIndex = this.getPreferredProjectIndex();
        this.syncProjectPathToSelection();
      } catch {
        this.loadError = "Failed to load Codex projects.";
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
            height: 39%;
            border: 1px solid #5fafff;
            border-radius: 5px;
            box-sizing: border-box;
            overflow: hidden;
          }

          projects-panel:focus {
            border-color: #fff;
            outline: none;
          }

          .projects-panel__content {
            overflow: scroll;
            max-height: 15px;
          }

          .projects-panel__title {
            color: #5fafff;
            border: 1px solid transparent;
          }

          .projects-panel__item {
            display: flex;
            justify-content: flex-start;
            align-items: center;
            height: 3px;
          }

          .projects-panel__item.is-selected {
            color: #ffffff;
            height: 3px;
            background: blue;
          }

          .projects-panel__item-name {
            color: #d7ecff;
            font-size: 6px;
          }

          .projects-panel__meta,
          .projects-panel__muted {
            color: #8aa4bf;
          }
        </style>

        <legend class="projects-panel__title">Projects</legend>
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
      this.syncProjectPathToSelection();

      this.render();
      this.revealSelectedProject();
      this.dispatchSelectionChange();
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

      if (key === "j" || key === "arrowdown") {
        this.moveSelection(1);
        event.preventDefault();
        return;
      }

      if (key === "k" || key === "arrowup") {
        this.moveSelection(-1);
        event.preventDefault();
      }
    }

    /**
     * Finds the preferred project after loading, falling back to the first item.
     */
    private getPreferredProjectIndex(): number {
      if (this.projects.length === 0) return 0;
      if (!this.projectPathValue) return 0;

      const projectIndex = this.projects.findIndex((project) => project.path === this.projectPathValue);

      return projectIndex === -1 ? 0 : projectIndex;
    }

    /**
     * Keeps the public project path aligned with the current selection.
     */
    private syncProjectPathToSelection(): void {
      const selectedProject = this.selectedProject;

      if (selectedProject) {
        this.projectPathValue = selectedProject.path;
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
        return `<div>${this.escapeHtml(this.loadError)}</div>`;
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

        return `
          <div class="${selectedClass}"${selectedAttribute}>
            <div><span>${marker}</span> <span class="projects-panel__item-name">${this.escapeHtml(project.name)}</span> <span class="projects-panel__meta">${project.sessionCount} sessions · ${this.escapeHtml(project.relativeUpdated)}</span></div>
          </div>
        `;
      })
        .join("");
    }

    /**
     * Escapes display strings before injecting them into the panel markup.
     */
    private escapeHtml(value: string): string {
      return value
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
    }
  }

  window.customElements.define("projects-panel", ProjectsPanel);
}
