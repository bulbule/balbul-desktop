# balBul Web

Static frontend for balBul, deployed from this folder with GitHub Pages.

## Included
- Email/password sign-up, email confirmation redirect, sign-in, password reset email
- Profile display and friend code
- Friend requests and accepted friends
- Direct conversations and realtime message inserts

## Supabase setup
1. Keep Email provider and email confirmations enabled in Supabase Auth.
2. In Auth > URL Configuration, set the Site URL to the published Pages URL and add it to Redirect URLs.
3. For local development, add `http://localhost:5500/**` to Redirect URLs.
4. Keep the publishable key in `config.js`; never add a secret or service_role key.
5. GitHub repository Settings > Pages > Build and deployment: select GitHub Actions.

The web app only uses the public publishable key. Authorization is enforced by database RLS.
