# Chrome Web Store listing copy

Paste these into the store form.

---

## Common publish blockers (Chrome Web Store)

If publishing is blocked with:

- "A justification for host permission use is required"
- "A justification for offscreen is required"

Go to **Privacy practices** and fill:

- `offscreen justification`
- `Host permission justification`
- `Justification (remote code)` (if the form requires text)

Use the exact copy in the **Privacy practices tab** section below.

Also verify your **Single purpose description** still matches the current build behavior.

---

## Title (from package – keep as is)
**28 Days Habit Tracker**

## Summary (from package – keep as is)
**Lightweight daily habit tracker that runs entirely in your browser.**

---

## Description (paste into "Description" field)

Track daily habits without leaving Chrome. 28 Days Habit Tracker is a minimal extension that lives in your browser toolbar—no accounts, no sync to external servers, no clutter.

**What it does**
• Add habits with one line each (e.g. "Drink water", "Read 10 min", "Exercise")
• Check off each habit for today with a single click
• See your current streak in days for every habit
• View how many habits you’ve completed today at a glance
• Reset today’s checkmarks anytime with one button

**Why use it**
• **Private** – Data stays in your browser using Chrome’s built-in storage. Optionally syncs across your Chrome profile if you use Chrome Sync; no third-party servers.
• **Fast** – Open the popup, tick habits, close. No loading screens or sign-in.
• **Simple** – No categories, tags, or complexity. Just a list and a streak.

**Perfect for** daily goals, mindfulness routines, hydration, reading, exercise, or any small habit you want to build. Install and start tracking in seconds.

---

## Category
**Productivity**

## Language
**English** (or add more if you localize later)

---

## URLs (optional)
- **Homepage URL:** leave empty, or add a GitHub repo / simple landing page if you have one
- **Support URL:** `mailto:allenxavier45@gmail.com` or a GitHub Issues link

---

## Mature content
**No** – select that it does not contain mature content.

---

## Store icon (128×128)
Use: **Habit tracker Extension/icons/icon128.png**  
Upload that file as the store icon.

---

## Screenshots (at least one required)
- **Size:** 1280×800 **or** 640×400
- **Format:** JPEG or 24-bit PNG (no transparency)

**Option A – Real popup**  
1. Open the extension popup (click the icon).  
2. Take a screenshot (e.g. macOS: Cmd+Shift+4, then Space and click the window).  
3. Open the image in Preview, crop if needed, then resize to 1280×800 or 640×400 and export as JPEG or PNG (no alpha).

**Option B – Mockup (looks like store assets)**  
1. Open `store-screenshot.html` in Chrome (from the extension folder).  
2. Make the window 1280×800 (or 640×400), then capture the full window.  
3. Export as JPEG or 24-bit PNG (no alpha).

---

## Promo tiles (optional)
- **Small promo:** 440×280 – optional  
- **Marquee promo:** 1400×560 – optional  

You can skip these; only screenshots and store icon are required.

---

## Privacy practices tab (required to publish)

Paste the following into each field. Then complete **Data usage** and **Privacy policy URL** as described.

### Single purpose description
```
Provide a simple daily habit tracker in the Chrome toolbar. Users can add habits, mark them complete for the current day, and view streak counts. All data stays in the browser.
```

### storage justification
```
The extension needs the "storage" permission to save the user's habit list and daily completion state so that habits and progress persist when the user closes the browser or reopens the extension. Data is stored only in Chrome's built-in extension storage (chrome.storage.sync). No data is sent to any external server.
```

### offscreen justification
```
The extension uses an offscreen document to run background SDK logic that requires a window/DOM context, which is not available in a Manifest V3 service worker. This offscreen context is used only for background runtime tasks and internal status checks; it does not present UI to the user.
```

### host permission justification
```
The extension requests host permissions for https://*.zerogpu.ai/* and https://*.workers.dev/* so the bundled SDK can securely communicate with ZeroGPU orchestration endpoints over HTTPS/WebSocket for model runtime initialization and task handling. These permissions are not used for injecting scripts into websites or reading page content.
```

### Are you using remote code?
Select: **No, I am not using Remote code**

### Justification (remote code)
Leave **empty**, or if the form requires text, paste:
```
This extension does not use remote code. All JavaScript and WebAssembly are included in the extension package (vendor/ folder). There are no dynamic import() calls, no eval(), no new Function(), and no scripts loaded from CDNs or external URLs at runtime.
```

---

### Data usage

**What user data do you plan to collect?**  
Leave **all checkboxes unchecked**. The extension does not collect or transmit user data to the developer or any third party; it only stores habit names and completion dates locally in the browser (Chrome storage).

**Certifications** – check all three:
- ☑ I do not sell or transfer user data to third parties, outside of the approved use cases  
- ☑ I do not use or transfer user data for purposes that are unrelated to my item's single purpose  
- ☑ I do not use or transfer user data to determine creditworthiness or for lending purposes  

---

### Privacy policy URL (required)

The store requires a privacy policy URL. Two options:

**Option A – Host the included policy**  
1. The file `privacy-policy.html` is in your extension folder.  
2. Host it online (e.g. GitHub Pages, Netlify Drop, or a GitHub Gist rendered via a service).  
3. Put that URL in **Privacy policy URL**.

**Option B – Use a Gist**  
1. Go to gist.github.com, sign in.  
2. Create a new gist: paste the content of `privacy-policy.html` (or a short text version).  
3. Use the "Raw" URL, or create a simple page that displays it, and use that URL.

**Example short policy URL** (if you host on GitHub Pages for this repo):  
`https://yourusername.github.io/your-repo-name/privacy-policy.html`

After adding the URL, click **Save Draft** on the Privacy practices tab.
