# Viana 2.0 – login version

## Files to upload (all into the root of your GitHub repo)
- `index.html` – the app (opens on the Sign in / Create account page)
- `firebase-config.js` – Firebase settings (leave as `null` for local mode)
- `firestore.rules` – security rules to paste into Firebase (not used by GitHub)
- `.nojekyll` – empty file so GitHub Pages serves files as-is
- `README.md` – this file

## Replace the old version on GitHub
1. Open your repo → **Add file** → **Upload files**.
2. Drag in `index.html` and `.nojekyll` (keep your existing `firebase-config.js` if you already pasted your Firebase details into it).
3. **Commit changes**. Wait 1–2 minutes, then open your site and press Ctrl + F5.
4. Check: the page should open on **Sign in / Create account**. View the page source – it contains `viana-version" content="2.0-login"`.

## Logins
- Admin: `ADMIN` / `2409` (sees the Admin tab; can open, edit and delete any user's data).
- Users create their own username and password on **Create account**.

## Turning on Firebase (cloud mode)
1. Firebase console → **Authentication** → Sign-in method → enable **Email/Password**.
2. **Firestore Database** → create database → **Rules** tab → paste `firestore.rules` → **Publish**.
3. **Authentication → Settings → Authorized domains** → add `yourname.github.io`.
4. Project settings → Your apps → Web app → copy the `firebaseConfig` values into `firebase-config.js` (replace `null`). Commit.
5. Sign in once as `ADMIN` / `2409` – this creates the admin login in Firebase.

Notes: usernames become `username@viana.app` logins in Firebase. Data from local mode does not move automatically – use Settings → Download backup / Restore backup.
