# Chrome Web Store submission: copy-paste answers

Everything the developer dashboard asks for, in the order it asks. Upload
`indimasq-extension-<version>.zip` (from `npm run package`).

## Store listing tab

**Name** (from the package): IndiMasq: Indian PII shield for AI chats

**Summary** (from the package, 132 characters max):
Warns before you send or attach Aadhaar, PAN, UPI, bank or phone details on ChatGPT, Claude or Gemini, and masks them. On-device.

**Description:**

```
IndiMasq stops your personal details from slipping into AI chats by accident.

When you paste or send a message on ChatGPT, Claude or Gemini, IndiMasq checks it for Indian personal data. If it finds any, it pauses and shows you what kind, for example "This message contains 1 PAN and 1 phone number", with three choices:

• Mask: replace them with placeholders like [PAN_1] and [PHONE_1], so the AI never sees the real values. You review the message before sending.
• Send anyway: send it as it is.
• Cancel: go back and edit.

When the AI replies with [PAN_1] or [PHONE_1], point at the placeholder to see the real value in a small IndiMasq tooltip. The chat page and the AI never get it. The popup also lists what was hidden in the current chat.

FILES TOO
Attach a PDF, Word document or text file and IndiMasq checks it on your device first. If it holds personal details, IndiMasq offers a safe copy with each value replaced by a placeholder like [PAN_1]. PDF copies are redrawn as page pictures, so the original text cannot be recovered from them. Locked or scanned PDFs are flagged so you can decide.

WHAT IT DETECTS
• Aadhaar numbers (checked with the official Verhoeff check digit)
• PAN
• UPI IDs (name@okaxis, number@paytm and more)
• IFSC codes
• Bank account numbers (when words like "account", "a/c" or "khata" are nearby)
• Indian mobile numbers (+91, 0 or 10-digit)
• GSTIN (with its check character)
• Email addresses
It understands English, Hinglish and Hindi context: "mera aadhaar", "khata number", "मोबाइल".
In attached files, a value written next to its label ("Aadhaar number: ...", "Account number: ...", "IFSC: ...") is masked even if it is not a valid ID.

PRIVATE BY DESIGN
• Runs entirely on your device. IndiMasq makes no network requests at all.
• Your messages and files are never stored, logged or sent anywhere. The PDF reader (PDF.js) is built into the extension; nothing is downloaded.
• It only works on chatgpt.com, claude.ai and gemini.google.com, nowhere else.
• It stores only on/off settings and counts like "PAN: 3", which you can reset.
• Open source (MIT): https://github.com/harshita1615/indimasq

GOOD TO KNOW
• Interface in English and Hindi.
• You can turn IndiMasq off for any site from its toolbar popup.
• IndiMasq does not yet detect names, addresses, card numbers or text inside pictures (scanned pages, photos).
• IndiMasq reduces risk but can miss things. Please check before you send. It is not legal advice and does not by itself make anyone compliant with any law.

IndiMasq is not affiliated with OpenAI, Anthropic or Google.
```

**Category:** Make Chrome Yours → Privacy & Security
**Language:** English (Hindi is included through `_locales/hi`)

**Graphic assets:**
- Store icon 128×128: `extension/icons/icon128.png`
- Screenshots: the five 1280×800 PNGs (no alpha) in `extension/store/screenshots/`, uploaded
  in order as Global screenshots. (None shows file checks yet; a sixth showing the "Attach safe
  copy" banner and a redacted PDF would help, made with made-up data only.) Regenerate them with `scripts/make_store_screenshots.py`;
  captures must contain made-up data only.
- Small promo tile 440×280: optional

**Official URL:** none
**Homepage URL:** https://indimasq.bigforge.tech/
**Support URL:** https://github.com/harshita1615/indimasq/issues

## Privacy practices tab

**Single purpose:**
```
IndiMasq warns users before they send Indian personal data (Aadhaar, PAN, UPI ID, IFSC, bank account, phone number, GSTIN, email) to AI chatbots, in messages or attached files, and lets them replace it with placeholders.
```

**Permission justification: storage**
```
Saves the user's on/off choice for each supported site, whether to check attached files and to show real values on hover, and the number of items caught per type (for example "PAN: 3"), shown in the popup. Only these flags and counts are stored, locally on the device. No message text or personal data is stored.
```

**Permission justification: host permissions (content script on chatgpt.com, claude.ai, gemini.google.com)**
```
The extension must read the text in the message box on these three AI chat sites at the moment the user pastes or sends, to check it for personal data and offer to mask it before it is submitted. It also reads files the user attaches there (text, Word, PDF), to check them the same way. After masking, it reads the chat on that page to find its own placeholders (such as [PAN_1]) and show the original value in a tooltip when the user points at one, on the user's screen only. It runs on no other sites. All processing happens locally; nothing is transmitted.
```

**Permission justification: offscreen**
```
PDF files attached in the chat are checked for personal data with PDF.js, which is bundled inside the extension. PDF.js needs a worker and a page to draw on, which content scripts cannot provide; the offscreen document does. It only opens the file it is given, returns its text or a safe copy with the personal details covered, keeps nothing, and closes itself when idle. Nothing is downloaded or transmitted.
```

**Are you using remote code?** No, I am not using remote code. (PDF.js is bundled in the
package; nothing is fetched at run time.)

**Data usage: what user data do you plan to collect?** Tick **none** of the boxes.
IndiMasq reads message text and attached files only locally to check them, and nothing leaves the
device, so nothing is "collected" in the sense the form means (transmitted off the device).

**Certifications:** tick all three:
- I do not sell or transfer user data to third parties, outside of the approved use cases
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- I do not use or transfer user data to determine creditworthiness or for lending purposes

**Privacy policy URL:**
```
https://indimasq.bigforge.tech/privacy/
```
(Also served by GitHub Pages at https://harshita1615.github.io/indimasq/privacy/; both come
from `docs/`.)

## Distribution tab

- Visibility: **Public** (or **Unlisted** for a soft launch: only people with the link can install)
- Regions: **All regions**
- Pricing: free

## Submitting an update

The account needs 2-Step Verification, or the upload is rejected.

1. Bump `version` in `extension/manifest.json` and `extension/package.json`.
2. `cd extension && npm test && npm run package`, then upload the new zip under **Package**.
3. Re-read the description against the current code: every claim must be true.
4. Check the privacy URL above opens. The website (`docs/`) deploys to Vercel on every push to
   `main`.
