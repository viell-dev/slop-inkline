/**
 * Load an image element from a URL.
 *
 * @param url - The image URL (typically an object URL of vault PNG bytes).
 * @returns The decoded image once it has loaded; rejects when loading
 *   fails.
 */
export function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not load ink image."));
    image.src = url;
  });
}
