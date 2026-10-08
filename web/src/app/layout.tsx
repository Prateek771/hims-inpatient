import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

const plexSans = localFont({
  src: [
    { path: "../../node_modules/@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-400-normal.woff2", weight: "400" },
    { path: "../../node_modules/@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-500-normal.woff2", weight: "500" },
    { path: "../../node_modules/@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-600-normal.woff2", weight: "600" },
  ],
  variable: "--font-plex-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "HIMS · Inpatient workspace",
  description: "A hospital staff workspace from admission to discharge.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={plexSans.variable}>
      <body>{children}</body>
    </html>
  );
}
