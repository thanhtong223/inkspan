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
        the page. When you record, your browser asks you to share the current
        INKSPAN tab so the saved video can include the visible controls.
        The captured tab is still processed locally. Closing the page ends
        camera and screen-capture access.
      </p>
    </main>
  );
}
