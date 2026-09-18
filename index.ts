#!/usr/bin/env node

import { realpath } from "node:fs/promises";
import { TermDOM } from '@b9g/termdom';
import { renderHome } from './src/pages/index.js';

import { RoutesNames } from './src/pages/types.js';
import { detectProviderStatuses, resolvePreferredProvider } from './src/app/registry/index.js';
import { getActiveProvider, setActiveProvider, subscribeActiveProvider } from "./src/entities/provider/index.js";

const projectPath = await realpath(process.cwd()).catch(() => process.cwd());
const term = new TermDOM();
const { document, window } = term;

const routes = {
  home: renderHome,
};

let cleanup: (() => void) | null = null;
let currentRoute = RoutesNames.HOME;

await term.attach();
// Use the persistent root so switching providers does not leave fullscreen.
await document.body.requestFullscreen();

function navigate(route: RoutesNames) {
  if (!routes[route]) return;
  currentRoute = route;

  render();
}

function render() {
  cleanup?.();
  cleanup = routes[currentRoute]({ document, window, navigate, projectPath }) ?? null;
}

// Boot into a provider that is actually usable, preferring one with history, so
// the first screen is not an empty dashboard for a provider that is not set up.
const preferredProvider = resolvePreferredProvider(await detectProviderStatuses());

if (preferredProvider && preferredProvider !== getActiveProvider().providerId) {
  setActiveProvider({ modelId: null, modelLabel: null, providerId: preferredProvider });
}

// Switching provider rebuilds the page so every panel reads from the new source.
subscribeActiveProvider(() => {
  queueMicrotask(() => render());
});

render();
