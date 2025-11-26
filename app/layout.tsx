import type { Metadata } from "next";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider"
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar"
import { AppSidebar } from "@/components/app-sidebar"
import { cookies } from "next/headers"
import Image from "next/image";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Beook2Pdf",
  description: "Export any Content in Beook to a PDF",
  icons: {
    icon: '/favicon.ico',
  },
};

export default async function RootLayout({ children }:
  Readonly<{
    children: React.ReactNode;
  }>) {
  const cookieStore = await cookies()
  const defaultOpen = cookieStore.get("sidebar_state")?.value === "true"

  return (
    <>
      <html lang="en" suppressHydrationWarning>
        <head />
        <body>
          <ThemeProvider
            attribute="class"
            defaultTheme="system"
            enableSystem
            disableTransitionOnChange
          >
            <SidebarProvider defaultOpen={defaultOpen}>
              <AppSidebar />
              <main className="flex flex-1 flex-col gap-4 w-full h-screen">
                <div className="relative px-4 py-3 bg-secondary text-primary-background flex items-center h-14">
                  <div className="absolute left-4">
                    <SidebarTrigger />
                  </div>
                  <div className="mx-auto flex items-center gap-2">
                    <Link href="/">
                      <Image src="/leaf.ico" alt="Logo" width={20} height={20} className="block" />
                    </Link>
                    <span className="text-base">
                      Beook<span style={{ color: "#a7ce38" }}>2</span>Pdf
                    </span>
                  </div>
                </div>
                <div className="p-4 pt-0">
                  <div className="flex gap-3 items-center">

                  </div>
                  {children}
                </div>
              </main>
            </SidebarProvider>
          </ThemeProvider>
        </body>
      </html >
    </>
  )
}


