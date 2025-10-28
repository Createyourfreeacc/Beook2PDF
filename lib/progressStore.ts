const progressMap: Record<string, number> = {};

export function setProgress(jobId: string, value: number) {
  progressMap[jobId] = value;
}

export function getProgress(jobId: string): number {
  return progressMap[jobId] || 0;
}

export function clearProgress(jobId: string) {
  delete progressMap[jobId];
}
