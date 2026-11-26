type T = (k: string) => string;

export default function Hero({ t, onAbout }: { t: T; onAbout: () => void }) {
  return (
    <section className="hero">
      <div className="hero-text">
        <h2>{t("heroTitle")}</h2>
        <p>{t("heroSub")}</p>
        <div className="hero-actions">
          <button className="signal" onClick={() => document.getElementById("workbench")?.scrollIntoView({ behavior: "smooth" })}>{t("heroCta")}</button>
          <button className="ghost" onClick={onAbout}>{t("heroMore")}</button>
        </div>
      </div>
      {/* دستگاه کاربر (سمت چپ) با فایل‌های قفل‌شده؛ مسیر ارسال به ابر خط می‌خورد */}
      <svg className="hero-art" viewBox="0 0 440 260" role="img" aria-label={t("heroTitle")}>
        <rect className="dev" x="16" y="34" width="236" height="184" rx="14" />
        <g className="pg">
          <rect x="44" y="72" width="108" height="128" rx="6" transform="rotate(-7 98 136)" />
          <rect x="82" y="62" width="108" height="128" rx="6" />
          <rect className="ln" x="98" y="84" width="60" height="6" rx="3" />
          <rect className="ln" x="98" y="100" width="76" height="6" rx="3" />
          <rect className="ln" x="98" y="116" width="48" height="6" rx="3" />
        </g>
        <g transform="translate(196 156)">
          <rect className="lock" x="0" y="14" width="34" height="26" rx="5" />
          <path className="lockline" d="M7 14 v-7 a10 10 0 0 1 20 0 v7" />
        </g>
        <path className="cloud" d="M326 158 h66 a24 24 0 0 0 0 -48 a34 34 0 0 0 -64 8 a20 20 0 0 0 -2 40z" />
        <line className="dash" x1="258" y1="134" x2="316" y2="134" />
        <g className="cross"><line x1="276" y1="118" x2="298" y2="150" /><line x1="298" y1="118" x2="276" y2="150" /></g>
      </svg>
    </section>
  );
}
