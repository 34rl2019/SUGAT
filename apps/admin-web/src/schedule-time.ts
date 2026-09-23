export function manilaScheduleInstant(value: string) {
  const normalized = value.length === 16 ? `${value}:00` : value;
  const instant = new Date(`${normalized}+08:00`);
  if (Number.isNaN(instant.getTime())) throw new Error('Invalid Asia/Manila schedule time');
  return instant.toISOString();
}
