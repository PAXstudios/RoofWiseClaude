/** Calendar input is local time. Reject impossible dates and DST gaps. */
export function appointmentAt(date: string, time: string): string | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return undefined;
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  const value = new Date(year, month - 1, day, hour, minute);
  if (value.getFullYear() !== year || value.getMonth() !== month - 1 || value.getDate() !== day ||
      value.getHours() !== hour || value.getMinutes() !== minute) return undefined;
  return value.toISOString();
}

export function appointmentFields(iso?: string): { date: string; time: string } {
  const value = iso ? new Date(iso) : null;
  if (!value || !Number.isFinite(value.getTime())) return { date: '', time: '' };
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    date: `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`,
    time: `${pad(value.getHours())}:${pad(value.getMinutes())}`,
  };
}

export function isAppointmentTimestamp(iso?: string): iso is string {
  // Require an actual clock and timezone, not Date.parse's loose date-only input.
  if (!iso || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(iso)) return false;
  const [date, clock] = iso.split('T');
  const [year, month, day] = date.split('-').map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day));
  return utc.getUTCFullYear() === year && utc.getUTCMonth() === month - 1 && utc.getUTCDate() === day &&
    Number(clock.slice(0, 2)) < 24 && Number(clock.slice(3, 5)) < 60 && Number(clock.slice(6, 8)) < 60 &&
    Number.isFinite(Date.parse(iso));
}
