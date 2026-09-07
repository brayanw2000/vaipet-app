import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-ios-headline font-semibold ring-offset-background transition-all active:scale-[0.98] active:opacity-90 disabled:pointer-events-none disabled:opacity-40 [&_svg]:pointer-events-none [&_svg]:size-5 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground shadow-sm",
        destructive:
          "bg-destructive text-destructive-foreground shadow-sm",
        outline:
          "border border-separator bg-transparent text-foreground hover:bg-muted/50",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "bg-transparent text-foreground active:bg-muted/50",
        link: "text-primary active:opacity-60",
      },
      size: {
        default: "h-[48px] px-6 py-3",
        sm: "h-[36px] px-4 rounded-lg text-ios-subheadline",
        lg: "h-[56px] px-10 rounded-xl text-ios-title-3",
        icon: "h-[44px] w-[44px]",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
