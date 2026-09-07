import { useTheme } from "next-themes"
import { Toaster as Sonner, toast } from "sonner"
import { AlertCircle, CheckCircle2 } from "lucide-react"

type ToasterProps = React.ComponentProps<typeof Sonner>

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-primary group-[.toaster]:text-primary-foreground group-[.toaster]:border-none group-[.toaster]:shadow-lg group-[.toaster]:rounded-xl group-[.toaster]:px-4 group-[.toaster]:py-3 group-[.toaster]:flex group-[.toaster]:items-center group-[.toaster]:gap-3",
          description: "group-[.toast]:text-primary-foreground/80",
          actionButton:
            "group-[.toast]:bg-background group-[.toast]:text-foreground",
          cancelButton:
            "group-[.toast]:bg-background/20 group-[.toast]:text-foreground",
          error: "group-[.toaster]:bg-destructive group-[.toaster]:text-destructive-foreground",
          success: "group-[.toaster]:bg-primary group-[.toaster]:text-primary-foreground",
        },
      }}
      icons={{
        error: <AlertCircle className="h-5 w-5" />,
        success: <CheckCircle2 className="h-5 w-5" />,
      }}
      {...props}
    />
  )
}

export { Toaster, toast }

