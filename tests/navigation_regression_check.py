from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
for rel in ("src/ui/App.tsx", "src/ui/App.js"):
    source = (ROOT / rel).read_text(encoding="utf-8")
    assert 'history.pushState(null, "", nextUrl)' in source, f"{rel}: route changes must create browser history entries"
    assert 'window.addEventListener("popstate", syncRoute)' in source, f"{rel}: Back/Forward must restore the view"
    assert 'window.addEventListener("hashchange", syncRoute)' in source, f"{rel}: native hash links must remain supported"
    assert '"assistant"' in source and 'location.hash.slice(1)' in source, f"{rel}: assistant must support direct hash navigation"
    assert "history.replaceState" not in source, f"{rel}: route changes must not overwrite the current history entry"
print("PASS: runtime and TypeScript navigation support direct hash routes, browser Back/Forward, and native hash links")
