export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
export const formatEta = (minutes: number | null) => minutes == null ? 'ETA unavailable' : minutes < 3 ? 'Arriving soon' : `~${Math.round(minutes)} min`;
