/**
 * Client-side image downscaling → base64 data URL.
 *
 * Reward images are stored as base64 in MongoDB (same pattern as the slideshow
 * background), so we must keep them small. This reads a user-picked file,
 * draws it onto a canvas scaled to fit within `maxDim`, and re-encodes as JPEG
 * at the given quality. That reliably brings even multi-megabyte phone photos
 * down to well under the backend's ~1.4MB limit, and it happens entirely in
 * the browser (no upload of the original heavy file).
 */
export async function fileToDownscaledDataUrl(file, { maxDim = 640, quality = 0.8 } = {}) {
  if (!file) throw new Error("Tidak ada file");
  if (!file.type.startsWith("image/")) throw new Error("File harus berupa gambar");

  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Gagal membaca file"));
    reader.readAsDataURL(file);
  });

  const img = await new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Gambar tidak valid"));
    image.src = dataUrl;
  });

  let { width, height } = img;
  if (width > maxDim || height > maxDim) {
    const scale = Math.min(maxDim / width, maxDim / height);
    width = Math.round(width * scale);
    height = Math.round(height * scale);
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  // White backdrop so transparent PNGs don't turn black when encoded as JPEG.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);

  let out = canvas.toDataURL("image/jpeg", quality);
  // Safety net: if it's somehow still too big, step the quality down.
  let q = quality;
  while (out.length > 1_800_000 && q > 0.4) {
    q -= 0.15;
    out = canvas.toDataURL("image/jpeg", q);
  }
  return out;
}
