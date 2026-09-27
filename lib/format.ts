const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

/** 22000 -> "₹22,000"; 150000 -> "₹1,50,000". */
export function formatINR(amount: number): string {
  return inr.format(amount);
}

const dateFmt = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

/** "2026-12-04" -> "4 Dec". */
export function formatDate(iso: string): string {
  return dateFmt.format(new Date(`${iso}T00:00:00Z`));
}

export function formatDateRange(start: string, end: string): string {
  const year = start.slice(0, 4);
  const endYear = end.slice(0, 4);
  return year === endYear
    ? `${formatDate(start)} – ${formatDate(end)} ${year}`
    : `${formatDate(start)} ${year} – ${formatDate(end)} ${endYear}`;
}
