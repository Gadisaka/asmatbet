import { useCallback, useEffect, useState } from "react";
import brandBanner from "../../assets/banners/01-welcome-bonus.png";
import welcomeBanner from "../../assets/banners/02-welcome-bonus.png";
import cashbackBanner from "../../assets/banners/03-weekly-cashback.png";
import cashOutBanner from "../../assets/banners/04-cash-out.png";
import depositBanner from "../../assets/banners/05-first-deposit.png";

const BANNERS = [
  { src: brandBanner, alt: "AsmatBet sports and casino" },
  { src: welcomeBanner, alt: "Welcome bonus 100% on your first bet" },
  { src: cashbackBanner, alt: "10% weekly cashback" },
  { src: cashOutBanner, alt: "Cash out with 0% commission" },
  { src: depositBanner, alt: "1st deposit reward every day" },
];

const ROTATE_MS = 4500;

function HeroBanner() {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  const go = useCallback((next) => {
    setIndex((next + BANNERS.length) % BANNERS.length);
  }, []);

  useEffect(() => {
    if (paused) return undefined;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return undefined;
    }
    const id = window.setInterval(() => {
      setIndex((current) => (current + 1) % BANNERS.length);
    }, ROTATE_MS);
    return () => window.clearInterval(id);
  }, [paused]);

  return (
    <div
      className="sb-card relative aspect-video w-full min-w-0 max-w-full overflow-hidden rounded-[1.15rem] transition-shadow duration-500 hover:shadow-[0_20px_48px_-14px_rgba(212,175,55,0.18)]"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      {BANNERS.map((banner, bannerIndex) => (
        <img
          key={banner.alt}
          src={banner.src}
          alt={banner.alt}
          className={`absolute inset-0 h-full w-full object-cover object-center transition-opacity duration-700 ${
            bannerIndex === index ? "opacity-100" : "pointer-events-none opacity-0"
          }`}
          width={820}
          height={410}
          decoding="async"
        />
      ))}

      <button
        type="button"
        aria-label="Previous banner"
        onClick={() => go(index - 1)}
        className="absolute left-2 top-1/2 z-10 flex size-8 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border border-white/20 bg-black/45 text-lg text-white hover:bg-black/70"
      >
        ‹
      </button>
      <button
        type="button"
        aria-label="Next banner"
        onClick={() => go(index + 1)}
        className="absolute right-2 top-1/2 z-10 flex size-8 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border border-white/20 bg-black/45 text-lg text-white hover:bg-black/70"
      >
        ›
      </button>

      <div className="absolute bottom-2.5 left-1/2 z-10 flex -translate-x-1/2 gap-1.5">
        {BANNERS.map((banner, bannerIndex) => (
          <button
            key={banner.alt}
            type="button"
            aria-label={`Show banner ${bannerIndex + 1}`}
            aria-current={bannerIndex === index ? "true" : undefined}
            onClick={() => setIndex(bannerIndex)}
            className={`h-1.5 cursor-pointer rounded-full transition-all ${
              bannerIndex === index ? "w-5 bg-[#d4af37]" : "w-1.5 bg-white/55"
            }`}
          />
        ))}
      </div>
    </div>
  );
}

export default HeroBanner;
