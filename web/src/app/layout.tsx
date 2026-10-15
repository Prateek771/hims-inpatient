import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

const publicSans = localFont({
  src: [
    { path: "../../node_modules/@fontsource/public-sans/files/public-sans-latin-400-normal.woff2", weight: "400" },
    { path: "../../node_modules/@fontsource/public-sans/files/public-sans-latin-500-normal.woff2", weight: "500" },
    { path: "../../node_modules/@fontsource/public-sans/files/public-sans-latin-600-normal.woff2", weight: "600" },
  ],
  variable: "--font-public-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "HIMS · Inpatient workspace",
  description: "A hospital staff workspace from admission to discharge.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={publicSans.variable}>
      <body>{children}</body>
    </html>
  );
}
