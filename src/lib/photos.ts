import catalogue from '../data/photos.json';

export interface Photograph {
  id: string;
  src: string;
  srcSet: string;
  width: number;
  height: number;
  title: string;
  caption: string;
  year: number;
  creator: string;
  sourceUrl: string;
  license: string;
  licenseUrl: string;
  changes: string;
}

export const photos: Photograph[] = catalogue;
