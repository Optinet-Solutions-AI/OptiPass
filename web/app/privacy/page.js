export const metadata = {
  title: 'OptiPass - Privacy policy',
  description: 'What the OptiPass extension and web app store, and why.',
};

// Linked from the Chrome Web Store listing. Plain server-rendered page:
// readable without signing in.
export default function Privacy() {
  return (
    <main className="screen privacy" style={{ maxWidth: 720 }}>
      <h1>OptiPass privacy policy</h1>
      <p className="muted">Last updated 13 October 2026</p>

      <p>
        OptiPass is the internal password manager of Optinet Solutions. It is made of a Chrome extension and a web
        app (opti-pass.vercel.app) and is only for Optinet Solutions staff with an account created by an OptiPass
        admin.
      </p>

      <h2>End-to-end encryption</h2>
      <p>
        Everything you store in a vault (tool names, links, usernames, passwords, 2FA secrets, API keys, payment requests, notes) is
        encrypted on your device with keys protected by your master password before it is sent to our server. The
        server only ever holds the encrypted data. Nobody at Optinet Solutions, and not our hosting providers, can
        read it. Your master password never leaves your device.
      </p>

      <h2>What the server stores</h2>
      <ul>
        <li>Your account: email address, display name, role, status and theme setting.</li>
        <li>Your encrypted vault data and encrypted vault keys, plus which team vaults you belong to.</li>
        <li>
          Credit monitors you or your team set up: the monitor&apos;s name, the dashboard address, the latest reading
          and when it was taken. Monitor API keys are encrypted like vault data.
        </li>
        <li>An activity log (for example &quot;tool updated&quot;, &quot;member added&quot;) that admins can read.</li>
      </ul>

      <h2>What stays in your browser</h2>
      <p>
        Your sign-in session, settings and, while the vault is unlocked, the decryption keys (kept in session
        storage and cleared when OptiPass locks). If you set a PIN, an encrypted copy of your keys is kept in the
        extension&apos;s local storage.
      </p>

      <h2>Why the extension needs its permissions</h2>
      <ul>
        <li><strong>activeTab, scripting, tabs</strong> - to see which site you are on, fill a login there when you ask, and read a credit value from a dashboard you have open.</li>
        <li><strong>Access to sites (asked for when needed)</strong> - the same, when OptiPass is opened in its own window.</li>
        <li><strong>contextMenus</strong> - the right-click &quot;OptiPass - fill login&quot; option.</li>
        <li><strong>clipboardWrite</strong> - the Copy buttons for usernames, passwords and 2FA codes.</li>
        <li><strong>clipboardRead, offscreen</strong> - about 30 seconds after you copy a password or code, a hidden helper page checks whether the clipboard still holds it and, if so, empties it. Nothing else on the clipboard is kept or sent anywhere.</li>
        <li><strong>alarms</strong> - auto-lock, clearing copied passwords after 30 seconds, and refreshing the LOW-credit badge.</li>
        <li><strong>storage</strong> - your session, settings and encrypted keys, as described above.</li>
      </ul>

      <h2>What we don&apos;t do</h2>
      <p>
        No advertising, no analytics or tracking, no selling or sharing of data. Page contents are only read when
        you use fill or a credit monitor on that page, and are not sent anywhere except the monitor reading itself.
      </p>

      <h2>Where the data is</h2>
      <p>
        The database and sign-in service are hosted by Supabase; the web app is hosted by Vercel. Both only receive
        what is listed above.
      </p>

      <h2>Your choices</h2>
      <p>
        An OptiPass admin can disable your account, and the OptiPass super admin can delete it, which removes your
        sign-in and profile. For questions or removal requests, contact your OptiPass admin at Optinet
        Solutions.
      </p>
    </main>
  );
}
