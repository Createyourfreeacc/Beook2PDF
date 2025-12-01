const progressMap: Record<string, number> = {};

// Phase-based progress system
// Each phase has a name and a weight (percentage of total progress)
// Weights should sum to 100
type Phase = { name: string; weight: number };

const PHASES: Phase[] = [
  { name: 'init', weight: 2 },       // Initial setup
  { name: 'fetch', weight: 18 },     // Fetching data from database
  { name: 'process', weight: 24 },   // Processing HTML content
  { name: 'convert', weight: 48 },   // Converting pages to PDF
  { name: 'merge', weight: 5 },      // Merging PDF documents
  { name: 'finalize', weight: 3 },   // Creating TOC and final touches
];

// Pre-calculate phase start percentages for efficiency
const phaseStartMap: Record<string, number> = {};
let cumulative = 0;
for (const phase of PHASES) {
  phaseStartMap[phase.name] = cumulative;
  cumulative += phase.weight;
}

/**
 * Set progress within a specific phase.
 * @param jobId - The job identifier
 * @param phaseName - The name of the phase (e.g., 'fetch', 'convert')
 * @param progress - Progress within the phase (0 to 1)
 */
export function setPhaseProgress(jobId: string, phaseName: string, progress: number) {
  const phase = PHASES.find(p => p.name === phaseName);
  if (!phase) {
    console.warn(`Unknown phase: ${phaseName}`);
    return;
  }

  const clampedProgress = Math.max(0, Math.min(1, progress));
  const phaseStart = phaseStartMap[phaseName];
  const absoluteProgress = Math.floor(phaseStart + (phase.weight * clampedProgress));
  
  progressMap[jobId] = absoluteProgress;
}

/**
 * Set progress directly (for backwards compatibility)
 */
export function setProgress(jobId: string, value: number) {
  progressMap[jobId] = value;
}

export function getProgress(jobId: string): number {
  return progressMap[jobId] || 0;
}

export function clearProgress(jobId: string) {
  delete progressMap[jobId];
}

// Export phases for external use (e.g., adding new phases dynamically)
export { PHASES, phaseStartMap };
