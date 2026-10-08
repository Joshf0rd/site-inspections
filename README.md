# Site Inspections – offline snagging PWA (Version 1)

A personal, offline-first site inspection and snagging app. Data lives only on the device (IndexedDB).
There is no backend, no accounts and nothing that costs money.

## Folder structure

```
site-inspections/
├── index.html              App shell (loads everything)
├── manifest.json           PWA install settings (name, colours, icons)
├── service-worker.js       Offline caching of the app files  ← bump CACHE_VERSION on every update
├── serve.ps1               Local test server for Windows (not needed online)
├── README.md               This file
├── css/
│   └── styles.css
├── icons/
│   ├── icon-192.png        ← replace with your own (192×192 PNG)
│   ├── icon-512.png        ← replace with your own (512×512 PNG)
│   └── apple-touch-icon.png← replace with your own (180×180 PNG, used by iPhone)
└── js/
    ├── lib/jspdf.umd.min.js   jsPDF 2.5.1 (MIT licence) – PDF generation, stored locally for offline use
    ├── utils.js            Dates, image compression, dialogs, file sharing
    ├── db.js               IndexedDB database
    ├── settings.js         Settings screen
    ├── backup.js           Export / import backup
    ├── projects.js         Home + project screens
    ├── visits.js           Site visit screens
    ├── snags.js            Add / edit / close snag, numbering, photos
    ├── reports.js          PDF report
    └── app.js              Router, start-up, service worker registration
```

To replace the icons, overwrite the three PNG files in `icons/` with files of the **same names and sizes**, then bump `CACHE_VERSION`.

---

## 1. Put the project in a folder on Windows

1. Create a folder, e.g. `C:\Users\<you>\Documents\site-inspections`.
2. Copy all of the files above into it, keeping the `css`, `js`, `js\lib` and `icons` subfolders exactly as shown.

## 2. Run it locally

Opening `index.html` by double-clicking **does not work properly**. A `file://` page can't register a
service worker, and browsers restrict local-file pages for security. The app must be served over `http://localhost` or `https://`.

The simplest free server needs nothing installed: use the included `serve.ps1`.

1. Open the project folder in File Explorer.
2. Click the address bar, type `powershell`, and press Enter.
3. Run:
   ```
   powershell -ExecutionPolicy Bypass -File serve.ps1
   ```
4. Open **http://localhost:8080** in Chrome or Edge.
5. Press `Ctrl+C` in the PowerShell window to stop the server.

