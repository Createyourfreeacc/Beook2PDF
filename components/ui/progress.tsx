"use client"

import * as React from "react"
import * as ProgressPrimitive from "@radix-ui/react-progress"

import { cn } from "@/lib/utils"

function Progress({
  className,
  value,
  ...props
}: React.ComponentProps<typeof ProgressPrimitive.Root>) {  
  return (
    <div className="w-[60%]">
      <style>
        {`@keyframes progress {
          to {
            left: calc(100% - 2rem);
          }
        }
        .progress {
          transform-origin: center;
          animation: progress 1.25s ease-in-out infinite;
        }
        `}
      </style>
      <ProgressPrimitive.Root className="relative h-2 w-full overflow-hidden rounded-full bg-primary/20">
        <ProgressPrimitive.Indicator
          className="relative h-full w-full flex-1 bg-primary transition-all"
          style={{ transform: `translateX(-${100 - (value || 0)}%)` }}
        >
          <div className="absolute left-0 w-6 h-full bg-primary-foreground blur-[10px] inset-y-0 progress" />
        </ProgressPrimitive.Indicator>
      </ProgressPrimitive.Root>
    </div>
  )
}

export { Progress }
