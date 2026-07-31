# Brand & ops setup

Two jobs that need a dashboard and a DNS record, not a deploy:

1. Serving Supabase auth from `api.podarticle.com`, so Google's consent screen says
   PodArticle instead of `agmajezadtqkrnuwlmyk.supabase.co`.
2. Getting a `@podarticle.com` support mailbox so the site can stop pointing at Gmail.

Both are written so the code change is the *last* step. Nothing here breaks the live site
until the final swap, and each swap is one line.

Reference values used throughout:

| Thing | Value |
| --- | --- |
| Production domain | `podarticle.com` (nameservers on Vercel) |
| Supabase project ref | `agmajezadtqkrnuwlmyk` |
| Target auth host | `api.podarticle.com` |
| Target support address | `support@podarticle.com` |

---

## 1. Supabase custom domain → `api.podarticle.com`

Custom domains are a Supabase Pro feature and are billed as an add-on (about $10/month
per domain). The project is already on Pro.

**Status:** the domain is active in Supabase and the code is flipped. The one step still
outstanding is **1d** — adding the new callback URI in Google. Until that is done, Google
sign-in will fail once this deploys.

| Step | State |
| --- | --- |
| 1a Start the domain in Supabase | done |
| 1b Add the DNS records on Vercel | done |
| 1c Verify | done — domain shows active/green |
| 1d Point Google OAuth at the new callback | **outstanding — do before merging** |
| 1e Check the Supabase redirect allow-list | unchanged by the custom domain |
| 1f Flip the code | done |
| 1g Confirm, then clean up | after deploy |

### 1a. Start the domain in Supabase — done

Dashboard → project `agmajezadtqkrnuwlmyk` → **Settings → General → Custom Domains** →
enter `api.podarticle.com` and start verification.

Supabase gives back two things to create in DNS:

- a `CNAME` for `api` pointing at `agmajezadtqkrnuwlmyk.supabase.co`
- one or more `TXT` records proving ownership (the exact names and values are generated
  per project — copy them from the dashboard, they are not guessable)

### 1b. Add the DNS records on Vercel — done

Vercel dashboard → **Domains → podarticle.com → DNS**. Add exactly what Supabase showed:

| Type | Name | Value |
| --- | --- | --- |
| CNAME | `api` | `agmajezadtqkrnuwlmyk.supabase.co` |
| TXT | *(as shown by Supabase)* | *(as shown by Supabase)* |

Leave the TTL at the default. Do not proxy or redirect `api` anywhere else.

### 1c. Verify — done

Back in Supabase, press **Verify**. It can take anywhere from a few minutes to a couple of
hours for DNS to propagate; re-press rather than re-creating the records.

Check from a terminal:

```sh
dig +short api.podarticle.com
curl -sI https://api.podarticle.com/auth/v1/health
```

Do not continue until the `curl` returns a certificate that is valid for
`api.podarticle.com` and a 200.

### 1d. Point Google OAuth at the new callback — outstanding

This is the remaining blocker. The code in `public/auth.js` now sends readers to
`api.podarticle.com`, so Google must recognise that host's callback or every sign-in
fails with `redirect_uri_mismatch`.

Google Cloud Console → **APIs & Services → Credentials** → the OAuth 2.0 Client ID that
PodArticle uses → **Authorized redirect URIs**.

**Add** (do not remove the old one yet):

```
https://api.podarticle.com/auth/v1/callback
```

The existing `https://agmajezadtqkrnuwlmyk.supabase.co/auth/v1/callback` stays until the
switch has been live for a few days. Google changes can take a few minutes to apply.

While you are here, the consent screen's **App name**, **support email** and **App domain**
are what users actually read — set them to PodArticle, the support address from part 2,
and `podarticle.com`.

### 1e. Check the Supabase redirect allow-list

Supabase → **Authentication → URL Configuration**:

- **Site URL**: `https://podarticle.com`
- **Redirect URLs** must include `https://podarticle.com/**`

