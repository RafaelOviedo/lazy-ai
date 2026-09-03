
import type { TermDOM } from "@b9g/termdom";

export type PageProps = {
  document: Document;
  projectPath: string;
  window: TermDOM["window"];
  navigate: (route: RoutesNames) => void;
}

export enum RoutesNames {
  HOME = 'home',
}
