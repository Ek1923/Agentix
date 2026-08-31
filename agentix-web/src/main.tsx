import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { consumeOAuthRedirect, loadSession } from './core/auth'
import { rememberAccount, takePendingProvider } from './core/auth/accounts'
import { useAuth } from './core/auth/store'
import { features } from './core/features'
import { activeProject } from './core/sync/projects'

/*
  Handle a return from Google or Apple before React exists.

  Order matters twice over. The fragment carries a live access token, so it has to
  be off the URL before anything can record it in history; and the hash router
  reads `location.hash` on mount, so it has to be gone before that read or the
  app boots onto a route made of token fragments.
*/
const oauth = consumeOAuthRedirect()
if (oauth.status === 'signed-in') {
  useAuth.getState().adopt(oauth.session)
  // The provider is read back from what the button noted before redirecting; the
  // fragment itself does not say which one answered.
  rememberAccount(oauth.session, takePendingProvider() ?? 'email', activeProject()?.id ?? null)
}

/*
  A refused sign-in has to land somewhere that can explain it.

  Signing in is no longer a gate, so the app would otherwise open on Home and
  drop the provider's message on the floor. Set here rather than with a navigate
  inside React, because the router reads `location.hash` on mount — a redirect
  after that read would push a second history entry and make Back bounce.
*/
if (features.accounts && oauth.status === 'failed') window.location.hash = '#/signin'

/*
  Open on the sign-in screen when nobody is signed in.
 
  Not a gate — the screen carries a "continue without an account" out of it, and
  every feature but syncing and organisations works from there. It is simply the
  first thing worth offering on a cold start, and offering it is not the same as
  demanding it.
 
  Only when the hash is empty, so a deliberate link to a route still wins.
*/
if (features.accounts && window.location.hash === '' && loadSession() === null) {
  window.location.hash = '#/signin'
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App oauthNotice={oauth.status === 'failed' ? oauth.message : null} />
  </StrictMode>,
)