Sign-in sends the reader back to the exact page they started on
(`redirectTo: window.location.href` in `public/auth.js`), so the wildcard matters —
without it, signing in from `/episode.html?v=…` fails while the homepage works.

### 1f. Flip the code — done

`public/auth.js` now reads:

```js
const SUPABASE_URL = 'https://api.podarticle.com';
```

The anon key does not change.

That is the only browser-side reference. The server (`lib/auth.js`, `lib/db.js`,
`api/portal.js`, `api/stripe-webhook.js`) reads `process.env.SUPABASE_URL` and hardcodes
nothing, so it needs no code change. The `SUPABASE_URL` env var on Vercel can stay on
`agmajezadtqkrnuwlmyk.supabase.co` or move to `api.podarticle.com` — Supabase serves both
hosts and the service-role key is valid for either. Staying put is the smaller change; the
custom domain matters only where a reader can see the host.

### 1g. Confirm, then clean up

Sign out and sign back in on production. The Google screen should now name
`api.podarticle.com`. Test from the homepage *and* from an episode page, since those take
different redirect paths.

After a few days with no sign-in complaints, the old
`agmajezadtqkrnuwlmyk.supabase.co/auth/v1/callback` URI can come out of Google.

**If sign-in breaks:** revert `SUPABASE_URL` to
`https://agmajezadtqkrnuwlmyk.supabase.co` and redeploy. Supabase keeps serving the
original host after a custom domain is added, so the rollback is immediate.

---

## 2. `@podarticle.com` support email

**Status:** done. ImprovMX forwarding is live and the site now shows
`support@podarticle.com` everywhere. The alias is a wildcard (`*@podarticle.com` → the
Gmail inbox), so any address on the domain already works and changing which one the site
advertises needs no DNS change. Replies still need the Gmail "Send mail as" identity
described below to go out on-brand.

The steps below are kept as the record of how it was set up, and for whoever moves this
to a real mailbox later.

### Option A — ImprovMX forwarding (free, ~10 minutes) — recommended to start

Forwarding only: mail sent to `support@podarticle.com` lands in the existing Gmail inbox.
Free tier covers unlimited aliases on one domain.

1. Sign up at improvmx.com and add `podarticle.com`.
2. Add the two MX records it gives you in Vercel DNS (**Domains → podarticle.com → DNS**):

   | Type | Name | Priority | Value |
   | --- | --- | --- | --- |
   | MX | `@` | 10 | `mx1.improvmx.com` |
   | MX | `@` | 20 | `mx2.improvmx.com` |

3. Create a wildcard alias `*@` forwarding to the Gmail address, so every address on the
   domain resolves and the site can advertise whichever one it wants.
4. Send a test message to `support@podarticle.com` and confirm it arrives.

Replying still comes *from* Gmail unless you also add the address as a Gmail "Send mail
as" identity — worth doing, since a reply from the Gmail address undoes the point.
ImprovMX documents the SMTP settings for that.

### Option B — Google Workspace ($7-ish/user/month)

A real mailbox rather than forwarding: proper sending, no reply-address workaround,
Drive and Docs on the domain. Worth it if PodArticle starts sending anything transactional
or if the Gmail workaround gets annoying. Setup is Google's guided flow — it writes the
MX records for you and verifies the domain.

**Recommendation:** Option A now, Option B when there is a reason to pay for it.
Moving from A to B later is just replacing the MX records.

### Then swap the strings — done

The address was swapped across:

- `public/messages.js` — `SUPPORT_EMAIL`, the address used by every error message
- `public/index.html`, `public/pricing.html`, `public/episode.html` — footer
  "For creators" / "Contact" links, plus the support question in the pricing FAQ
- `public/episodes/jared-isaacman-moon-base.html` — the one seed page with its own
  footer links

`SUPPORT_EMAIL` is the single source for the error-message surfaces; the mailto: links in
the static footers are literal and have to be changed by hand alongside it.

The Gmail address stays live rather than being retired — old pages stay in Google's index,
and people mail addresses they saw months ago.
