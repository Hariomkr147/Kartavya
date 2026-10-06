import { useEffect, useState } from "react";
import QRCode from "qrcode";

interface QrCodeProps {
  value: string;
  alt: string;
  size?: number;
}

/** Draws `value` as a QR code image. Generated in the browser — the secret never leaves the page. */
export function QrCode({ value, alt, size = 176 }: QrCodeProps) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(value, { margin: 1, width: size, errorCorrectionLevel: "M" })
      .then((url) => {
        if (!cancelled) setSrc(url);
      })
      .catch(() => {
        if (!cancelled) setSrc(null);
      });
    return () => {
      cancelled = true;
    };
  }, [value, size]);

  if (!src) {
    return (
      <div
        className="bg-canvas rounded-md"
        style={{ width: size, height: size }}
        aria-hidden="true"
      />
    );
  }
  return (
    <img
      src={src}
      alt={alt}
      width={size}
      height={size}
      // White backing whatever the theme: a dark QR on a dark page will not scan.
      className="rounded-md bg-white p-1"
    />
  );
}
