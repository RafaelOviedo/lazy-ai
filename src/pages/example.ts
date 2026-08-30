import { PageProps, RoutesNames } from "./types.js";

export function renderExample({ document, navigate }: PageProps) {
  document.body.innerHTML = `
    <div class="card">
      <div class="text-container">
        <div class="title" >EXAMPLE PAGE</div>
        <div class="title" id="go-home">Go to home</div>
      </div>
      <div>
        <span class="done" id="done"></span><span class="rest" id="rest"></span>
        <span class="pct" id="pct"></span>
      </div>
    </div>

    <style>
      .card {
        display: flex;
        justify-content: center;
        align-items: center;
        border: 1px solid #5fafff;
        padding: 0 1ch;
        width: 100%;
        height: 100%;

        .text-container {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
      }
      .title {
        color: #5fafff;
        font-weight: bold;
      }
      .done {
        color: green;
      }
      .rest {
        color: #444;
      }
      .pct {
        color: #888;
      }
    </style>
  `;

  function goToHome(event: Event) {
    event.preventDefault();
    navigate(RoutesNames.HOME);
  }

  document.getElementById('go-home')?.addEventListener('click', goToHome);
}
