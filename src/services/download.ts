export function downloadImage(url: string, filename: string) {
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

export async function downloadImages(urls: string[], baseName: string) {
  for (let i = 0; i < urls.length; i++) {
    downloadImage(urls[i], `${baseName}-${i + 1}.${extensionOf(urls[i])}`);
    if (i < urls.length - 1) await new Promise((resolve) => setTimeout(resolve, 180));
  }
}

function extensionOf(url: string): string {
  if (url.startsWith('data:image/jpeg')) return 'jpg';
  if (url.startsWith('data:image/webp')) return 'webp';
  return 'png';
}
