'use client';

import { CHROME_STORE_URL } from '@/lib/config';

const ZIP_URL = 'https://github.com/Optinet-Solutions-AI/OptiPass/archive/refs/heads/main.zip';
const REPO_URL = 'https://github.com/Optinet-Solutions-AI/OptiPass.git';

// Download, extract, Load unpacked - the only way until the Chrome Web Store
// listing exists, and the fallback afterwards. `first` = step number to start at.
function ZipSteps({ first }) {
  return (
    <>
      <section>
        <h3>Step {first} — Download the extension</h3>
        <p className="muted">
          Click the button below — the download starts immediately and is always the latest
          version.
        </p>
        <a className={`btn${CHROME_STORE_URL ? '' : ' primary'} full`} href={ZIP_URL} style={{ textDecoration: 'none' }}>
          Download OptiPass for Chrome (.zip)
        </a>
        <p className="muted" style={{ marginTop: 10 }}>
          Comfortable with git? <code>git clone {REPO_URL}</code> instead — then future updates
          apply automatically after a <code>git pull</code>.
        </p>
      </section>

      <section>
        <h3>Step {first + 1} — Extract the folder</h3>
        <p className="muted">
          Find <strong>OptiPass-main.zip</strong> in your Downloads, right-click it →{' '}
          <strong>Extract All…</strong> and extract it somewhere permanent, e.g.{' '}
          <code>Documents</code>. The extension runs from this folder, so don&apos;t delete or
          move it afterwards.
        </p>
        <p className="muted" style={{ marginTop: 8 }}>
          ⚠️ <strong>Windows puts a folder inside a folder</strong>: extracting usually creates{' '}
          <code>OptiPass-main\OptiPass-main\…</code>. Open the folders until you can see the file{' '}
          <strong><code>manifest.json</code></strong> — <em>that</em> folder is the one you&apos;ll
          select in the next step.
        </p>
      </section>

      <section>
        <h3>Step {first + 2} — Load it into Chrome</h3>
        <ol className="muted" style={{ marginLeft: 18, lineHeight: 1.9 }}>
          <li>
            Open a new tab and go to <strong><code>chrome://extensions</code></strong> (type it in
            the address bar — Chrome doesn&apos;t allow linking there)
          </li>
          <li>Turn ON <strong>Developer mode</strong> — the toggle in the top-right corner</li>
          <li>Click <strong>Load unpacked</strong> (top-left)</li>
          <li>
            Chrome&apos;s folder picker shows <strong>folders only</strong> (you won&apos;t see{' '}
            <code>manifest.json</code> there). Open the extracted folders until you see the folders{' '}
            <code>icons</code>, <code>lib</code> and <code>popup</code>, then click{' '}
            <strong>Select Folder</strong> without opening any of them
          </li>
          <li>
            If Chrome says <em>&quot;Manifest file is missing&quot;</em>, you selected the outer
            wrapper folder — go one level deeper and try again
          </li>
        </ol>
        <p className="muted" style={{ marginTop: 8 }}>
          <strong>Updates:</strong> zip installs don&apos;t update themselves. When OptiPass shows
          &quot;a new version is available&quot;, download this zip again and copy its files over the
          same folder (OptiPass then reloads itself); git users just run <code>git pull</code>.
        </p>
      </section>
    </>
  );
}

export default function SetupGuide({ onContinue }) {
  const store = !!CHROME_STORE_URL;
  const pinStep = store ? 2 : 4;
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

      {store ? (
        <section>
          <h3>Step 1 — Add OptiPass to Chrome</h3>
          <p className="muted">
            Open OptiPass in the Chrome Web Store and click <strong>Add to Chrome</strong>, then{' '}
            <strong>Add extension</strong>. Use Chrome signed in with your{' '}
            <strong>@optinetsolutions.com</strong> Google account — the listing is only visible to
            our company. Chrome keeps OptiPass up to date by itself.
          </p>
          <a className="btn primary full" href={CHROME_STORE_URL} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none' }}>
            Open OptiPass in the Chrome Web Store
          </a>
        </section>
      ) : (
        <ZipSteps first={1} />
      )}

      <section>
        <h3>Step {pinStep} — Pin it</h3>
        <p className="muted">
          Click the puzzle-piece 🧩 icon in Chrome&apos;s toolbar and press the 📌 pin next to
          OptiPass, so the padlock is always one click away.
        </p>
      </section>

      <section>
        <h3>Step {pinStep + 1} — Sign in</h3>
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
          {store ? (
            <>
              <strong>Updates</strong> install automatically from the Chrome Web Store.{' '}
            </>
          ) : null}
          <strong>Filling logins:</strong> on any login page, right-click the username
          field → <em>OptiPass – fill login</em>. <strong>Never share</strong> your master
          password — it can&apos;t be recovered, so store it somewhere safe.
        </p>
      </section>

      {store && (
        <details className="setup-fallback">
          <summary>Can&apos;t use the Chrome Web Store? Install from the zip instead</summary>
          <ZipSteps first={1} />
        </details>
      )}

      <button className="btn full" onClick={onContinue}>
        Done — take me to my vault
      </button>
    </div>
  );
}
