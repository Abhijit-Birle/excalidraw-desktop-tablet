export type InkPoint = {
  x: number;
  y: number;
  t?: number;
};

export type InkStroke = {
  points: InkPoint[];
};

export type InkData = InkStroke[];

export type RecognitionCandidate = {
  text: string;
  score?: number;
};

export type RecognitionResult = {
  candidates: string[];
};

export interface HandwritingEngine {
  readonly id: "native" | "web" | "mock";
  isAvailable(locale?: string): Promise<boolean>;
  recognize(ink: InkData, locale?: string): Promise<RecognitionResult>;
  downloadModel?(locale: string): Promise<void>;
}

export type StrokeLineCluster = {
  strokes: InkStroke[];
  bounds: {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
    width: number;
    height: number;
  };
};

