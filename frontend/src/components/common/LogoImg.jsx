import { useState } from "react";

function LogoImg({ src, alt = "", size = 18, className = "", rounded = "rounded-sm" }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) return null;
  return (
    <img
      src={src}
      alt={alt}
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      className={`shrink-0 object-contain ${rounded} ${className}`.trim()}
      onError={() => setFailed(true)}
    />
  );
}

/** Fixed-size slot so stacked home/away rows stay aligned when a logo is missing. */
export function LogoSlot({ src, alt = "", size = 16, className = "" }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center ${className}`.trim()}
      style={{ width: size, height: size }}
    >
      <LogoImg src={src} alt={alt} size={size} />
    </span>
  );
}

export default LogoImg;
