import type { Metadata, Viewport } from "next";
import "./globals.css";
import { GoogleAnalytics } from "./GoogleAnalytics";

export const metadata: Metadata = {
  title: "INKSPAN",
  description:
    "Stretch four live print effects between your fingertips, directly in the browser.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export const viewport: Viewport = {
  themeColor: "#171815",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        {children}
        <GoogleAnalytics measurementId="G-JB2JVRJ1PG" />
      </body>
    </html>
  );
}
