# Biken

Biken has two independently deployable Vercel sites:

- The public ride-booking website in [`booking/`](./booking/).
- The private ride-operations dashboard in [`admin/`](./admin/).

Both sites use one Supabase database. Google Apps Script is used only to send
booking notifications and confirmed-ride details; it no longer manages the
request workflow. The existing Google Sheet can be kept as an archive, or
exported and imported into Supabase.

## Supabase setup

1. Create or select a Supabase project.
2. Open **SQL Editor**, run [`supabase/schema.sql`](./supabase/schema.sql), and
   confirm that `ride_requests`, `admin_users`, and `admin_sessions` exist.
3. Copy the project URL and the `service_role` key. The service-role key must
   only be set as a server environment variable; never put it in browser code.

## Email notifications

The existing Google Apps Script is retained as the email sender.

1. Open the existing Apps Script project and replace its code with
   [`apps-script/Code.gs`](./apps-script/Code.gs).
2. Run `setup()` once and copy the `SHARED_SECRET` from the execution log.
3. Deploy a new **Web app** version, set **Execute as** to **Me**, and set
   access to **Anyone**. The endpoint accepts only requests carrying the shared
   secret, so keep that secret private.
4. After deploying the admin site, set the Apps Script project property
   `ADMIN_URL` to the dashboard's Vercel URL. The existing team notification
   addresses are `h.bello@alustudent.com` and `t.oteniya@alustudent.com`.

The Apps Script sender uses the Google account that owns its deployment and its
daily email quota. The `setup()` function removes the old spreadsheet edit
trigger; new bookings and ride status updates are handled in the admin site.

## Create admin accounts

Create a separate account for each team member. From the `admin/` folder, set
these environment variables locally (do not commit them) and run
`npm run create-admin`:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `ADMIN_EMAIL`
- `ADMIN_NAME`
- `ADMIN_PASSWORD` (at least 12 characters)

Repeat with the other team member's email and a different strong password.
The script stores a bcrypt password hash and refuses to overwrite an existing
account.

## Deploy the two Vercel sites

Import this repository twice in Vercel and set different **Root Directory**
values:

| Vercel project | Root Directory | Result |
|---|---|---|
| Biken booking | `booking` | Public booking website and `/api/requests` |
| Biken admin | `admin` | Admin sign-in, dashboard, and request management |

For **each** project, set these server-side environment variables:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `APPS_SCRIPT_URL` (the deployed Apps Script `/exec` URL)
- `SHARED_SECRET` (the value created by `setup()`)

Deploy both projects, create the admin accounts, and then set the Apps Script
`ADMIN_URL` property to the deployed admin URL. The root-level files are kept
as the original public website entry point and use the same Supabase request
flow if deployed directly.

## Import existing spreadsheet records

Export the old Requests tab as a CSV file. From the `admin/` folder, set
`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` locally and run:

```powershell
npm run import-requests -- "C:\path\to\requests.csv"
```

The importer validates every row before writing anything, keeps existing
request IDs, and upserts in batches so re-running the import does not duplicate
requests. It accepts the existing sheet's column order or recognized header
names. Keep the exported CSV out of Git because it contains personal
information. Requests added after export should be imported again if the
archive is still being used during cutover.

## Ride request lifecycle

Customers submit a request from the booking site. It is stored in Supabase with
status **New**. Coordinators sign in to the separate admin site to search and
filter requests, assign a rider, set the agreed fare, add notes, and update
status. A coordinator can send or resend confirmed ride details from the
request details dialog once a rider and fare are set.
