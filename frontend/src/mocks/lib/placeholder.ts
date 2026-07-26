/**
 * Self-contained SVG data-URI placeholders for seeded evidence photos — no
 * external network image host involved. Real uploads during a live session
 * use the actual object URL of the uploaded file (see complaints handler),
 * this is only for fixture data that never had a real photo.
 */
const PALETTE = ["#0f766e", "#7c2d12", "#1e3a8a", "#854d0e", "#4c1d95", "#166534"];

function hashString(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 31 + input.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

export function placeholderPhotoUrl(label: string, seed: number): string {
  const color = PALETTE[(hashString(label) + seed) % PALETTE.length];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480">
    <rect width="100%" height="100%" fill="${color}"/>
    <text x="50%" y="50%" font-family="sans-serif" font-size="28" fill="white"
      text-anchor="middle" dominant-baseline="middle">${label}</text>
  </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
