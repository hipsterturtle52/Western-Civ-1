# CLEP Western Civilization I: study guide

**Open `clep-western-civilization-i-study-guide.html` in any browser.** It's a single self-contained file that works offline with no install. Progress saves to the browser (export/import JSON under *Progress & data*).

## Editing content
- `outline.json`: official exam format, topic weights, and the unit budget (questions, cards, and hours per unit)
- `src/units/*.txt`: lesson (light markdown; `>> cause | event | consequence` draws a flow), must-know box, comparison tables, timeline (`*` = key event on the cheat sheet), people (`*` = on the cheat sheet), and flashcards (`front :: back`)
- `src/questions/<unit>*.txt`: question bank. Format: `Q e|m|h`, then the stem (`>` passage or `|` table lines allowed), then five options, `+ correct :: why` and `- wrong :: why`
- `src/template.html`: the app (HTML/CSS/JS)

## Build and check
```
python3 build.py        # validates the bank, assigns pools (diag/quiz/pe1/pe2), balances answer positions, writes the HTML
node tools/audit.js     # structural audit + simulated tests + content-coverage report -> AUDIT.md
NODE_PATH=$(npm root -g) node tools/e2e.js   # drives the real app in Chromium (Playwright)
```
