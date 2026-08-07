'use client';

const ZIP_URL = 'https://github.com/Optinet-Solutions-AI/OptiPass/archive/refs/heads/main.zip';
const REPO_URL = 'https://github.com/Optinet-Solutions-AI/OptiPass.git';

export default function SetupGuide({ onContinue }) {
  return (
    <div className="screen" style={{ maxWidth: 560 }}>
      <div className="brand">
        <div className="brand-logo">O</div>
        <h1>Your account is ready 🎉</h1>
        <p className="muted">
          One more thing: install the OptiPass Chrome extension. It fills logins on websites,
          copies 2FA codes, and keeps watching your tools&apos; credits — this website is the
          companion, the extension is the daily driver.
        </p>
      </div>

      <section>
        <h3>Step 1 — Download the extension</h3>
        <p className="muted">
          Click the button below — the download starts immediately and is always the latest
          version.
        </p>
        <a className="btn primary full" href={ZIP_URL} style={{ textDecoration: 'none' }}>
          Download OptiPass for Chrome (.zip)
        </a>
        <p className="muted" style={{ marginTop: 10 }}>
          Comfortable with git? <code>git clone {REPO_URL}</code> instead — then future updates
          apply automatically after a <code>git pull</code>.
        </p>
      </section>

      <section>
        <h3>Step 2 — Extract the folder</h3>
        <p className="muted">
          Find <strong>OptiPass-main.zip</strong> in your Downloads, right-click it →{' '}
          <strong>Extract All…</strong> and extract it somewhere permanent, e.g.{' '}
          <code>Documents\OptiPass</code>. The extension runs from this folder, so don&apos;t
          delete or move it afterwards.
        </p>
      </section>

      <section>
        <h3>Step 3 — Load it into Chrome</h3>
        <ol className="muted" style={{ marginLeft: 18, lineHeight: 1.9 }}>
          <li>
            Open a new tab and go to <strong><code>chrome://extensions</code></strong> (type it in
            the address bar — Chrome doesn&apos;t allow linking there)
          </li>
          <li>Turn ON <strong>Developer mode</strong> — the toggle in the top-right corner</li>
          <li>Click <strong>Load unpacked</strong> (top-left)</li>
          <li>
            Select the extracted folder — the one named <strong>OptiPass-main</strong> that
            contains <code>manifest.json</code>
          </li>
        </ol>
      </section>

      <section>
        <h3>Step 4 — Pin it</h3>
        <p className="muted">
          Click the puzzle-piece 🧩 icon in Chrome&apos;s toolbar and press the 📌 pin next to
          OptiPass, so the padlock is always one click away.
        </p>
      </section>

      <section>
        <h3>Step 5 — Sign in</h3>
        <ol className="muted" style={{ marginLeft: 18, lineHeight: 1.9 }}>
          <li>Click the OptiPass icon in the toolbar</li>
          <li>Sign in with the <strong>same email and account password</strong> you just created</li>
          <li>Enter your <strong>master password</strong> to unlock your vault</li>
          <li>Set a <strong>6-digit PIN</strong> when offered — it&apos;s your everyday unlock</li>
          <li>A short interactive tour will show you around</li>
        </ol>
      </section>

      <section>
        <h3>Good to know</h3>
        <p className="muted">
          <strong>Updates:</strong> git users get them automatically after a pull; zip users
          re-download this zip and replace the folder&apos;s contents (OptiPass notices and reloads
          itself). <strong>Filling logins:</strong> on any login page, right-click the username
          field → <em>OptiPass – fill login</em>. <strong>Never share</strong> your master
          password — it can&apos;t be recovered, so store it somewhere safe.
        </p>
      </section>

      <button className="btn full" onClick={onContinue}>
        Done — take me to my vault
      </button>
    </div>
  );
}
