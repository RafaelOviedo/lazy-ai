import { TermDOM } from '@b9g/termdom';
import { renderHome, renderExample } from './src/pages/index.js';

import { RoutesNames } from './src/pages/types.js';

const projectPath = process.cwd();
const term = new TermDOM();
const { document, window } = term;

const routes = {
  home: renderHome,
  example: renderExample,
};

let cleanup: (() => void) | null = null;
let currentRoute = RoutesNames.HOME;

term.attach();

function navigate(route: RoutesNames) {
  if (!routes[route]) return;
  currentRoute = route;

  render();
}

function render() {
  cleanup?.();
  cleanup = routes[currentRoute]({ document, window, navigate, projectPath }) ?? null;
}

render();
