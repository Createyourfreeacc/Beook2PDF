"use client"

import { motion, AnimatePresence } from "framer-motion"

type TocItem = {
  id: string
  title: string
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
      className={`h-full w-full overflow-y-auto bg-background p-1 rounded-xl shadow z-40 flex flex-col justify-start transition-all ${
        hasToggledItems ? "border" : "border-transparent"
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
                  {/* Collapsed: title only | Hover: expand and show TOC */}
                  <div className="group w-full rounded-lg border shadow-sm bg-accent text-accent-foreground overflow-hidden">
                    <div className="min-h-12 px-2 py-2 flex items-center">
                      <span className="text-sm font-medium truncate">
                        {item.title}
                      </span>
                    </div>

                    <div className="max-h-0 opacity-0 px-0 pb-0 group-hover:max-h-[70vh] group-hover:opacity-100 group-hover:px-2 group-hover:pb-2 transition-all duration-200 overflow-y-auto">
                      {item.content}
                    </div>
                  </div>
                </motion.div>
              )
            })}
        </AnimatePresence>
      </div>
    </div>
  )
}
