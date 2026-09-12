import { TermDOM } from '@b9g/termdom';
import { renderHome } from './src/pages/index.js';

import { RoutesNames } from './src/pages/types.js';
import { detectAvailableProviders } from './src/app/registry/index.js';
import { getActiveProvider, setActiveProvider, subscribeActiveProvider } from './src/app/store/active-provider.js';

const projectPath = process.cwd();
const term = new TermDOM();
const { document, window } = term;

const routes = {
  home: renderHome,
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

const availableProviders = await detectAvailableProviders();

if (availableProviders.length > 0 && !availableProviders.includes(getActiveProvider().providerId)) {
  setActiveProvider({ modelId: null, modelLabel: null, providerId: availableProviders[0] });
}

// Switching provider rebuilds the page so every panel reads from the new source.
subscribeActiveProvider(() => {
  queueMicrotask(() => render());
});

render();
