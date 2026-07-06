/**
 * Shared CSV export helper.
 * Constructs the download URL and triggers a file download via a temporary <a> element.
 */
export function downloadCSV(
  baseUrl: string,
  params: Record<string, string>
): void {
  const url = new URL(baseUrl, window.location.origin);
  Object.entries(params).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });

  const anchor = document.createElement('a');
  anchor.href = url.toString();
  anchor.setAttribute('download', '');
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
}
