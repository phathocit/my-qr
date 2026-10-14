import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Quản Lý Thiết Bị CNTT & Kho QR",
  description: "Hệ thống quản lý vòng đời thiết bị, xuất nhập tồn kho và bảo hành bằng mã QR",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  viewportFit: "cover",
  themeColor: "#0f172a",
};

import ThemeSwitcher from "@/components/ThemeSwitcher";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi" data-theme="glass" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body>
        {children}
        <ThemeSwitcher />
      </body>
    </html>
  );
}
