import Link from "next/link";

export default function PrivacyPage() {
  return (
    <main className="legal-page">
      <Link href="/">← INKSPAN</Link>
      <p className="legal-kicker">PRIVACY</p>
      <h1>Your camera stays with you.</h1>
      <p>
        INKSPAN processes camera frames and hand landmarks locally in
        your browser. Camera frames, recordings, and photos are not uploaded
        to a server by this prototype.
      </p>
      <p>
        A recording exists only in browser memory until you save it or leave
        the page. INKSPAN records the processed camera canvas directly and
        includes its recording controls and creator credit in the saved video.
        It never asks to capture your screen or another tab. Closing the page
        ends camera access and clears unsaved recordings.
      </p>
    </main>
  );
}
