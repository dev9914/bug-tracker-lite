# Bug Tracker Lite — Frontend

React + TypeScript single-page app (built with Vite) for the Bug Tracker Lite assignment.
It handles authentication, the bug dashboard and CRUD screens, and the optional
direct-to-S3 image upload.

> For the full project overview, backend setup and deployment, see the
> [root README](../README.md).

## Requirements

- Node.js 22+ (the project pins `engines` to `>=22 <23`, matching the deployed platform)
- A running backend API (default `http://localhost:5000`)

## Setup

```sh
npm install
cp .env.example .env
```

## Environment variables

| Variable | Required | Example | Purpose |
| --- | --- | --- | --- |
| `VITE_API_URL` | yes (production) | `http://localhost:5000` | Base URL of the backend API |

Only `VITE_`-prefixed variables are exposed to the browser, so **never** put secrets or AWS
keys here. In development the app falls back to `http://localhost:5000` when `VITE_API_URL`
is unset; production builds require it and fail fast at startup without it.

### Backend URL configuration

`VITE_API_URL` is read in `src/api/client.ts` and used as the prefix for every request
(e.g. `${VITE_API_URL}/api/bugs`). Vite inlines it **at build time**, so:

- For local development, set it to `http://localhost:5000` (the backend must have
  `FRONTEND_URL` set to this app's origin, e.g. `http://localhost:5173`).
- For a deployed build, set it to the **deployed** backend URL *before* running the build,
  and keep it free of a trailing slash.

## Scripts

```sh
npm run dev      # start the Vite dev server (http://localhost:5173)
npm run build    # tsc -b && vite build  → outputs to dist/
npm run lint     # eslint .
npm run preview  # serve the production build locally
```

Latest known results: `npm run build` exits 0 (48 modules); `npm run lint` exits 0.

## How it works

- **Auth** — `AuthProvider` stores the JWT in `localStorage`; `RequireAuth` guards the
  private routes and redirects signed-out users to `/login`.
- **API client** — `src/api/client.ts` attaches `Authorization: Bearer <token>` and turns a
  `401` into a clean logout.
- **Routes** — `/login`, `/register`, `/dashboard`, `/bugs/new`, `/bugs/:id`,
  `/bugs/:id/edit`.
- **Image upload** — the browser validates the file (JPG/JPEG, PNG, WebP; max 5 MB), requests
  a presigned URL from the API, `PUT`s the raw file bytes straight to S3 with the required
  `Content-Type`, then attaches the returned key to the bug. Image bytes never pass through
  the API, and no S3 URL is stored in the database.
- **Styling** — a single lightweight `src/index.css` (design tokens + component classes);
  no UI framework is used.
