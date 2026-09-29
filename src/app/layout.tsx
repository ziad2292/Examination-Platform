import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Summit SAT", template: "%s · Summit SAT" },
  description: "Secure, timed SAT-style mock examinations for teachers and students.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
