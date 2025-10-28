"use client"

import { motion, AnimatePresence } from "framer-motion"

type TocItem = {
  id: string
  content: string | JSX.Element
  toggled?: boolean
}

type TocBarProps = {
  items: TocItem[]
  onToggle?: (originalId: string) => void
}

export default function TocBar({ items }: TocBarProps) {
  const hasToggledItems = items.some((item) => item.toggled)

  return (
    <div
      className={`h-full w-full overflow-y-auto bg-background p-1 rounded-xl shadow z-40 flex flex-col justify-start transition-all ${hasToggledItems ? "border" : "border-transparent"
        }`}
    >
      <div className="flex flex-col gap-2">
        <AnimatePresence initial={false}>
          {items
            .filter((item) => item.toggled)
            .map((item) => {
              const prefixedId = `toc-${item.id}`

              return (
                <motion.div
                  key={prefixedId}
                  layout
                  layoutId={prefixedId}
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ duration: 0.2 }}
                >
                  <div className="w-full min-h-12 p-1 rounded-lg border shadow-sm transition-colors bg-accent text-accent-foreground flex items-center">
                    {item.content}
                  </div>
                </motion.div>
              )
            })}
        </AnimatePresence>
      </div>
    </div>
  )
}

