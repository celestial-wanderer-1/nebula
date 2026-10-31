import type { DownloadedFile } from "./client";

/**
 * Hands a fetched file to the browser as a download, through an object URL
 * and a temporary link. The server's filename wins over `fallbackName`.
 */
export function saveDownload(file: DownloadedFile, fallbackName: string): void {
  const url = URL.createObjectURL(file.blob);
  try {
    const link = document.createElement("a");
    link.href = url;
    link.download = file.filename ?? fallbackName;
    document.body.append(link);
    link.click();
    link.remove();
  } finally {
    // Revoke after the click has been dispatched.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}
