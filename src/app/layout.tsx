import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Assessly", template: "%s · Assessly" },
  description: "Create assessments, guide learners, and measure progress in one focused workspace.",
  icons: { icon: "/icon.svg", apple: "/icon.svg" },
  applicationName: "Assessly",
  openGraph: { title: "Assessly", description: "Create assessments. Guide learners. Measure progress.", siteName: "Assessly", type: "website" },
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
