import { TermDOM } from '@b9g/termdom';
import { renderHome, renderExample } from './src/pages/index.js';

import { RoutesNames } from './src/pages/types';

const term = new TermDOM();
term.attach();

const { document } = term;

const routes = {
  home: renderHome,
  example: renderExample,
};

let cleanup: (() => void) | null = null;
let currentRoute = RoutesNames.HOME;

function navigate(route: RoutesNames) {
  if (!routes[route]) return;
  currentRoute = route;

  render();
}

function render() {
  cleanup?.();
  cleanup = routes[currentRoute]({ document, navigate }) ?? null;
}

render();