(Alternatives if you ever install them: VS Code's "Live Server" extension, `npx serve`, or `python -m http.server 8080`.)

On localhost the service worker fetches from the network first, so your edits show up on refresh.
To see the PC layout as a phone, press `F12` in Chrome and click the phone/tablet icon.

You can't usefully test the installed iPhone app from your PC over Wi-Fi. `http://192.168.x.x` is not
"secure", so iPhone won't run the service worker there. Use the hosted version (below) for iPhone testing.

## 3. Hosting for free – recommended: GitHub Pages

| Option | Verdict |
|---|---|
| **GitHub Pages** | **Recommended.** Free and permanent, HTTPS included. Upload by drag-and-drop in the browser (no git needed). Keeps a history of every version of your code. |
| Cloudflare Pages | Also excellent, with drag-and-drop upload. Slightly more setup screens. |
| Netlify | Easy drag-and-drop, but the free tier is now credit-metered. |
| Vercel | Aimed at framework/Node projects. Overkill here. |

Note: free GitHub Pages needs a **public** repository. That makes the *code* public, but **none of your
project data** – that only ever exists on your phone and in your backup files.

### Exact deployment steps

1. Go to https://github.com and sign up for a free account (if you don't have one).
2. Top-right **+** → **New repository**.
   - Repository name: `site-inspections`
   - Visibility: **Public**
   - Leave "Add a README" **unticked**
   - Click **Create repository**.
3. On the next page, click the link **"uploading an existing file"**.
4. In File Explorer, open your project folder, select **everything inside it** (`Ctrl+A`), and drag it onto the
   GitHub upload area. Chrome uploads folders too, so `css`, `js` and `icons` keep their structure.
5. Scroll down and click **Commit changes**. Wait for the upload to finish.
6. Check the repository shows `index.html`, `manifest.json`, `service-worker.js`, and the folders `css`, `icons`, `js` at the top level.
   (`index.html` must be at the top level, not inside another folder.)
7. Go to **Settings** → **Pages** (left menu).
   - Source: **Deploy from a branch**
   - Branch: **main**, folder **/ (root)** → **Save**.
8. Wait 1–3 minutes and refresh the Pages settings screen. It shows your address:
   **`https://<your-username>.github.io/site-inspections/`**
9. Open that address in Chrome on your PC to check it works.

### Updating the app later

1. Edit files locally and test with `serve.ps1`.
2. In `service-worker.js`, increase `CACHE_VERSION` (e.g. `'v1.0.0'` → `'v1.0.1'`), and update
   `APP_VERSION` in `js/app.js` to match.
3. On GitHub: **Add file** → **Upload files** → drag in the changed files. Put files into the matching
   folder: open the `js` folder on GitHub first, then upload JS files there. Or drag the whole project again;
   files with the same name are overwritten. **Commit changes**.
4. Next time you open the app online, an **"A new version is available – Update"** banner appears. Tap Update.

## 4. Install on the iPhone

1. On the iPhone, open **Safari** and go to `https://<your-username>.github.io/site-inspections/`.
2. Tap the **Share** button (square with arrow) → scroll → **Add to Home Screen** → name it (e.g. "Snags") → **Add**.
3. **Open the app from the new Home Screen icon** and leave it open for ~10 seconds while online.
   This caches all the app files for offline use.
4. Open **Settings** (gear icon) and enter your name, job title, company and (optionally) logo.

**From now on, always use the Home Screen icon, not the Safari tab.** On iPhone, the installed app and the
Safari tab have **separate storage**. Snags entered in a Safari tab won't appear in the app.

## 5. Testing on the iPhone

**Offline:** Open the app once online. Then switch on **Airplane Mode**, close the app completely (swipe it
away), and reopen it from the icon. It should open normally. Create a site visit, add a snag with a photo,
close the app, reopen it, and check the snag is still there. Generate a report while still offline.

**Photo capture:** In a snag, tap **Take Photo / Add Photo**. iPhone offers *Take Photo*, *Photo Library*
or *Choose File*. Take a photo, then add two more (from the library). Tap a thumbnail to view, replace
or delete it. Note: photos taken *through the app* are not saved to your iPhone Photos – they live in the app.

**PDF:** On a site visit, tap **Generate Report** → choose All / Open / Closed → **Generate PDF** →
**Share / Save**. Choose *Save to Files* (or Mail, WhatsApp, etc.). Open the PDF and check the photos,
page breaks and page numbers.

**Backup and restore:** Settings → **Export backup** → Share / Save → *Save to Files* → iCloud Drive or
OneDrive. Then (in a test) delete a project, go to Settings → **Import backup…**, choose the file, type
`REPLACE`, and confirm. The project should be back with its photos.

---

## iPhone PWA limitations (know these)

1. **Storage is per-device and per-app.** Deleting the Home Screen icon (or "Clear History and Website Data" in Safari settings) can delete all app data. **Export backups regularly** – the app reminds you after 7 days.
2. **Safari tab ≠ Home Screen app** – separate storage (see above).
3. Safari may delete data of *websites* not used for 7 days. Home Screen apps are exempt from that rule,
   and the app also asks the browser to keep its storage persistent. Backups are still your real safety net.
4. **Saving files** (PDF, backup) goes through the iPhone Share sheet → *Save to Files*. There is no silent "download to folder".
5. **No camera viewfinder inside the app**. The standard iPhone picker (Take Photo / Library) is used. It's the reliable route.
6. **Unsaved form data**: if iOS closes the app in the background (e.g. you take a long call), an *unsaved* snag form may be lost. Save each snag as you go.
7. **Dictation** uses the iPhone keyboard microphone. On recent iPhones it works offline; older models may need a connection.
8. **Updates** only arrive when you open the app online. The banner then asks you to tap Update.

## Design decisions

- **Photos** are resized to max **1600 px** on the long edge, JPEG quality **0.75** (≈200–400 KB per
  photo instead of 3–6 MB). At 180 mm wide in the PDF that is ≈225 dpi – sharp in print.
  A 240 px thumbnail is stored separately so lists load fast.
- **Up to 6 photos per snag.** Photos added while a snag is Closed can be marked as *close-out photos* and are labelled as such in the PDF.
- **Numbering:** each site visit remembers the highest number issued per prefix (E, M, S, C, A, G;
  custom categories use their first letter). Deleted numbers are never reused. You can type a number
  manually; the counter moves past it.
- **Dates:** visit dates are stored as plain `YYYY-MM-DD` text, never converted through time zones.
- **Safety:** saving a snag, deleting a project, and restoring a backup each run as one database transaction –
  it either fully succeeds or changes nothing. Imports are validated before anything is touched.
  Deleting a project and importing a backup need a typed confirmation word.
- **External dependency:** only **jsPDF 2.5.1** (MIT licence, widely used), stored in `js/lib` so PDFs work offline.

---

## Testing checklist

- [ ] Settings: name, job title, company saved
- [ ] Settings: logo uploaded (and appears in PDF header)
- [ ] Create project
- [ ] Edit project
- [ ] Search projects (appears once you have 4+ projects)
- [ ] Create site visit (date shows as e.g. "7 October 2026")
- [ ] Edit site visit
- [ ] Add snag
- [ ] Snag automatically numbered (E-001, E-002…)
- [ ] Change category → number switches prefix (e.g. M-001)
- [ ] Delete a snag → next number is NOT reused
- [ ] Take photo with camera
- [ ] Add photo from library
- [ ] Add multiple photos (3+)
- [ ] View / replace / delete a photo
- [ ] Dictate into Observation with the keyboard microphone
- [ ] Edit snag
- [ ] Close snag (status → Closed)
- [ ] Add close-out photo
- [ ] Filter All / Open / Closed
- [ ] Sort by number / newest / oldest
- [ ] Counters (Total / Open / Closed) correct
- [ ] Leave a form with unsaved changes → warning appears
- [ ] Generate PDF – All snags
- [ ] Generate PDF – Open only / Closed only
- [ ] PDF displays photos properly (aspect ratio, no overlap)
- [ ] PDF page numbers, dates and file name correct
- [ ] Save PDF to Files / share by email
- [ ] Export backup and save to iCloud Drive / OneDrive
- [ ] Delete data (delete a project)
- [ ] Import backup (type REPLACE)
- [ ] Data restores correctly (snags, photos, settings)
- [ ] Import a non-backup file → rejected, nothing changed
- [ ] Install to iPhone Home Screen
- [ ] Launch in standalone mode (no Safari address bar)
- [ ] Disconnect internet (Airplane Mode)
- [ ] Open app offline
- [ ] Add snag offline (with photo)
- [ ] Restart app (swipe away, reopen)
- [ ] Confirm offline data remains
- [ ] Generate report offline
- [ ] Deploy an update (bump CACHE_VERSION) → Update banner appears
