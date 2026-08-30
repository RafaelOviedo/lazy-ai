import { PageProps, RoutesNames } from "./types.js";

export function renderHome({ document, navigate }: PageProps) {
  document.body.innerHTML = `
    <div class="card">
      <div class="container-1">

        <div class="container-1-1" id="panel-1" tabindex="0">

        </div>

        <div class="container-1-2" id="panel-2" tabindex="0">

        </div>

      </div>

      <div class="container-2">

      </div>
    </div>

    <style>
      .card {
        display: flex;
        justify-content: space-evenly;
        align-items: center;
        border: 1px solid #5fafff;
        padding: 0 1ch;
        width: 100%;
        height: 100%;
      }

      .container-1 {
        display: flex;
        flex-direction: column;
        justify-content: space-evenly;
        width: 30%;
        height: 96%;
      }

      .container-2 {
        width: 67%;
        height: 96%;
        border: 1px solid #5fafff;
      }

      .container-1-1 {
        width: fit-content;
        height: 47%;
        border: 1px solid #5fafff;
      }

      .container-1-2 {
        width: fit-content;
        height: 49%;
        border: 1px solid #5fafff;
      }

     .container-1-1:focus,
     .container-1-2:focus {
       border-color: #ffd75f;
       background-color: #1a1a1a;
     }

     /* .container-1-1:focus, */
     /* .container-1-2:focus { */
     /*   border-color: #fff; */
     /* } */
    </style>
  `;

  const panel1 = document.getElementById("panel-1");
  const panel2 = document.getElementById("panel-2");

  panel1?.focus();

  function onKeyDown(event: KeyboardEvent) {
    const active = document.activeElement;

    if ((event.key === "l" || event.key === "L") && active === panel1) {
      event.preventDefault();
      panel2?.focus();
    }

    if ((event.key === "h" || event.key === "H") && active === panel2) {
      event.preventDefault();
      panel1?.focus();
    }
  }

  // function goToEample(event: Event) {
  //   event.preventDefault();
  //   navigate(RoutesNames.EXAMPLE);
  // }

  document.addEventListener("keydown", onKeyDown);

  return () => {
    document.removeEventListener("keydown", onKeyDown);
  };

  // document.getElementById("go-example")?.addEventListener("click", goToExample);
}
