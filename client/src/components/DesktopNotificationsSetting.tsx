import { useState } from 'react';
import { el } from '../i18n/el.js';
import { ApiRequestError } from '../lib/api.js';
import {
  disableDesktopNotifications,
  enableDesktopNotifications,
  isIosOutsidePwa,
  sendTestNotification,
  useDesktopNotificationState,
} from '../lib/push.js';
import { Icon } from './Icon.js';

/**
 * Διακόπτης ειδοποιήσεων επιφάνειας εργασίας στις «Ρυθμίσεις μου». Είναι ρύθμιση ανά συσκευή
 * (η συνδρομή push ανήκει στον browser), όχι ανά λογαριασμό — γι' αυτό δεν ζει στο
 * SessionUser αλλά διαβάζεται κάθε φορά από τον ίδιο τον browser.
 */
export function DesktopNotificationsSetting() {
  const [state, setState] = useDesktopNotificationState();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'info' | 'error'; text: string } | null>(null);

  const on = state === 'on';
  const blocked = state === 'denied' || state === 'unsupported';

  async function toggle() {
    setBusy(true);
    setMessage(null);
    try {
      setState(on ? await disableDesktopNotifications() : await enableDesktopNotifications());
    } catch (err) {
      const unavailable = err instanceof ApiRequestError && err.status === 503;
      setMessage({ kind: 'error', text: unavailable ? el.desktopNotifications.unavailable : el.desktopNotifications.failed });
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    setMessage(null);
    try {
      const delivered = await sendTestNotification();
      setMessage(
        delivered > 0
          ? { kind: 'info', text: el.desktopNotifications.testSent }
          : { kind: 'error', text: el.desktopNotifications.testNone },
      );
    } catch {
      setMessage({ kind: 'error', text: el.desktopNotifications.failed });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="field desktop-notifications">
      <div className="spread" style={{ gap: '1rem', alignItems: 'flex-start' }}>
        <div>
          <label htmlFor="desktop-notifications">{el.desktopNotifications.title}</label>
          <div className="muted" style={{ fontSize: '0.85em' }}>
            {el.desktopNotifications.description}
          </div>
        </div>
        <button
          id="desktop-notifications"
          type="button"
          role="switch"
          aria-checked={on}
          className="switch"
          disabled={busy || state === null || blocked}
          onClick={() => void toggle()}
        >
          <span className="switch-thumb" />
        </button>
      </div>

      <div className="row" style={{ marginTop: '0.5rem', flexWrap: 'wrap' }}>
        {state === 'on' && <span className="badge success">{el.desktopNotifications.on}</span>}
        {state === 'off' && <span className="badge">{el.desktopNotifications.off}</span>}
        {busy && <span className="muted">{el.desktopNotifications.working}</span>}
        {on && (
          <button type="button" className="ghost icon-btn" onClick={() => void test()} disabled={busy}>
            <Icon name="bell" size={14} />
            {el.desktopNotifications.test}
          </button>
        )}
      </div>

      {state === 'denied' && <div className="field-error">{el.desktopNotifications.denied}</div>}
      {state === 'unsupported' && (
        <div className="muted" style={{ fontSize: '0.85em', marginTop: '0.25rem' }}>
          {isIosOutsidePwa() ? el.desktopNotifications.iosHint : el.desktopNotifications.unsupported}
        </div>
      )}
      {(state === 'on' || state === 'off') && (
        <div className="muted" style={{ fontSize: '0.85em', marginTop: '0.25rem' }}>
          {el.desktopNotifications.thisDevice}
        </div>
      )}
      {message && (
        <div className={message.kind === 'error' ? 'field-error' : 'muted'} style={{ marginTop: '0.25rem' }}>
          {message.text}
        </div>
      )}
    </div>
  );
}
