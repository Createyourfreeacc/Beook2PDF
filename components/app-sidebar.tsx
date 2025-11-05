"use client"

import { ALargeSmall, ArrowBigDownDash, Book, Home, Moon, Notebook, NotebookPen, Settings, Sun } from "lucide-react"
import { useTheme } from "next-themes"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"

const items = [
  {
    title: "Home",
    url: "/",
    icon: Home,
  },
  {
    title: "Book",
    url: "/book-reader",
    icon: Book,
  },
  {
    title: "Quiz",
    url: "/quiz",
    icon: Notebook,
  },
  {
    title: "My Quiz",
    url: "/my-quiz",
    icon: NotebookPen,
  },
  {
    title: "Settings",
    url: "#",
    icon: Settings,
  },
  {
    title: "Lorem",
    url: "/lorem-ipsum",
    icon: ALargeSmall,
  },
]

export function AppSidebar() {

  const ModeToggle = () => {
    const { setTheme } = useTheme()

    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="icon">
            <Sun className="h-[1.2rem] w-[1.2rem] scale-100 rotate-0 transition-all dark:scale-0 dark:-rotate-90" />
            <Moon className="absolute h-[1.2rem] w-[1.2rem] scale-0 rotate-90 transition-all dark:scale-100 dark:rotate-0" />
            <span className="sr-only">Toggle theme</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => setTheme("light")}>
            Light
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setTheme("dark")}>
            Dark
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setTheme("system")}>
            System
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }

  return (
    <Sidebar>
      <SidebarContent>
        <SidebarGroup>
          {/*<SidebarGroupLabel>Application</SidebarGroupLabel>*/}
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((item) => {
                return (
                  <SidebarMenuItem key={item.title} >
                    <SidebarMenuButton asChild>
                      <a href={item.url}>
                        <item.icon />
                        <span>{item.title}</span>
                      </a>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarFooter>
          <ModeToggle />
        </SidebarFooter>
      </SidebarContent>
    </Sidebar>
  )
}
