import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Drill Instructor | Practice. Review. Improve.",
    template: "%s | Drill Instructor",
  },
  description:
    "Drill Instructor helps students prepare with focused practice, review tools, and clear progress tracking.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
