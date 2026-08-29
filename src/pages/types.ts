
export type PageProps = {
  document: Document;
  navigate: (route: Routes) => void;
}

export enum RoutesNames {
  HOME = 'home',
  EXAMPLE = 'example',
}

type Routes = RoutesNames.HOME | RoutesNames.EXAMPLE;
