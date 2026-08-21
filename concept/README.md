# FireOps Mobile v1.7 — Workflow Edition

Prototype Expo/React Native build for testing on iPhone, Android, and Mac simulators.

## New in v1.7

- Dedicated Invoices app with overview, branded PDF builder, invoice upload workflow, status tracking, and QuickBooks-ready actions.
- Marketplace message buttons for seller conversations.
- Inventory checkout and employee assignment tracking with an accountability-report preview.
- Contractor and employee dashboard experiences in one application.
- Employee assignments appear on the employee dashboard; contractor dashboard focuses on company operations.
- FireOps Assistant moved from the bottom tab bar to a floating button available throughout the app.
- Push-notification preferences added to Settings for Communications and Marketplace messages.
- More-screen feature controls remain in Settings.
- Compact high-resolution logo header and safer top/back-button spacing.
- Existing iPhone-style long-press and drag icon customization remains enabled.

## Run on a Mac

```bash
cd ~/Desktop/FireOps-Mobile-v1.7-work
npm install
npx expo start
```

Press `i` to launch the iPhone Simulator, or scan the QR code with Expo Go.

## Prototype note

This build uses local and demonstration data. Real push delivery, cloud accounts, PDF file output, OCR, QuickBooks synchronization, messaging, printing, and role enforcement require the production backend and native service configuration.

## Put this project on GitHub

Keep the repository private while it contains prototype business logic.

```bash
cd ~/Desktop/FireOps-GitHub-Ready
./setup-github.sh fireops-mobile private
```

The script initializes Git, creates the first commit, creates a private GitHub repository, adds `origin`, and pushes `main`.
