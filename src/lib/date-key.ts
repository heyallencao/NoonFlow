function padDatePart(value: number): string {
  return String(value).padStart(2, '0');
}

export function toLocalDateKey(date: Date): string {
  return `${date.getFullYear()}-${padDatePart(date.getMonth() + 1)}-${padDatePart(date.getDate())}`;
}

