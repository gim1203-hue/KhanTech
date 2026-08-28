# KhanTech

KhanTech is a private, no-API-key progressive web app for live OpenStreetMap location, permission-authorized Bluetooth devices, camera capture, audio/video recording, local playback history, Google search, and device-native voice commands.

## Open in VS Code

1. Extract the source ZIP.
2. Open the extracted folder in VS Code.
3. Open **Terminal → New Terminal**.
4. Run `npm install`.
5. Run `npm run dev`.
6. Open `http://localhost:3000`.

## Publish on GitHub

1. Create an empty GitHub repository.
2. In the VS Code terminal, run `git init`, `git add .`, and `git commit -m "Initial KhanTech app"`.
3. Add the repository URL shown by GitHub and push the `main` branch.
4. Deploy with any host that supports Next.js or Cloudflare-compatible workers.

## Main files

- `app/page.tsx` — React/TypeScript interface and live features
- `app/globals.css` — responsive CSS, map, camera, and recording design
- `app/recordings.ts` — IndexedDB recording history and 24-hour retention
- `app/layout.tsx` — HTML metadata and installable-app configuration
- `app/api/read/route.ts` — public-page reader retained for future commands
- `public/manifest.webmanifest` — phone installation manifest
- `public/sw.js` — offline-capable service worker
- `public/og.png` — KhanTech social preview

## Privacy and platform limits

KhanTech requests camera, microphone, location, and Bluetooth access only after a user action. It does not access cellular-carrier subscriber lists or silently enumerate private devices. Bluetooth devices without shared GPS coordinates are listed but never assigned fabricated map locations. Browser recording continues only while the browser permits it; uninterrupted background recording requires a native Android implementation.
