/**
 * Downscale a captured photo to a bounded JPEG before storing it as a BLOB.
 * Keeps the database small so the single-file export stays portable.
 */

export interface DownscaledImage {
  bytes: Uint8Array;
  mimeType: string;
}

export async function downscaleToJpeg(
  file: Blob,
  maxEdge = 1600,
  quality = 0.85,
): Promise<DownscaledImage> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Could not decode image'));
      el.src = url;
    });
    const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D is not available');
    // JPEG has no alpha: paint white behind transparent sources.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', quality),
    );
    if (!blob) throw new Error('Could not encode JPEG');
    return { bytes: new Uint8Array(await blob.arrayBuffer()), mimeType: 'image/jpeg' };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Object URL for displaying stored image bytes. Revoke when the view unmounts. */
export function imageObjectUrl(bytes: Uint8Array, mimeType: string): string {
  // slice() narrows to Uint8Array<ArrayBuffer>, satisfying BlobPart's typing.
  return URL.createObjectURL(new Blob([bytes.slice()], { type: mimeType }));
}
