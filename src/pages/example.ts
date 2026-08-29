import { PageProps, RoutesNames } from "./types.js";

export function renderExample({ document, navigate }: PageProps) {
  document.body.innerHTML = `
    <style>
      .card { border: 1px solid #5fafff; padding: 0 1ch; width: 36ch; }
      .title { color: #5fafff; font-weight: bold; }
      .done { color: green; }
      .rest { color: #444; }
      .pct { color: #888; }
    </style>
    <div class="card">
      <div class="title" id="go-home">EXAMPLE PAGE</div>
      <div>
        <span class="done" id="done"></span><span class="rest" id="rest"></span>
        <span class="pct" id="pct"></span>
      </div>
    </div>
  `;

  function goToHome(event: Event) {
    event.preventDefault();
    navigate(RoutesNames.HOME);
  }

  document.getElementById('go-home')?.addEventListener('click', goToHome);
}
