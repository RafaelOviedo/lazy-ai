import { PageProps, RoutesNames } from "./types.js";

export function renderHome({ document, navigate }: PageProps) {
  document.body.innerHTML = `
    <div class="card">
      <div class="container-for-1-and-2">
        <div class="container-1">

          <div class="container-1-1" id="panel-1" tabindex="0">
            <legend style="color: #5fafff;">Sessions</legend>

          </div>

          <div class="container-1-2" id="panel-2" tabindex="0">
            <legend style="color: #5fafff;">Projects</legend>

          </div>

          <div class="container-1-3" id="panel-3" tabindex="0">
            <legend style="color: #5fafff;">Context</legend>

          </div>

        </div>

        <div class="container-2">
          <legend style="color: #5fafff;">Details</legend>

        </div>
      </div>

      <footer class="footer">
        <legend style="color: #5fafff;">Current status</legend>
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

      .container-1-1 {
        width: fit-content;
        height: 37%;
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

      .footer {
        width: 97.5%;
        height: 10%;
        border: 1px solid #5fafff;
      }
    </style>
  `;

  const panel1 = document.getElementById("panel-1");
  const panel2 = document.getElementById("panel-2");
  const panel3 = document.getElementById("panel-3");

  const panels = [panel1, panel2, panel3].filter((panel): panel is NonNullable<typeof panel1> => panel !== null);

  panel1?.focus();

  function onKeyDown(event: KeyboardEvent) {
    const key = event.key.toLowerCase();

    if (key !== "h" && key !== "l") return;

    const active = document.activeElement;
    const currentIndex = panels.findIndex((panel) => panel === active);

    if (currentIndex === -1) return;

    const direction = key === "l" ? 1 : -1;
    const nextIndex = (currentIndex + direction + panels.length) % panels.length;

    event.preventDefault();
    panels[nextIndex].focus();
  }

  // function goToExample(event: Event) {
  //   event.preventDefault();
  //   navigate(RoutesNames.EXAMPLE);
  // }

  document.addEventListener("keydown", onKeyDown);

  return () => {
    document.removeEventListener("keydown", onKeyDown);
  };

  // document.getElementById("go-example")?.addEventListener("click", goToExample);
}
