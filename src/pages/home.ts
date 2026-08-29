import { PageProps, RoutesNames } from "./types.js";

export function renderHome({ document, navigate }: PageProps) {
  document.body.innerHTML = `
    <style>
      .card { border: 1px solid #5fafff; padding: 0 1ch; width: '100%'; height: 60ch }
      .title { color: #5fafff; font-weight: bold; }
      .done { color: green; }
      .rest { color: #444; }
      .pct { color: #888; }
    </style>
    <div class="card">
      <div class="title" id="go-example">HOME PAGE 2</div>
      <div>
        <span class="done" id="done"></span><span class="rest" id="rest"></span>
        <span class="pct" id="pct"></span>
      </div>
    </div>
  `;

  function goToExample(event: Event) {
    event.preventDefault();
    navigate(RoutesNames.EXAMPLE);
  }

  document.getElementById("go-example")?.addEventListener("click", goToExample);
}
