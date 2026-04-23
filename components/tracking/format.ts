/** Shared Turkish-locale formatters for the tracking dashboard. */

export const nfTR = new Intl.NumberFormat('tr-TR');
export const nfTR2 = new Intl.NumberFormat('tr-TR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatNumber(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '-';
  return nfTR.format(Math.round(n));
}

export function formatMoney(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '-';
  const sign = n >= 0 ? '+' : '';
  return `${sign}${nfTR2.format(n)} ₺`;
}

export function formatDecimal(
  n: number | null | undefined,
  digits = 2
): string {
  if (n == null || !Number.isFinite(n)) return '-';
  return new Intl.NumberFormat('tr-TR', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(n);
}

export function formatPercent(
  n: number | null | undefined,
  digits = 1
): string {
  if (n == null || !Number.isFinite(n)) return '-';
  return `%${(n * 100).toFixed(digits).replace('.', ',')}`;
}

/** Signed percent with +/- prefix, used for ROI. */
export function formatRoi(
  n: number | null | undefined,
  digits = 1
): string {
  if (n == null || !Number.isFinite(n)) return '-';
  const sign = n >= 0 ? '+' : '';
  return `${sign}%${(n * 100).toFixed(digits).replace('.', ',')}`;
}

export function roiClass(roi: number | null | undefined): string {
  if (roi == null || !Number.isFinite(roi)) return 'text-muted-foreground';
  if (roi > 0.05) return 'text-green-600 dark:text-green-400 font-semibold';
  if (roi < -0.05) return 'text-red-600 dark:text-red-400 font-semibold';
  return 'text-muted-foreground';
}

export function winRateClass(wr: number | null | undefined): string {
  if (wr == null) return 'text-muted-foreground';
  if (wr >= 0.6) return 'text-green-600 dark:text-green-400 font-medium';
  if (wr < 0.45) return 'text-red-600 dark:text-red-400';
  return '';
}

export function formatDate(iso: string | Date | null | undefined): string {
  if (!iso) return '-';
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleDateString('tr-TR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

export function formatDateTime(iso: string | Date | null | undefined): string {
  if (!iso) return '-';
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleString('tr-TR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}
