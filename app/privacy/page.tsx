import Link from "next/link";

export default function PrivacyPage() {
  return (
    <main className="legal-page">
      <Link href="/">← INKSPAN</Link>
      <p className="legal-kicker">PRIVACY</p>
      <h1>Your camera stays with you.</h1>
      <p>
        INKSPAN processes camera frames and hand landmarks locally in
        your browser. Camera frames and recordings are not uploaded to a
        server by this prototype.
      </p>
      <p>
        A recording exists only in browser memory until you save it or leave
        the page. INKSPAN records the processed camera canvas directly and
        includes only the INKSPAN mark and @tvthanhhh credit in the saved
        video. It never asks to capture your screen or another tab. Closing
        the page ends camera access and clears unsaved recordings.
      </p>
      <p>
        INKSPAN uses Google Analytics 4 to measure page visits and anonymous
        product actions such as enabling the camera, starting or saving a
        recording, and switching camera effects. Google Analytics may use
        cookies and receive standard device, browser, referral, and approximate
        location information. Camera frames, hand landmarks, and recordings
        are never included in analytics events.
      </p>
    </main>
  );
}
