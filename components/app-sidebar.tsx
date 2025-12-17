"use client"

import { Book, Notebook, NotebookPen, Settings } from "lucide-react"

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { useI18n } from "@/components/i18n-provider"

const items = [
  {
    titleKey: "nav.book",
    url: "/",
    icon: Book,
  },
  {
    titleKey: "nav.quiz",
    url: "/quiz",
    icon: Notebook,
  },
  {
    titleKey: "nav.myQuiz",
    url: "/my-quiz",
    icon: NotebookPen,
  },
  {
    titleKey: "nav.settings",
    url: "/settings",
    icon: Settings,
  },
]

export function AppSidebar() {
  const { t } = useI18n()
  return (
    <Sidebar>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((item) => {
                return (
                  <SidebarMenuItem key={item.titleKey}>
                    <SidebarMenuButton asChild>
                      <a href={item.url}>
                        <item.icon />
                        <span>{t(item.titleKey)}</span>
                      </a>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  )
}
