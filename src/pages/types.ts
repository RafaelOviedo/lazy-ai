
export type PageProps = {
  document: Document;
  navigate: (route: RoutesNames) => void;
}

export enum RoutesNames {
  HOME = 'home',
  EXAMPLE = 'example',
}
