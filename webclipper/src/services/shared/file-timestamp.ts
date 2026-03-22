function pad2(value: number) {
  return String(Math.trunc(value)).padStart(2, '0');
}

function pad3(value: number) {
  return String(Math.trunc(value)).padStart(3, '0');
}

export function buildLocalTimestampForFilename(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = pad2(date.getMonth() + 1);
  const day = pad2(date.getDate());
  const hours = pad2(date.getHours());
  const minutes = pad2(date.getMinutes());
  const seconds = pad2(date.getSeconds());
  const ms = pad3(date.getMilliseconds());
  return `${year}-${month}-${day}T${hours}-${minutes}-${seconds}-${ms}`;
}

