"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { Home, History, CreditCard, Settings, Menu, LogOut, User } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"

const navigation = [
  {
    name: "Inicio",
    href: "/dashboard",
    icon: Home,
  },
  {
    name: "Historial",
    href: "/dashboard/historial",
    icon: History,
  },
  {
    name: "Suscripción",
    href: "/dashboard/suscripcion",
    icon: CreditCard,
  },
  {
    name: "Configuración",
    href: "/dashboard/configuracion",
    icon: Settings,
  },
]

function Sidebar({ className }: { className?: string }) {
  const pathname = usePathname()

  return (
    <div className={cn("flex h-full flex-col bg-slate-900", className)}>
      {/* Logo */}
      <div className="flex h-16 items-center border-b border-slate-800 px-6">
        <Link href="/dashboard" className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-700">
            <span className="text-lg font-bold text-white">ZS</span>
          </div>
          <span className="text-lg font-semibold text-white">ZSE Legal</span>
        </Link>
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-1 px-3 py-4">
        {navigation.map((item) => {
          const isActive = pathname === item.href
          return (
            <Link
              key={item.name}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                isActive
                  ? "bg-slate-800 text-white"
                  : "text-slate-400 hover:bg-slate-800/50 hover:text-white"
              )}
            >
              <item.icon className="h-5 w-5" />
              {item.name}
            </Link>
          )
        })}
      </nav>

      {/* Footer */}
      <div className="border-t border-slate-800 p-4">
        <p className="text-xs text-slate-500 text-center">
          Panel de Control v1.0
        </p>
      </div>
    </div>
  )
}

function Header() {
  const pathname = usePathname()
  
  // Generate breadcrumbs from pathname
  const pathSegments = pathname.split('/').filter(Boolean)
  const currentPage = pathSegments[pathSegments.length - 1] || 'inicio'
  const pageTitle = currentPage.charAt(0).toUpperCase() + currentPage.slice(1)

  return (
    <header className="sticky top-0 z-40 border-b bg-white">
      <div className="flex h-16 items-center justify-between px-4 sm:px-6">
        {/* Mobile Menu + Breadcrumbs */}
        <div className="flex items-center gap-4">
          {/* Mobile Menu Toggle */}
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="lg:hidden">
                <Menu className="h-5 w-5" />
                <span className="sr-only">Abrir menú</span>
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-64 p-0">
              <SheetHeader className="sr-only">
                <SheetTitle>Navegación</SheetTitle>
              </SheetHeader>
              <Sidebar />
            </SheetContent>
          </Sheet>

          {/* Breadcrumbs */}
          <div className="flex items-center gap-2 text-sm">
            <Link
              href="/dashboard"
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              Dashboard
            </Link>
            {currentPage !== 'dashboard' && (
              <>
                <span className="text-muted-foreground">/</span>
                <span className="font-medium text-foreground">{pageTitle}</span>
              </>
            )}
          </div>
        </div>

        {/* User Menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="relative h-10 w-10 rounded-full">
              <Avatar>
                <AvatarImage src="/avatar-placeholder.png" alt="Usuario" />
                <AvatarFallback className="bg-slate-700 text-white">
                  AB
                </AvatarFallback>
              </Avatar>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel className="font-normal">
              <div className="flex flex-col space-y-1">
                <p className="text-sm font-medium leading-none">Abogado Demo</p>
                <p className="text-xs leading-none text-muted-foreground">
                  abogado@ejemplo.com
                </p>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/dashboard/configuracion" className="cursor-pointer">
                <User className="mr-2 h-4 w-4" />
                <span>Mi Perfil</span>
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/dashboard/suscripcion" className="cursor-pointer">
                <CreditCard className="mr-2 h-4 w-4" />
                <span>Suscripción</span>
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="cursor-pointer text-red-600">
              <LogOut className="mr-2 h-4 w-4" />
              <span>Cerrar Sesión</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="flex h-screen overflow-hidden">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex lg:w-64 lg:flex-col">
        <Sidebar />
      </aside>

      {/* Main Content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header />
        <main className="flex-1 overflow-y-auto bg-slate-50">
          <div className="container mx-auto p-6 lg:p-8">
            {children}
          </div>
        </main>
      </div>
    </div>
  )
}
