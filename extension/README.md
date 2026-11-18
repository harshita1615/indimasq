# IndiMasq browser extension

Warns before Indian personal data is pasted, sent or attached (text, Word and PDF files) on
ChatGPT, Claude or Gemini, and offers to mask it. Placeholders in the chat show their real value on
hover. Manifest V3; runs entirely on the device, with no network requests.

## Layout

| Path | What |
| --- | --- |
| `src/core/` | Detection engine, a TypeScript port of the Python package. Pinned to it by the parity test |
| `src/core/rules.json` | Keywords, handles, bank codes and scores, generated from Python. Do not edit |
| `src/content/` | Content script: paste/send interception, warning banner, message-box editing |
| `src/shared/sites.ts` | Per-site selectors. Edit here when a chatbot changes its layout |
| `src/content/attachments.ts` | Holds back attached files, checks them, offers a safe copy |
| `src/content/main-world.ts` | Lets the content script see files picked with a detached file input |
| `src/content/restore.ts` | Underlines placeholders in the chat; shows the real value on hover |
| `src/background/`, `src/offscreen/` | Opens the offscreen page where PDF.js reads and redraws PDFs |
| `src/files/` | ZIP, Word (.docx) and PDF handling, shared by the extension and the tests |
| `src/popup/` | Toolbar popup: switches, counts and the current chat's hidden values |
| `src/demo/` | The website demo (indimasq.bigforge.tech/demo/). `npm run build:demo` bundles it into `docs/demo/demo.js`, which is committed; CI fails if it is stale |
| `_locales/` | English and Hindi strings |
| `store/LISTING.md` | Chrome Web Store form answers |

## Develop

```bash
npm install
npm test            # unit, parity (vs Python) and privacy tests
npm run typecheck
npm run build       # -> dist/
npm run package     # -> indimasq-extension-<version>.zip
```

Load `dist/` with **chrome://extensions → Developer mode → Load unpacked**. After rebuilding,
click reload on the IndiMasq card **and reload the chatbot tabs**: Chrome does not replace an
extension's script in tabs that were already open.

## Keeping Python and TypeScript in step

Detection rules live in the Python package. After changing them:

```bash
python scripts/export_rules.py    # -> src/core/rules.json
python scripts/export_parity.py   # -> test/fixtures/parity.json
cd extension && npm test
```

CI regenerates both files and fails if the committed copies are stale or if TypeScript disagrees
with Python on any of the 2,140 parity cases.

## Attached files

Text files and Word documents are read and rewritten in the content script: values become the chat's
own placeholders, so they can be revealed on hover. A .docx is edited as XML text, so formatting is
kept, and a value split over several runs is still found.

In files, a value written right after its label ("Aadhaar number: 0000 1111 2222", "PAN QWERT1234Z",
"UPI ID name@anything", "Bank account: 98765432", "account ending 6789", "IFSC: SBIN 0001234") is
masked even when it fails the strict checks (checksum, PAN holder type, mobile prefix, known UPI
handle, 9-18 account digits, IFSC format): forms label their fields, so the label is evidence enough. See
`src/files/labelled.ts`. Chat messages and the Python package keep the strict rules.

PDFs are opened in the offscreen page with PDF.js, bundled in `dist/pdf/` (licences in
`THIRD_PARTY_NOTICES.txt`); nothing is downloaded. Its plain-JavaScript image decoders are used, so
the extension keeps the default security policy. The safe copy is built from scratch: each page is
drawn as a picture, each value is covered by a box carrying its placeholder (placed by measuring the
characters in the PDF's own fonts, with a safety margin), and the pictures are written into a new
PDF. Nothing of the original's text, metadata, forms or attachments is carried over. Locked,
scanned (no text) and very long PDFs are reported and left to the user.

Test files in `test/fixtures/` hold made-up values only. `sample.docx` and `sample.pdf` were written
by Microsoft Word; `locked.pdf` and `scanned.pdf` come from `scripts/make_pdf_fixtures.py`.
