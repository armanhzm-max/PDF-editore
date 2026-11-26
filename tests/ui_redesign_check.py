from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
app_tsx = (ROOT / "src/ui/App.tsx").read_text(encoding="utf-8")
app_js = (ROOT / "src/ui/App.js").read_text(encoding="utf-8")
icons_tsx = (ROOT / "src/ui/icons.tsx").read_text(encoding="utf-8")
icons_js = (ROOT / "src/ui/icons.js").read_text(encoding="utf-8")
i18n_ts = (ROOT / "src/core/i18n.ts").read_text(encoding="utf-8")
i18n_js = (ROOT / "src/core/i18n.js").read_text(encoding="utf-8")
css = (ROOT / "src/ui/styles.css").read_text(encoding="utf-8")
html = (ROOT / "index.html").read_text(encoding="utf-8")

for label, condition in [
    ("explicit dark and light themes", ':root[data-theme="dark"]' in css and ':root[data-theme="light"]' in css),
    ("theme preference persisted", 'localStorage.setItem("pdat-theme", theme)' in app_tsx and 'localStorage.getItem("pdat-theme")' in app_tsx),
    ("first-paint theme initialized before React", '<script src="/theme-init.js"></script>' in html and html.index('/theme-init.js') < html.index('/src/main.tsx') and 'localStorage.getItem("pdat-theme")' in (ROOT / "public/theme-init.js").read_text(encoding="utf-8") and 'document.documentElement.dataset.theme = theme' in (ROOT / "public/theme-init.js").read_text(encoding="utf-8")),
    ("accessible theme switcher", 'className="theme-toggle"' in app_tsx and 'aria-label={theme === "dark"' in app_tsx),
    ("sun and moon icons mirrored to production JS", '  sun:' in icons_tsx and '  moon:' in icons_tsx and 'sun:' in icons_js and 'moon:' in icons_js),
    ("Persian and English theme labels", 'themeToLight:' in i18n_ts and 'themeToDark:' in i18n_ts and 'themeToLight:' in i18n_js and 'themeToDark:' in i18n_js),
    ("grouped accessible navigation keeps all routes", 'tabs-workspaces' in app_tsx and 'tabs-manage' in app_tsx and 'aria-current={tab === k ? "page" : undefined}' in app_tsx),
    ("all major workspaces receive unified styling", all(x in css for x in ['.pdf-editor-page', '.scan-page', '.word-page', '.excel-page', '.ppt-page', '.doc-ai-page', '.local-library-page', '.feedback-page', '.plans-page'])),
    ("responsive and reduced-motion rules", '@media (max-width: 720px)' in css and '@media (max-width: 460px)' in css and 'prefers-reduced-motion: reduce' in css),
    ("paired production App and i18n modules updated", 'theme-toggle' in app_js and 'navWorkspaces' in i18n_js),
    ("AI connection is Worker-feature-gated and fail-closed", 'getAIFeatureStatus' in app_tsx and 'getAIFeatureStatus' in (ROOT / "src/core/ai.ts").read_text(encoding="utf-8") and 'AI_ENABLED = "false"' in (ROOT / "wrangler.toml").read_text(encoding="utf-8")),
]:
    if not condition:
        raise SystemExit(f"FAIL: {label}")
    print(f"PASS: {label}")
