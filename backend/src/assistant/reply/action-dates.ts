export function nextReminderDate(offsetDays: number, hour: number) {
  const next = new Date();
  next.setHours(hour, 0, 0, 0);
  next.setDate(next.getDate() + offsetDays);
  return next.toISOString();
}

export function nextDateInputValue(offsetDays: number) {
  const next = new Date();
  next.setHours(12, 0, 0, 0);
  next.setDate(next.getDate() + offsetDays);
  return next.toISOString().slice(0, 10);
}
